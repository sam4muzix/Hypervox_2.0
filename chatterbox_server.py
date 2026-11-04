import os
import io
import hashlib
import tempfile
import logging
import subprocess
from typing import Optional, Dict, Any
import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

# Limit CPU thread oversubscription on macOS
torch.set_num_threads(min(4, max(2, os.cpu_count() or 4)))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("ChatterboxServer")

app = FastAPI(title="Hypervox Chatterbox Voice Cloning Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_vc_model = None
_ref_cache: Dict[str, Dict[str, Any]] = {}


def get_vc_model():
    global _vc_model
    if _vc_model is None:
        logger.info("Loading Chatterbox Voice Conversion model...")
        from chatterbox.vc import ChatterboxVC
        device = "cuda" if torch.cuda.is_available() else "cpu"
        _vc_model = ChatterboxVC.from_pretrained(device=device)
        logger.info(f"Chatterbox VC model loaded successfully on {device}.")
    return _vc_model


def _get_target_embedding(model, ref_bytes: bytes) -> Dict[str, Any]:
    """Cache and return the speaker conditioning embedding for the reference audio."""
    ref_hash = hashlib.sha256(ref_bytes).hexdigest()
    if ref_hash in _ref_cache:
        return _ref_cache[ref_hash]

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(ref_bytes)
        tmp_path = tmp.name

    try:
        import librosa
        ref_wav, _ = librosa.load(tmp_path, sr=model.sr)
        # Cap reference audio to DEC_COND_LEN (10 seconds)
        ref_wav = ref_wav[: model.DEC_COND_LEN]
        ref_dict = model.s3gen.embed_ref(ref_wav, model.sr, device=model.device)
        _ref_cache[ref_hash] = ref_dict
        return ref_dict
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


def _load_audio_mono_16k(audio_bytes: bytes) -> torch.Tensor:
    """Load arbitrary audio bytes into a 16kHz float32 mono tensor [1, N]."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        import librosa
        audio_16, _ = librosa.load(tmp_path, sr=16000)
        if len(audio_16) > 45 * 16000:
            audio_16 = audio_16[: 45 * 16000]
        return torch.from_numpy(audio_16).float()[None,]
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


def _synthesize_local_speech(text: str) -> bytes:
    """Generate clean 16kHz WAV speech from text in <100ms via macOS 'say'."""
    with tempfile.NamedTemporaryFile(suffix=".aiff", delete=False) as aiff_tmp, \
         tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as wav_tmp:
        aiff_p = aiff_tmp.name
        wav_p = wav_tmp.name

    try:
        subprocess.run(["say", "-o", aiff_p, text.strip()], check=True, timeout=10)
        subprocess.run(
            ["ffmpeg", "-y", "-i", aiff_p, "-ar", "16000", "-ac", "1", wav_p],
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=10,
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
    """Run fast 4-step CFM voice timbre conversion and return PCM 16-bit WAV bytes."""
    with torch.inference_mode():
        audio_16_tensor = audio_16_tensor.to(model.device)
        s3_tokens, _ = model.s3gen.tokenizer(audio_16_tensor)
        # Optimized 4-step CFM inference for fast, smooth synthesis on CPU
        wav, _ = model.s3gen.inference(
            speech_tokens=s3_tokens,
            ref_dict=ref_dict,
            n_cfm_timesteps=4,
        )
        wav_np = wav.squeeze(0).detach().cpu().numpy()
        watermarked_wav = model.watermarker.apply_watermark(wav_np, sample_rate=model.sr)

    # Optional speed adjustment
    if abs(speed - 1.0) > 0.03:
        import librosa
        watermarked_wav = librosa.effects.time_stretch(watermarked_wav, rate=speed)

    out_buf = io.BytesIO()
    sf.write(out_buf, watermarked_wav, model.sr, format="WAV", subtype="PCM_16")
    out_buf.seek(0)
    return out_buf.read()


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "engine": "Chatterbox Voice Cloning (Accelerated)",
        "model_loaded": _vc_model is not None,
    }


@app.post("/clone")
async def clone_voice(
    reference_audio: UploadFile = File(...),
    text: str = Form(""),
    speed: float = Form(1.0),
    source_audio: Optional[UploadFile] = File(None),
):
    """
    Dedicated voice cloning via Chatterbox Neural Engine:
    Converts speech to match the reference target speaker voice.
    Accepts pre-synthesized source audio or auto-synthesizes from script text.
    """
    model = get_vc_model()
    ref_bytes = await reference_audio.read()
    if not ref_bytes:
        raise HTTPException(status_code=400, detail="Reference audio file is empty.")

    ref_dict = _get_target_embedding(model, ref_bytes)

    # Determine source audio to convert
    if source_audio is not None:
        src_bytes = await source_audio.read()
    elif text.strip():
        logger.info(f"Synthesizing text locally for cloning ({len(text)} chars)...")
        src_bytes = _synthesize_local_speech(text)
    else:
        raise HTTPException(status_code=400, detail="Please provide either source_audio or text to clone.")

    if not src_bytes:
        raise HTTPException(status_code=400, detail="Source speech audio could not be resolved.")

    try:
        logger.info(f"Chatterbox voice clone: ref='{reference_audio.filename}', speed={speed:.2f}")
        audio_16 = _load_audio_mono_16k(src_bytes)
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
    """
    Direct acoustic Voice-to-Voice conversion via Chatterbox Neural Engine:
    Converts source_audio timbre directly to reference_audio target speaker.
    """
    model = get_vc_model()
    ref_bytes = await reference_audio.read()
    src_bytes = await source_audio.read()

    if not ref_bytes or not src_bytes:
        raise HTTPException(status_code=400, detail="Source or reference audio is empty.")

    try:
        ref_dict = _get_target_embedding(model, ref_bytes)
        logger.info(f"Direct Chatterbox VC: '{source_audio.filename}' -> '{reference_audio.filename}', speed={speed:.2f}")
        audio_16 = _load_audio_mono_16k(src_bytes)
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
    # Warm up model on server start for instantaneous response
    try:
        get_vc_model()
    except Exception as e:
        logger.warning(f"Initial model warmup deferred: {e}")
    uvicorn.run(app, host="0.0.0.0", port=5051, log_level="info")
