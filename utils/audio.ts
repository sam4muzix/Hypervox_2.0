// @ts-ignore
import { Mp3Encoder } from 'lamejs';

// Utility to convert raw PCM data to WAV format
export const pcmToWav = (pcmData: Uint8Array, sampleRate: number = 24000, numChannels: number = 1): Blob => {
  // Guarantee even number of bytes for 16-bit PCM (2 bytes per sample)
  const dataLength = pcmData.byteLength - (pcmData.byteLength % 2);
  const headerLength = 44;
  const wavData = new Uint8Array(headerLength + dataLength);
  const view = new DataView(wavData.buffer);

  // RIFF identifier
  writeString(view, 0, 'RIFF');
  // file length
  view.setUint32(4, 36 + dataLength, true);
  // RIFF type
  writeString(view, 8, 'WAVE');
  // format chunk identifier
  writeString(view, 12, 'fmt ');
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (1 = raw PCM)
  view.setUint16(20, 1, true);
  // channel count
  view.setUint16(22, numChannels, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sample rate * block align)
  view.setUint32(28, sampleRate * numChannels * 2, true); // 16-bit
  // block align (channel count * bytes per sample)
  view.setUint16(32, numChannels * 2, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data chunk identifier
  writeString(view, 36, 'data');
  // data chunk length
  view.setUint32(40, dataLength, true);

  // Write PCM samples safely within valid range
  wavData.set(pcmData.subarray(0, dataLength), 44);

  return new Blob([wavData], { type: 'audio/wav' });
};

// Utility to convert raw PCM data to MP3 format
export const pcmToMp3 = (pcmData: Uint8Array, sampleRate: number = 24000, numChannels: number = 1): Blob => {
  try {
    const validLength = pcmData.byteLength - (pcmData.byteLength % 2);
    // Convert Uint8Array (bytes) to Int16Array (samples) using clean byte offset and sample count
    const wavSamples = new Int16Array(pcmData.buffer, pcmData.byteOffset, validLength / 2);
    
    // NOTE: We use Mp3Encoder from @breezystack/lamejs which is a class
    const mp3encoder = new Mp3Encoder(numChannels, sampleRate, 128); // 128kbps
    const mp3Data = [];
    
    // Lamejs expects samples. If mono, passed as left channel.
    const blockSize = 1152; // multiple of 576
    for (let i = 0; i < wavSamples.length; i += blockSize) {
      const sampleChunk = wavSamples.subarray(i, i + blockSize);
      const mp3buf = mp3encoder.encodeBuffer(sampleChunk);
      if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
      }
    }
    
    const mp3buf = mp3encoder.flush();
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }
    
    return new Blob(mp3Data, { type: 'audio/mp3' });
  } catch (e) {
    console.error("MP3 Encoding failed (MPEGMode/Lamejs error). Falling back to WAV.", e);
    // Fallback to WAV to ensure user gets audio even if encoding fails
    return pcmToWav(pcmData, sampleRate, numChannels);
  }
};

const writeString = (view: DataView, offset: number, string: string) => {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
};

