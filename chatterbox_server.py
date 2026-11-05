import os
import io
import hashlib
import tempfile
import logging
import subprocess
from typing import Optional, Dict, Any, Tuple
import numpy as np
import soundfile as sf
import torch
import librosa
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

# Limit CPU thread oversubscription on macOS
torch.set_num_threads(min(4, max(2, os.cpu_count() or 4)))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("ChatterboxServer")

app = FastAPI(title="Hypervox Chatterbox Voice Cloning Service")

# Support both standard CORS and Chromium Private Network Access (PNA)
@app.middleware("http")
async def add_private_network_headers(request: Request, call_next):
    if request.method == "OPTIONS":
        response = Response(status_code=200)
    else:
        response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS, HEAD"
    response.headers["Access-Control-Allow-Headers"] = "*"
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_vc_model = None
_ref_cache: Dict[str, Tuple[Dict[str, Any], float]] = {}


def get_vc_model():
    global _vc_model
    if _vc_model is None:
        logger.info("Loading Chatterbox Voice Conversion model...")
        from chatterbox.vc import ChatterboxVC
        device = "cuda" if torch.cuda.is_available() else "cpu"
        _vc_model = ChatterboxVC.from_pretrained(device=device)
        logger.info(f"Chatterbox VC model loaded successfully on {device}.")
    return _vc_model


def _decode_bytes_with_ffmpeg(raw_bytes: bytes, target_sr: int) -> np.ndarray:
    """Decode any audio container (MP3, M4A, WAV, AAC, WebM, OGG) to clean mono float32 at target_sr."""
    with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as in_tmp, \
         tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as out_tmp:
        in_tmp.write(raw_bytes)
        in_path = in_tmp.name
        out_path = out_tmp.name

    try:
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", in_path,
                "-vn", "-ac", "1", "-ar", str(target_sr),
                "-acodec", "pcm_s16le", out_path,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=20,
        )
        wav, _ = sf.read(out_path, dtype="float32")
        if wav.ndim > 1:
            wav = np.mean(wav, axis=1)
        return wav
    except Exception:
        wav, _ = librosa.load(in_path, sr=target_sr, mono=True)
        return wav.astype(np.float32)
    finally:
        for p in (in_path, out_path):
            if os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass


def _calculate_fundamental_pitch(wav: np.ndarray, sr: int, default_f0: float = 220.0) -> float:
    """Fast fundamental pitch estimation using YIN algorithm."""
    try:
        if len(wav) < int(sr * 0.25):
            return default_f0
        f0 = librosa.yin(wav, fmin=70, fmax=520, sr=sr)
        valid = f0[(f0 >= 75) & (f0 <= 500) & ~np.isnan(f0)]
        if len(valid) > 5:
            return float(np.median(valid))
    except Exception as e:
        logger.debug(f"Pitch detection fallback: {e}")
    return default_f0