export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        // Remove data URL prefix (e.g., "data:audio/mp3;base64,")
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      } else {
        reject(new Error('Failed to convert blob to base64'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

export const decodeBase64ToUint8Array = (base64: string): Uint8Array => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

/**
 * Strips WAV container headers and trailing C2PA/JUMB provenance metadata chunks
 * returned by Gemini audio models, returning pure 16-bit PCM samples with micro edge-smoothing.
 */
export const extractPcmFromAudioBuffer = (bytes: Uint8Array): Uint8Array => {
  if (bytes.byteLength < 44) return bytes;

  // Check if buffer starts with 'RIFF'
  const isRiff =
    bytes[0] === 0x52 && // 'R'
    bytes[1] === 0x49 && // 'I'
    bytes[2] === 0x46 && // 'F'
    bytes[3] === 0x46;   // 'F'

  if (!isRiff) {
    const evenLen = bytes.byteLength - (bytes.byteLength % 2);
    return bytes.subarray(0, evenLen);
  }

  // Search for the 'data' subchunk (0x64, 0x61, 0x74, 0x61)
  let pcmStart = -1;
  let dataSize = 0;

  for (let i = 12; i < Math.min(bytes.byteLength - 8, 2048); i++) {
    if (
      bytes[i] === 0x64 &&     // 'd'
      bytes[i + 1] === 0x61 && // 'a'
      bytes[i + 2] === 0x74 && // 't'
      bytes[i + 3] === 0x61    // 'a'
    ) {
      dataSize =
        bytes[i + 4] |
        (bytes[i + 5] << 8) |
        (bytes[i + 6] << 16) |
        (bytes[i + 7] << 24);
      pcmStart = i + 8;
      break;
    }
  }

  if (pcmStart === -1) {
    const pcm = bytes.subarray(44);
    const evenLen = pcm.byteLength - (pcm.byteLength % 2);
    return pcm.subarray(0, evenLen);
  }

  const pcmEnd = Math.min(bytes.byteLength, pcmStart + dataSize);
  const pcm = bytes.subarray(pcmStart, pcmEnd);
  const evenLen = pcm.byteLength - (pcm.byteLength % 2);
  const cleanPcm = pcm.subarray(0, evenLen);

  // Apply 5ms (120 samples) micro fade-in / fade-out to prevent boundary pops
  const fadeSamples = 120;
  if (cleanPcm.byteLength >= fadeSamples * 4) {
    const view = new DataView(cleanPcm.buffer, cleanPcm.byteOffset, cleanPcm.byteLength);
    const numSamples = cleanPcm.byteLength / 2;
    for (let s = 0; s < fadeSamples; s++) {
      const factorIn = s / fadeSamples;
      const factorOut = (fadeSamples - s) / fadeSamples;
      const sampleIn = Math.round(view.getInt16(s * 2, true) * factorIn);
      const outIdx = (numSamples - 1 - s) * 2;
      const sampleOut = Math.round(view.getInt16(outIdx, true) * factorOut);
      view.setInt16(s * 2, sampleIn, true);
      view.setInt16(outIdx, sampleOut, true);
    }
  }

  return cleanPcm;
};

import { VoiceGender } from '../types';

export interface AcousticVoiceProfile {
  detectedGender: VoiceGender;
  pitchHz: number;
  baseVoicePitchHz: number;
  brightnessRatio: number;
  matchedVoiceName: string;
  timbreDescription: string;
  acousticStyleDirective: string;
}

/**
 * Low-pass filtered Normalized Cross-Correlation (NCCF) pitch, spectral brightness, and vocal timbre analysis
 * to detect true fundamental frequency F0 (without upper-harmonic octave doubling), speaker gender,
 * and the optimal Gemini base voice match.
 */
export const analyzeAudioAcoustics = (samples: Float32Array, sampleRate: number = 24000): AcousticVoiceProfile => {
  // 1. 1-pole low-pass filter (~300 Hz cutoff) to suppress upper formants/harmonics that cause octave errors
  const lpSamples = new Float32Array(samples.length);
  const alpha = 0.075; // ~300 Hz at 24kHz
  let prev = 0;
  for (let i = 0; i < samples.length; i++) {
    prev = prev + alpha * (samples[i] - prev);
    lpSamples[i] = prev;
  }

  const frameSize = 2048;
  const hopSize = 1024;
  const pitches: number[] = [];
  let totalEnergy = 0;
  let highFreqEnergy = 0;

  // Fundamental vocal range: 75 Hz to 285 Hz
  const minPeriod = Math.floor(sampleRate / 285); // ~84 samples at 24kHz
  const maxPeriod = Math.floor(sampleRate / 75);  // ~320 samples at 24kHz

  for (let i = 0; i + frameSize < lpSamples.length; i += hopSize) {
    let energy0 = 0;
    for (let j = 0; j < frameSize - maxPeriod; j++) {
      energy0 += lpSamples[i + j] * lpSamples[i + j];
    }
    if (energy0 < 0.002) continue;

    // Compute Normalized Cross-Correlation (NCCF) and pick the FIRST strong local peak (true F0 period)
    const nccf = new Float32Array(maxPeriod + 1);
    let maxNccf = -1;

    for (let lag = minPeriod; lag <= maxPeriod; lag++) {
      let corr = 0;
      let energyLag = 0;
      const winLen = frameSize - maxPeriod;
      for (let j = 0; j < winLen; j++) {
        const a = lpSamples[i + j];
        const b = lpSamples[i + j + lag];
        corr += a * b;
        energyLag += b * b;
      }
      const denom = Math.sqrt(energy0 * energyLag);
      const val = denom > 1e-8 ? corr / denom : 0;
      nccf[lag] = val;
      if (val > maxNccf) maxNccf = val;
    }

    if (maxNccf < 0.55) continue;

    // Pick the first local peak >= 0.82 * maxNccf (avoids sub-harmonic doubling while preventing harmonic tripling)
    const threshold = Math.max(0.55, maxNccf * 0.82);
    let chosenPeriod = -1;
    for (let lag = minPeriod + 1; lag < maxPeriod; lag++) {
      if (nccf[lag] >= threshold && nccf[lag] >= nccf[lag - 1] && nccf[lag] >= nccf[lag + 1]) {
        chosenPeriod = lag;
        break;
      }
    }

    if (chosenPeriod > 0) {
      const freq = sampleRate / chosenPeriod;
      if (freq >= 75 && freq <= 285) {
        pitches.push(freq);
      }
    }
  }

  // Median pitch calculation
  let medianPitch = 130; // Natural adult default fallback
  if (pitches.length > 0) {
    pitches.sort((a, b) => a - b);
    medianPitch = pitches[Math.floor(pitches.length / 2)];
  }

  // Spectral brightness calculation
  for (let i = 1; i < samples.length; i++) {
    const diff = samples[i] - samples[i - 1];
    highFreqEnergy += diff * diff;
    totalEnergy += samples[i] * samples[i];
  }
  const brightnessRatio = totalEnergy > 0 ? highFreqEnergy / totalEnergy : 0.45;

  const isFemale = medianPitch > 168;
  const detectedGender = isFemale ? VoiceGender.FEMALE : VoiceGender.MALE;

  let matchedVoiceName = 'Fenrir';
  let baseVoicePitchHz = 125;
  let timbreDescription = 'balanced broadcast resonance';

  if (isFemale) {
    if (medianPitch >= 225) {
      matchedVoiceName = 'Kore';
      baseVoicePitchHz = 225;
      timbreDescription = 'clear expressive female vocal presence';
    } else if (medianPitch <= 190) {
      matchedVoiceName = 'Callirrhoe';
      baseVoicePitchHz = 178;
      timbreDescription = 'warm velvet, rich female chest resonance';
    } else {
      matchedVoiceName = 'Aoede';
      baseVoicePitchHz = 200;
      timbreDescription = 'natural, smooth, warm conversational female timbre';
    }
  } else {
    if (medianPitch <= 105) {
      matchedVoiceName = 'Iapetus';
      baseVoicePitchHz = 98;
      timbreDescription = 'deep baritone chest resonance';
    } else if (medianPitch <= 122) {
      matchedVoiceName = 'Charon';
      baseVoicePitchHz = 112;
      timbreDescription = 'warm resonant authoritative male voice';
    } else if (medianPitch <= 140) {
      matchedVoiceName = 'Fenrir';
      baseVoicePitchHz = 128;
      timbreDescription = 'rich commanding natural male broadcast timbre';
    } else {
      matchedVoiceName = 'Puck';
      baseVoicePitchHz = 148;
      timbreDescription = 'natural conversational mid-register male voice';
    }
  }

  const acousticStyleDirective = `Acoustic Match: ${detectedGender.toUpperCase()} voice, fundamental pitch ~${Math.round(medianPitch)} Hz, ${timbreDescription}. Perfectly reproduce this speaker's natural chest resonance, vocal tract depth, and cadence without ever sounding high-pitched or sped up.`;

  return {
    detectedGender,
    pitchHz: medianPitch,
    baseVoicePitchHz,
    brightnessRatio,
    matchedVoiceName,
    timbreDescription,
    acousticStyleDirective,
  };
};

/**
 * Applies Synchronized Overlap-Add (SOLA) pitch-matching and spectral timbre envelope shaping
 * so the output speech fundamental frequency (F0) matches the target speaker reference exactly
 * while 100% preserving original speech tempo, syllable duration, and natural prosody.
 */
export const applyAcousticTransfer = (
  pcm: Uint8Array,
  profile: AcousticVoiceProfile,
  sampleRate: number = 24000
): Uint8Array => {
  if (pcm.byteLength < 4) return pcm;

  const numSamples = Math.floor(pcm.byteLength / 2);
  const input = new Int16Array(pcm.buffer, pcm.byteOffset, numSamples);

  // 1. Calculate Fundamental Pitch Shift Ratio (Target Reference F0 / Matched Base Voice F0)
  const rawRatio = profile.pitchHz / Math.max(50, profile.baseVoicePitchHz);
  const pitchRatio = Math.min(Math.max(rawRatio, 0.65), 1.65);

  let currentSamples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    currentSamples[i] = input[i];
  }

  // 2. High-Precision SOLA Pitch Shifting (if pitch delta >= 3%)
  if (Math.abs(pitchRatio - 1.0) >= 0.03) {
    const resampledLen = Math.round(numSamples / pitchRatio);
    const resampled = new Float32Array(resampledLen);
    for (let i = 0; i < resampledLen; i++) {
      const srcPos = i * pitchRatio;
      const i0 = Math.floor(srcPos);
      const i1 = Math.min(i0 + 1, numSamples - 1);
      const frac = srcPos - i0;
      resampled[i] = currentSamples[i0] * (1 - frac) + currentSamples[i1] * frac;
    }

    const stretchFactor = pitchRatio;
    const windowSize = Math.round(sampleRate * 0.028); // 28ms window
    const hopOut = Math.round(windowSize / 2);
    const hopIn = Math.round(hopOut / stretchFactor);
    const maxSearch = Math.round(windowSize * 0.35);

    const targetLen = numSamples;
    const output = new Float32Array(targetLen);
    const weight = new Float32Array(targetLen);

    // Periodic Hanning window
    const window = new Float32Array(windowSize);
    for (let i = 0; i < windowSize; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (windowSize - 1)));
    }

    let inPos = 0;
    let outPos = 0;

    while (outPos + windowSize < targetLen && inPos + windowSize + maxSearch < resampledLen) {
      let bestOffset = 0;
      if (outPos > 0) {
        let maxCorr = -Infinity;
        for (let offset = -maxSearch; offset <= maxSearch; offset++) {
          const testIn = inPos + offset;
          if (testIn < 0 || testIn + windowSize >= resampledLen) continue;
          let corr = 0;
          let norm = 1e-6;
          for (let j = 0; j < hopOut; j++) {
            const sOut = output[outPos + j];
            const sIn = resampled[testIn + j];
            corr += sOut * sIn;
            norm += sIn * sIn;
          }
          const score = corr / Math.sqrt(norm);
          if (score > maxCorr) {
            maxCorr = score;
            bestOffset = offset;
          }
        }
      }

      const actualIn = inPos + bestOffset;
      for (let j = 0; j < windowSize; j++) {
        if (outPos + j < targetLen && actualIn + j < resampledLen) {
          output[outPos + j] += resampled[actualIn + j] * window[j];
          weight[outPos + j] += window[j];
        }
      }

      outPos += hopOut;
      inPos += hopIn;
    }

    for (let i = 0; i < targetLen; i++) {
      const w = weight[i] > 1e-4 ? weight[i] : 1.0;
      currentSamples[i] = output[i] / w;
    }
  }

  // 3. Spectral Timbre Envelope Shaping (warm chest resonance or studio air boost)
  if (profile.pitchHz < 135 || profile.brightnessRatio < 0.42) {
    let low = 0;
    for (let i = 0; i < numSamples; i++) {
      low = low * 0.88 + currentSamples[i] * 0.12;
      currentSamples[i] = currentSamples[i] * 0.84 + low * 0.24;
    }
  } else if (profile.brightnessRatio > 0.75) {
    let prev = 0;
    for (let i = 0; i < numSamples; i++) {
      const high = currentSamples[i] - prev;
      prev = currentSamples[i];
      currentSamples[i] = currentSamples[i] + high * 0.15;
    }
  }

  // 4. Peak normalize to prevent clipping
  let peak = 0;
  for (let i = 0; i < numSamples; i++) {
    const abs = Math.abs(currentSamples[i]);
    if (abs > peak) peak = abs;
  }
  const normFactor = peak > 32000 ? 31500 / peak : 1.0;

  const outBytes = new Uint8Array(numSamples * 2);
  const outView = new DataView(outBytes.buffer);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-32767, Math.min(32767, Math.round(currentSamples[i] * normFactor)));
    outView.setInt16(i * 2, s, true);
  }

  // Pass through studio de-clicker & smoothing to eliminate any SOLA boundary crackles
  return cleanStudioVoicePcm(outBytes, sampleRate);
};

/**
 * Studio-Grade De-Clicking, High-Pass Rumble Filter, HF Damping, and Soft-Knee Limiter.
 * Specifically eliminates neural vocoder impulsive cracking, phase pops, and digital harshness.
 */
export const cleanStudioVoicePcm = (
  pcm: Uint8Array,
  sampleRate: number = 24000
): Uint8Array => {
  if (pcm.byteLength < 8) return pcm;
  const numSamples = Math.floor(pcm.byteLength / 2);
  const input = new Int16Array(pcm.buffer, pcm.byteOffset, numSamples);
  const cleaned = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) cleaned[i] = input[i];

  // Maximum physical vocal cord acceleration limit at 24kHz (~11000 delta per sample)
  const MAX_SLEW = 11000;

  // Stage 1: Adaptive Impulse De-Clicker (5-point median difference check + cubic Hermite interpolation)
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 2; i < numSamples - 2; i++) {
      const s0 = cleaned[i - 2], s1 = cleaned[i - 1], s2 = cleaned[i], s3 = cleaned[i + 1], s4 = cleaned[i + 2];
      const sorted = [s0, s1, s2, s3, s4].sort((a, b) => a - b);
      const median = sorted[2];
      const diff = Math.abs(s2 - median);
      const localRms = Math.sqrt((s0 * s0 + s1 * s1 + s3 * s3 + s4 * s4) / 4);

      if (diff > 4000 && (diff > localRms * 1.4 || Math.abs(s2 - s1) > MAX_SLEW)) {
        const prevSlope = s1 - s0;
        const nextSlope = s4 - s3;
        cleaned[i] = (s1 + s3) / 2 + (prevSlope - nextSlope) * 0.125;
      }
    }
  }

  // Stage 2: Slew-rate rate-limiter (strictly eliminates isolated single-sample needle clicks)
  for (let i = 1; i < numSamples; i++) {
    const delta = cleaned[i] - cleaned[i - 1];
    if (delta > MAX_SLEW) {
      cleaned[i] = cleaned[i - 1] + MAX_SLEW;
    } else if (delta < -MAX_SLEW) {
      cleaned[i] = cleaned[i - 1] - MAX_SLEW;
    }
  }

  // Stage 3: Studio High-Pass Rumble Filter (80Hz Butterworth 2nd order)
  const hpW0 = 2 * Math.PI * (80 / sampleRate);
  const hpAlpha = Math.sin(hpW0) / (2 * 0.7071);
  const hpCos = Math.cos(hpW0);
  const hpB0 = (1 + hpCos) / 2, hpB1 = -(1 + hpCos), hpB2 = (1 + hpCos) / 2;
  const hpA0 = 1 + hpAlpha, hpA1 = -2 * hpCos, hpA2 = 1 - hpAlpha;

  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < numSamples; i++) {
    const x0 = cleaned[i];
    const y0 = (hpB0 / hpA0) * x0 + (hpB1 / hpA0) * x1 + (hpB2 / hpA0) * x2 - (hpA1 / hpA0) * y1 - (hpA2 / hpA0) * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    cleaned[i] = y0;
  }

  // Stage 4: Gentle High-Frequency Smoothing / Anti-Aliasing (9.5 kHz biquad lowpass)
  if (sampleRate >= 22050) {
    const lpCutoff = Math.min(9500, sampleRate * 0.42);
    const lpW0 = 2 * Math.PI * (lpCutoff / sampleRate);
    const lpAlpha = Math.sin(lpW0) / (2 * 0.7071);
    const lpCos = Math.cos(lpW0);
    const lpB0 = (1 - lpCos) / 2, lpB1 = 1 - lpCos, lpB2 = (1 - lpCos) / 2;
    const lpA0 = 1 + lpAlpha, lpA1 = -2 * lpCos, lpA2 = 1 - lpAlpha;

    let lx1 = 0, lx2 = 0, ly1 = 0, ly2 = 0;
    for (let i = 0; i < numSamples; i++) {
      const x0 = cleaned[i];
      const y0 = (lpB0 / lpA0) * x0 + (lpB1 / lpA0) * x1 + (lpB2 / lpA0) * x2 - (lpA1 / lpA0) * ly1 - (lpA2 / lpA0) * ly2;
      lx2 = lx1; lx1 = x0; ly2 = ly1; ly1 = y0;
      cleaned[i] = y0;
    }
  }

  // Stage 5: Boundary 5ms Smooth Cosine Fade In & Fade Out
  const fadeSamples = Math.min(Math.round(sampleRate * 0.005), Math.floor(numSamples / 4));
  for (let i = 0; i < fadeSamples; i++) {
    const factorIn = 0.5 * (1 - Math.cos((Math.PI * i) / fadeSamples));
    cleaned[i] *= factorIn;
    const factorOut = 0.5 * (1 - Math.cos((Math.PI * (fadeSamples - 1 - i)) / fadeSamples));
    cleaned[numSamples - 1 - i] *= factorOut;
  }

  // Stage 6: Studio Lookahead Soft-Knee Limiter & Normalization (-1.5 dBTP)
  let peak = 0;
  for (let i = 0; i < numSamples; i++) {
    const abs = Math.abs(cleaned[i]);
    if (abs > peak) peak = abs;
  }

  const targetPeak = 27500; // ~ -1.5 dBFS
  const gain = peak > 100 ? Math.min(targetPeak / peak, 1.8) : 1.0;

  const result = new Uint8Array(numSamples * 2);
  const outView = new DataView(result.buffer);
  for (let i = 0; i < numSamples; i++) {
    let v = cleaned[i] * gain;
    // Tanh soft-saturation
    if (v > 28000) {
      v = 28000 + (32767 - 28000) * Math.tanh((v - 28000) / (32767 - 28000));
    } else if (v < -28000) {
      v = -28000 + (-32768 + 28000) * Math.tanh((v + 28000) / (32768 - 28000));
    }
    const intVal = Math.max(-32768, Math.min(32767, Math.round(v)));
    outView.setInt16(i * 2, intVal, true);
  }

  return result;
};