def _get_target_embedding(model, ref_bytes: bytes) -> Tuple[Dict[str, Any], float]:
    """Cache and return the speaker conditioning embedding and median F0 for the reference audio."""
    ref_hash = hashlib.sha256(ref_bytes).hexdigest()
    if ref_hash in _ref_cache:
        return _ref_cache[ref_hash]

    ref_wav = _decode_bytes_with_ffmpeg(ref_bytes, model.sr)

    # Trim leading/trailing silence
    trimmed, _ = librosa.effects.trim(ref_wav, top_db=25)
    if len(trimmed) >= int(model.sr * 0.6):
        ref_wav = trimmed

    # Detect reference target F0 before any truncation
    target_f0 = _calculate_fundamental_pitch(ref_wav, model.sr, default_f0=240.0)

    # Peak normalize reference audio for consistent speaker conditioning
    peak = float(np.max(np.abs(ref_wav))) if len(ref_wav) > 0 else 0.0
    if peak > 1e-4:
        ref_wav = (ref_wav / peak) * 0.95

    # Align reference audio length to exact 40ms multiples (960 samples @ 24kHz)
    # This prevents the S3Gen "Reference mel length != 2 * reference token length" error
    max_len = min(len(ref_wav), model.DEC_COND_LEN)
    pad_len = max(960, (max_len // 960) * 960)
    ref_wav = ref_wav[:pad_len]

    ref_dict = model.s3gen.embed_ref(ref_wav, model.sr, device=model.device)
    result = (ref_dict, target_f0)
    _ref_cache[ref_hash] = result
    logger.info(f"Target speaker reference embedded: len={len(ref_wav)/model.sr:.2f}s, target_F0={target_f0:.1f}Hz")
    return result


def _load_audio_mono_16k(audio_bytes: bytes, target_f0: Optional[float] = None) -> torch.Tensor:
    """Load arbitrary audio bytes into a clean 16kHz float32 mono tensor [1, N], pitch-aligned to target."""
    audio_16 = _decode_bytes_with_ffmpeg(audio_bytes, 16000)
    if len(audio_16) > 45 * 16000:
        audio_16 = audio_16[: 45 * 16000]

    # Trim silence
    trimmed, _ = librosa.effects.trim(audio_16, top_db=28)
    if len(trimmed) >= int(16000 * 0.5):
        audio_16 = trimmed

    # Pitch-align source speech to target reference F0 so S3 tokenizer retains target vocal register
    if target_f0 is not None and target_f0 > 70:
        src_f0 = _calculate_fundamental_pitch(audio_16, 16000, default_f0=180.0)
        semitones = 12.0 * np.log2(target_f0 / max(50.0, src_f0))
        semitones = float(np.clip(semitones, -12.0, 12.0))
        if abs(semitones) > 0.4:
            logger.info(f"Pitch alignment: source={src_f0:.1f}Hz -> target={target_f0:.1f}Hz (shift: {semitones:+.2f} st)")
            try:
                audio_16 = librosa.effects.pitch_shift(
                    audio_16,
                    sr=16000,
                    n_steps=semitones,
                    n_fft=1024,
                    res_type="soxr_hq",
                )
            except Exception as shift_err:
                logger.warning(f"Pitch shift exception: {shift_err}")

    # Align to 40ms multiples for 16kHz (640 samples per token frame)
    pad_len = max(640, (len(audio_16) // 640) * 640)
    audio_16 = audio_16[:pad_len]

    peak = float(np.max(np.abs(audio_16))) if len(audio_16) > 0 else 0.0
    if peak > 1e-4:
        audio_16 = (audio_16 / peak) * 0.95

    return torch.from_numpy(audio_16).float()[None,]


def _synthesize_local_speech(text: str, target_f0: float = 220.0) -> bytes:
    """Generate clean 16kHz WAV speech from text via macOS 'say', selecting voice by pitch register."""
    with tempfile.NamedTemporaryFile(suffix=".aiff", delete=False) as aiff_tmp, \
         tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as wav_tmp:
        aiff_p = aiff_tmp.name
        wav_p = wav_tmp.name

    # Select female or male system voice matching target speaker pitch
    system_voice = "Samantha" if target_f0 >= 175.0 else "Alex"

    try:
        subprocess.run(["say", "-v", system_voice, "-o", aiff_p, text.strip()], check=True, timeout=15)
        subprocess.run(
            ["ffmpeg", "-y", "-i", aiff_p, "-ar", "16000", "-ac", "1", wav_p],
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=15,
        )
        with open(wav_p, "rb") as f:
            return f.read()
    finally:
        for p in [aiff_p, wav_p]:
            if os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass


def _run_neural_conversion(model, audio_16_tensor: torch.Tensor, ref_dict: Dict[str, Any], speed: float = 1.0) -> bytes:
    """Run high-precision 18-step CFM voice timbre conversion and return PCM 16-bit 24kHz WAV bytes."""
    with torch.inference_mode():
        audio_16_tensor = audio_16_tensor.to(model.device)
        s3_tokens, _ = model.s3gen.tokenizer(audio_16_tensor)
        wav, _ = model.s3gen.inference(
            speech_tokens=s3_tokens,
            ref_dict=ref_dict,
            n_cfm_timesteps=18,
        )
        wav_np = wav.squeeze(0).detach().cpu().numpy()

    # Time stretch if speed adjustment was explicitly requested
    if abs(speed - 1.0) > 0.05:
        wav_np = librosa.effects.time_stretch(wav_np, rate=speed)

    # Normalize output audio
    peak = float(np.max(np.abs(wav_np))) if len(wav_np) > 0 else 0.0
    if peak > 1e-4:
        wav_np = (wav_np / peak) * 0.95

    out_buf = io.BytesIO()
    sf.write(out_buf, wav_np, model.sr, format="WAV", subtype="PCM_16")
    out_buf.seek(0)
    return out_buf.read()


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "engine": "Chatterbox Voice Cloning (Pitch-Aligned High-Fidelity 24kHz)",
        "model_loaded": _vc_model is not None,
    }


@app.post("/clone")
async def clone_voice(
    reference_audio: UploadFile = File(...),
    text: str = Form(""),
    speed: float = Form(1.0),
    source_audio: Optional[UploadFile] = File(None),
):
    model = get_vc_model()
    ref_bytes = await reference_audio.read()
    if not ref_bytes:
        raise HTTPException(status_code=400, detail="Reference audio file is empty.")

    ref_dict, target_f0 = _get_target_embedding(model, ref_bytes)

    if source_audio is not None:
        src_bytes = await source_audio.read()
    elif text.strip():
        logger.info(f"Synthesizing text locally for cloning ({len(text)} chars, target_f0={target_f0:.1f}Hz)...")
        src_bytes = _synthesize_local_speech(text, target_f0=target_f0)
    else:
        raise HTTPException(status_code=400, detail="Please provide either source_audio or text to clone.")

    if not src_bytes:
        raise HTTPException(status_code=400, detail="Source speech audio could not be resolved.")

    try:
        logger.info(f"Chatterbox voice clone: ref='{reference_audio.filename}', target_f0={target_f0:.1f}Hz, speed={speed:.2f}")
        audio_16 = _load_audio_mono_16k(src_bytes, target_f0=target_f0)
        output_wav = _run_neural_conversion(model, audio_16, ref_dict, speed=speed)

        return Response(
            content=output_wav,
            media_type="audio/wav",
            headers={"Content-Disposition": "attachment; filename=cloned_voice.wav"},
        )
    except Exception as exc:
        logger.error(f"Voice cloning failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/vc")
async def voice_conversion(
    source_audio: UploadFile = File(...),
    reference_audio: UploadFile = File(...),
    speed: float = Form(1.0),
):
    model = get_vc_model()
    ref_bytes = await reference_audio.read()
    src_bytes = await source_audio.read()

    if not ref_bytes or not src_bytes:
        raise HTTPException(status_code=400, detail="Source or reference audio is empty.")

    try:
        ref_dict, target_f0 = _get_target_embedding(model, ref_bytes)
        logger.info(f"Direct Chatterbox VC: '{source_audio.filename}' -> '{reference_audio.filename}' (target_f0={target_f0:.1f}Hz, speed={speed:.2f})")
        audio_16 = _load_audio_mono_16k(src_bytes, target_f0=target_f0)
        output_wav = _run_neural_conversion(model, audio_16, ref_dict, speed=speed)

        return Response(
            content=output_wav,
            media_type="audio/wav",
            headers={"Content-Disposition": "attachment; filename=vc_output.wav"},
        )
    except Exception as exc:
        logger.error(f"Voice conversion failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


if __name__ == "__main__":
    import uvicorn
    try:
        get_vc_model()
    except Exception as e:
        logger.warning(f"Initial model warmup deferred: {e}")
    uvicorn.run(app, host="0.0.0.0", port=5051, log_level="info")