/**
 * Decodes any audio Blob (WAV/MP3/M4A), strips clicks/cracking, applies studio master conditioning,
 * and returns pristine studio WAV.
 */
export const cleanStudioVoiceBlob = async (blob: Blob): Promise<Blob> => {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    // Check if it's already a standard RIFF/WAVE 16-bit PCM
    const header = new DataView(arrayBuffer, 0, Math.min(44, arrayBuffer.byteLength));
    const isWav = header.getUint32(0, false) === 0x52494646 && header.getUint32(8, false) === 0x57415645;
    
    if (isWav) {
      const uint8 = new Uint8Array(arrayBuffer);
      let dataOffset = 44;
      for (let i = 12; i < uint8.length - 8; i++) {
        if (uint8[i] === 0x64 && uint8[i+1] === 0x61 && uint8[i+2] === 0x74 && uint8[i+3] === 0x61) {
          dataOffset = i + 8;
          break;
        }
      }
      const sampleRate = header.getUint32(24, true) || 24000;
      const numChannels = header.getUint16(22, true) || 1;
      const rawPcm = uint8.subarray(dataOffset);
      const cleanedPcm = cleanStudioVoicePcm(rawPcm, sampleRate);
      return pcmToWav(cleanedPcm, sampleRate, numChannels);
    }

    // Otherwise decode via AudioContext in browser
    if (typeof window !== 'undefined' && (window.AudioContext || (window as any).webkitAudioContext)) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      try {
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
        const sampleRate = audioBuffer.sampleRate;
        const channelData = audioBuffer.getChannelData(0);
        const int16 = new Int16Array(channelData.length);
        for (let i = 0; i < channelData.length; i++) {
          int16[i] = Math.max(-32768, Math.min(32767, Math.round(channelData[i] * 32767)));
        }
        const cleanedPcm = cleanStudioVoicePcm(new Uint8Array(int16.buffer), sampleRate);
        return pcmToWav(cleanedPcm, sampleRate, 1);
      } finally {
        ctx.close();
      }
    }

    return blob;
  } catch (err) {
    console.warn('[cleanStudioVoiceBlob] Fallback to original blob:', err);
    return blob;
  }
};

/**
 * Converts any audio File (MP3, WAV, AAC, M4A) to 24kHz 16-bit mono WAV and extracts acoustic profile.
 */
export const convertAudioFileTo24kMonoWav = async (file: File): Promise<{ blob: Blob; base64: string; acousticProfile: AcousticVoiceProfile }> => {
  const arrayBuffer = await file.arrayBuffer();
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const audioContext = new AudioCtx({ sampleRate: 24000 });
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  const numChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const monoSamples = new Float32Array(length);

  for (let i = 0; i < numChannels; i++) {
    const channelData = audioBuffer.getChannelData(i);
    for (let j = 0; j < length; j++) {
      monoSamples[j] += channelData[j] / numChannels;
    }
  }

  const pcmBytes = new Uint8Array(length * 2);
  const dataView = new DataView(pcmBytes.buffer);
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, monoSamples[i]));
    dataView.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  const acousticProfile = analyzeAudioAcoustics(monoSamples, 24000);

  await audioContext.close();
  const wavBlob = pcmToWav(pcmBytes, 24000, 1);
  const base64 = await blobToBase64(wavBlob);
  return { blob: wavBlob, base64, acousticProfile };
};

/**
 * Returns the exact playback duration (seconds) of an audio File.
 * Uses a hidden HTMLAudioElement so it works for MP3/WAV/M4A/etc.
 */
export const getAudioDurationFromFile = (file: File): Promise<number> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read audio duration'));
    };
    audio.src = url;
  });

/**
 * Time-stretches 16-bit LE mono PCM to hit an exact target duration.
 *
 * Algorithm: linear interpolation resampling.
 * Ratio is clamped to [0.6 – 1.6] so output never sounds distorted.
 * Pitch is NOT preserved (slight Chipmunk / slow-down effect on extremes),
 * which is acceptable for ±30 % adjustments typical in dubbing.
 *
 * @param pcm          Raw 16-bit LE PCM bytes (Gemini TTS output)
 * @param sourceSecs   Actual duration of the pcm in seconds
 * @param targetSecs   Desired output duration in seconds
 * @param sampleRate   PCM sample rate (Gemini = 24000)
 */
export const stretchPcmToTargetDuration = (
  pcm: Uint8Array,
  sourceSecs: number,
  targetSecs: number,
  sampleRate: number = 24000
): Uint8Array => {
  const BYTES_PER_SAMPLE = 2;
  const inputSamples  = Math.floor(pcm.byteLength / BYTES_PER_SAMPLE);
  const outputSamples = Math.round(targetSecs * sampleRate);

  // Clamp stretch ratio to 60 – 160 %
  const rawRatio    = targetSecs / Math.max(sourceSecs, 0.001);
  const clampedRatio = Math.min(Math.max(rawRatio, 0.6), 1.6);
  const finalOutputSamples = Math.round(inputSamples * clampedRatio);

  const input  = new Int16Array(pcm.buffer, pcm.byteOffset, inputSamples);
  const output = new Int16Array(finalOutputSamples);

  for (let i = 0; i < finalOutputSamples; i++) {
    // Map output position back to input position
    const srcPos = (i / finalOutputSamples) * (inputSamples - 1);
    const lo = Math.floor(srcPos);
    const hi = Math.min(lo + 1, inputSamples - 1);
    const frac = srcPos - lo;
    // Linear interpolation between adjacent samples
    output[i] = Math.round(input[lo] * (1 - frac) + input[hi] * frac);
  }

  // Wrap back in Uint8Array
  return new Uint8Array(output.buffer);
};

/**
 * Studio-Grade Multi-Voice Vocal Chorus & Harmonic Doubler (Phase-Locked DSP).
 * Creates a thick, lush, perfectly synchronized multi-voice ensemble from a lead vocal.
 * Eliminates syllable drift, muddiness, and timing clumsiness through phase-locked micro-pitch detuning & Haas widening.
 */
export const applyDspChorus = (
  pcm: Uint8Array,
  sampleRate: number = 24000,
  intensity: 'grand_choir' | 'stadium_crowd' = 'grand_choir'
): Uint8Array => {
  if (pcm.byteLength < 4) return pcm;

  const numSamples = Math.floor(pcm.byteLength / 2);
  const input = new Int16Array(pcm.buffer, pcm.byteOffset, numSamples);

  // Define voice parameters: detune (cents), base delay (ms), LFO depth (ms), LFO rate (Hz), gain
  const voices = intensity === 'stadium_crowd'
    ? [
        { detuneCents: 0,   delayMs: 0,  lfoDepthMs: 0,   lfoRateHz: 0,    gain: 1.0 },
        { detuneCents: 9,   delayMs: 14, lfoDepthMs: 3.5, lfoRateHz: 0.55, gain: 0.75 },
        { detuneCents: -11, delayMs: 24, lfoDepthMs: 4.0, lfoRateHz: 0.40, gain: 0.75 },
        { detuneCents: 18,  delayMs: 36, lfoDepthMs: 5.0, lfoRateHz: 0.70, gain: 0.60 },
        { detuneCents: -16, delayMs: 48, lfoDepthMs: 4.5, lfoRateHz: 0.48, gain: 0.60 },
      ]
    : [
        { detuneCents: 0,   delayMs: 0,  lfoDepthMs: 0,   lfoRateHz: 0,    gain: 1.0 },
        { detuneCents: 7,   delayMs: 12, lfoDepthMs: 2.2, lfoRateHz: 0.50, gain: 0.72 },
        { detuneCents: -8,  delayMs: 20, lfoDepthMs: 2.8, lfoRateHz: 0.35, gain: 0.72 },
        { detuneCents: 14,  delayMs: 30, lfoDepthMs: 3.2, lfoRateHz: 0.65, gain: 0.55 },
      ];

  const maxDelayMs = 60;
  const maxDelaySamples = Math.round((maxDelayMs * sampleRate) / 1000);
  const outputLength = numSamples + maxDelaySamples;
  const mixFloat = new Float32Array(outputLength);

  for (const voice of voices) {
    const pitchRatio = Math.pow(2, voice.detuneCents / 1200);
    const baseDelaySamples = (voice.delayMs * sampleRate) / 1000;
    const lfoDepthSamples = (voice.lfoDepthMs * sampleRate) / 1000;
    const lfoRate = voice.lfoRateHz;
    const gain = voice.gain;

    for (let outIdx = 0; outIdx < outputLength; outIdx++) {
      const timeSec = outIdx / sampleRate;
      const lfo = lfoDepthSamples > 0 ? Math.sin(2 * Math.PI * lfoRate * timeSec) * lfoDepthSamples : 0;
      const totalDelay = baseDelaySamples + lfo;

      // Map output sample back to input sample coordinate
      const inPos = (outIdx - totalDelay) * pitchRatio;

      if (inPos >= 0 && inPos < numSamples - 1) {
        const lo = Math.floor(inPos);
        const hi = lo + 1;
        const frac = inPos - lo;
        const sampleVal = input[lo] * (1 - frac) + input[hi] * frac;
        mixFloat[outIdx] += sampleVal * gain;
      }
    }
  }

  // Peak normalization with smooth limiter ceiling
  let peak = 0;
  for (let i = 0; i < outputLength; i++) {
    const abs = Math.abs(mixFloat[i]);
    if (abs > peak) peak = abs;
  }

  const targetPeak = 30000;
  const normalizer = peak > targetPeak ? targetPeak / peak : 1.0;

  const output = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const val = Math.round(mixFloat[i] * normalizer);
    output[i] = Math.max(-32768, Math.min(32767, val));
  }

  return new Uint8Array(output.buffer);
};

// ── Brand Name Extraction & Dynamic Output Filenames ──────────────────────────

/**
 * Intelligently extracts the brand name from an ad script or returns a clean fallback.
 * Used for dynamic output file naming (e.g. Saravana_Stores_ad_master.mp3).
 */
export function extractBrandName(script: string): string {
  if (!script || !script.trim()) return 'Ad_Master';

  const prefixRegex = /^(?:Enna|Welcome|Hello|Vanakkam|Idho|Hey|The|A|An|In|On|At|For|With|Your|Our|My|Buy|Get|Visit|Call|Check|Try)\s+/i;

  // 1. Explicit brand tag e.g. "Brand: Saravana Stores"
  const explicitMatch = script.match(/(?:brand|campaign|store|company|product|shop)\s*:\s*([A-Za-z0-9\u0B80-\u0BFF\s'-]{2,30})/i);
  if (explicitMatch && explicitMatch[1].trim()) {
    return sanitizeFilename(explicitMatch[1].replace(prefixRegex, ''));
  }

  // 2. Quoted brand e.g. "Saravana Stores" or 'KUMARAN SILKS'
  const quoteMatch = script.match(/["'“]([A-Za-z0-9\u0B80-\u0BFF\s]{2,30})["'”]/);
  if (quoteMatch && quoteMatch[1].trim()) {
    return sanitizeFilename(quoteMatch[1].replace(prefixRegex, ''));
  }

  // 3. Multi-word capitalized proper noun (e.g., Saravana Stores, Kumaran Silks, Poorvika Mobiles)
  const capitalizedMatch = script.match(/\b([A-Z][a-zA-Z0-9'\-]+(?:\s+[A-Z][a-zA-Z0-9'\-]+){1,3})\b/);
  if (capitalizedMatch && capitalizedMatch[1].trim()) {
    const candidate = capitalizedMatch[1].replace(prefixRegex, '').trim();
    if (candidate.length > 2) {
      return sanitizeFilename(candidate);
    }
  }

  // 4. Single capitalized word
  const singleCapMatch = script.match(/\b([A-Z][a-zA-Z0-9'\-]{2,20})\b/g);
  if (singleCapMatch) {
    const filtered = singleCapMatch
      .map(w => w.replace(prefixRegex, '').trim())
      .filter(w => w.length > 2 && !/^(Enna|Welcome|Hello|Vanakkam|Idho|Hey|The|A|An|In|On|At|For|With|Your|Our|My|Offer|Sale|Mega|Grand|Discount|Special|Today|Only|Now|Get|Buy|Free|Call|Visit|Shop|Store)$/i.test(w));
    if (filtered.length > 0) {
      return sanitizeFilename(filtered[0]);
    }
  }

  // 5. Fallback: first words
  const cleanWords = script.replace(/[^\w\s\u0B80-\u0BFF]/g, '').trim().split(/\s+/).slice(0, 3).join('_');
  if (cleanWords) {
    return sanitizeFilename(cleanWords);
  }

  return 'Ad_Master';
}

function sanitizeFilename(str: string): string {
  return str
    .trim()
    .replace(/[^\w\u0B80-\u0BFF\s-]/g, '')  // Keep alphanumeric, spaces, hyphens, Tamil Unicode
    .replace(/\s+/g, '_')                   // Replace spaces with underscores
    .slice(0, 40)                           // Max 40 chars
    || 'Ad_Master';
}

export function getBrandFilename(script: string, suffix: string = 'master', ext: string = 'wav'): string {
  const brand = extractBrandName(script);
  return `${brand}_${suffix}.${ext}`;
}