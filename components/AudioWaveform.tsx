import React, { useRef, useState, useEffect, useCallback } from 'react';
import { pcmToWav } from '../utils/audio';

interface AudioWaveformProps {
  file: File;
  onSliceChanged?: (slicedFile: File, startSec: number, endSec: number) => void;
}

const MIN_SELECTION_SEC = 3.0;
const MAX_SELECTION_SEC = 6.0;
const DEFAULT_SELECTION_SEC = 4.5;

export const AudioWaveform: React.FC<AudioWaveformProps> = ({ file, onSliceChanged }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [duration, setDuration] = useState<number>(0);
  const [startSec, setStartSec] = useState<number>(0);
  const [endSec, setEndSec] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackPos, setPlaybackPos] = useState<number>(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const isDraggingStart = useRef<boolean>(false);
  const isDraggingEnd = useRef<boolean>(false);
  const playbackAnimRef = useRef<number | null>(null);
  const playbackStartTimeRef = useRef<number>(0);
  const playbackStartOffsetRef = useRef<number>(0);

  // Stop playback cleanly
  const stopPlayback = useCallback(() => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch {}
      sourceNodeRef.current = null;
    }
    if (playbackAnimRef.current) {
      cancelAnimationFrame(playbackAnimRef.current);
      playbackAnimRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  // Play ONLY the selected slice [startSec, endSec]
  const playSelectedSlice = useCallback(() => {
    if (!audioBuffer) return;

    stopPlayback();

    let ctx = audioCtxRef.current;
    if (!ctx || ctx.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      ctx = new AudioCtx();
      audioCtxRef.current = ctx;
    }
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const playDuration = Math.max(0.1, endSec - startSec);
    source.start(0, startSec, playDuration);
    sourceNodeRef.current = source;
    setIsPlaying(true);

    playbackStartTimeRef.current = ctx.currentTime;
    playbackStartOffsetRef.current = startSec;

    const trackProgress = () => {
      if (!ctx) return;
      const elapsed = ctx.currentTime - playbackStartTimeRef.current;
      const currentPos = playbackStartOffsetRef.current + elapsed;
      if (currentPos >= endSec) {
        setIsPlaying(false);
        setPlaybackPos(startSec);
        return;
      }
      setPlaybackPos(currentPos);
      playbackAnimRef.current = requestAnimationFrame(trackProgress);
    };
    playbackAnimRef.current = requestAnimationFrame(trackProgress);

    source.onended = () => {
      setIsPlaying(false);
      setPlaybackPos(startSec);
      if (playbackAnimRef.current) {
        cancelAnimationFrame(playbackAnimRef.current);
      }
    };
  }, [audioBuffer, startSec, endSec, stopPlayback]);

  // Decode audio data into AudioBuffer and initialize 3 to 6 sec selection window
  useEffect(() => {
    let isCancelled = false;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    audioCtxRef.current = ctx;

    file.arrayBuffer().then((buffer) => {
      ctx.decodeAudioData(
        buffer,
        (decoded) => {
          if (isCancelled) return;
          setAudioBuffer(decoded);
          const dur = decoded.duration;
          setDuration(dur);

          // Default selection to 3-6 seconds (default 4.5s)
          const initialLen = Math.min(dur, Math.max(Math.min(dur, MIN_SELECTION_SEC), DEFAULT_SELECTION_SEC));
          setStartSec(0);
          setEndSec(initialLen);
        },
        (err) => console.error('[Waveform] Decode error:', err)
      );
    });

    return () => {
      isCancelled = true;
      stopPlayback();
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        try {
          audioCtxRef.current.close();
        } catch {}
      }
    };
  }, [file, stopPlayback]);

  // Create and notify sliced file when selection range changes
  const sliceAndNotify = useCallback((start: number, end: number, buffer: AudioBuffer) => {
    const sampleRate = buffer.sampleRate;
    const startOffset = Math.max(0, Math.floor(start * sampleRate));
    const endOffset = Math.min(buffer.length, Math.floor(end * sampleRate));
    const frameCount = Math.max(1, endOffset - startOffset);

    const numChannels = buffer.numberOfChannels;
    const monoSamples = new Float32Array(frameCount);

    for (let ch = 0; ch < numChannels; ch++) {
      const channelData = buffer.getChannelData(ch);
      for (let i = 0; i < frameCount; i++) {
        monoSamples[i] += channelData[startOffset + i] / numChannels;
      }
    }

    const pcmBytes = new Uint8Array(frameCount * 2);
    const dataView = new DataView(pcmBytes.buffer);
    for (let i = 0; i < frameCount; i++) {
      const s = Math.max(-1, Math.min(1, monoSamples[i]));
      dataView.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    const wavBlob = pcmToWav(pcmBytes, sampleRate, 1);
    const slicedFile = new File([wavBlob], `selected_${file.name.replace(/\.[^.]+$/, '')}.wav`, { type: 'audio/wav' });
    onSliceChanged?.(slicedFile, start, end);
  }, [file.name, onSliceChanged]);

  useEffect(() => {
    if (audioBuffer && endSec > startSec) {
      sliceAndNotify(startSec, endSec, audioBuffer);
    }
  }, [audioBuffer, startSec, endSec, sliceAndNotify]);

  // Set preset duration window (3s, 4s, 5s, 6s)
  const applyPresetDuration = (targetDurationSec: number) => {
    if (!duration) return;
    const maxDur = Math.min(duration, targetDurationSec);
    let newStart = startSec;
    let newEnd = newStart + maxDur;
    if (newEnd > duration) {
      newEnd = duration;
      newStart = Math.max(0, newEnd - maxDur);
    }
    setStartSec(newStart);
    setEndSec(newEnd);
  };

  // Draw waveform with vivid 3-6s selected area
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const channelData = audioBuffer.getChannelData(0);
    const step = Math.ceil(channelData.length / width);
    const amp = height / 2;

    // Background center line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, amp);
    ctx.lineTo(width, amp);
    ctx.stroke();

    // Dimmed full waveform
    ctx.fillStyle = 'rgba(168, 85, 247, 0.25)';
    for (let i = 0; i < width; i++) {
      let min = 1.0;
      let max = -1.0;
      const startIdx = i * step;
      const endIdx = Math.min(startIdx + step, channelData.length);
      for (let j = startIdx; j < endIdx; j++) {
        const datum = channelData[j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      const y1 = Math.max(2, (1 + min) * amp);
      const y2 = Math.min(height - 2, (1 + max) * amp);
      ctx.fillRect(i, y1, 1, Math.max(1, y2 - y1));
    }

    // Highlighted 3-6s selected region
    if (duration > 0) {
      const xStart = (startSec / duration) * width;
      const xEnd = (endSec / duration) * width;

      // Selection background tint
      ctx.fillStyle = 'rgba(16, 185, 129, 0.2)';
      ctx.fillRect(xStart, 0, xEnd - xStart, height);

      // Selected waveform re-draw in vivid emerald
      ctx.fillStyle = '#34d399';
      for (let i = Math.floor(xStart); i <= Math.ceil(xEnd); i++) {
        let min = 1.0;
        let max = -1.0;
        const startIdx = i * step;
        const endIdx = Math.min(startIdx + step, channelData.length);
        for (let j = startIdx; j < endIdx; j++) {
          const datum = channelData[j];
          if (datum < min) min = datum;
          if (datum > max) max = datum;
        }
        const y1 = Math.max(2, (1 + min) * amp);
        const y2 = Math.min(height - 2, (1 + max) * amp);
        ctx.fillRect(i, y1, 1, Math.max(1, y2 - y1));
      }

      // Left & right bracket boundaries
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(xStart, 0);
      ctx.lineTo(xStart, height);
      ctx.moveTo(xEnd, 0);
      ctx.lineTo(xEnd, height);
      ctx.stroke();

      // Handles
      ctx.fillStyle = '#10b981';
      ctx.fillRect(xStart - 4, 0, 8, 14);
      ctx.fillRect(xStart - 4, height - 14, 8, 14);
      ctx.fillRect(xEnd - 4, 0, 8, 14);
      ctx.fillRect(xEnd - 4, height - 14, 8, 14);

      // Playhead indicator
      if (isPlaying && playbackPos >= startSec && playbackPos <= endSec) {
        const xPos = (playbackPos / duration) * width;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(xPos, 0);
        ctx.lineTo(xPos, height);
        ctx.stroke();
      }
    }
  }, [audioBuffer, duration, startSec, endSec, isPlaying, playbackPos]);

  // Click on selected part -> PLAYS ONLY THE SELECTED PART
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!duration || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickSec = (clickX / rect.width) * duration;

    // Check if clicked INSIDE the selected part
    if (clickSec >= startSec && clickSec <= endSec) {
      if (isPlaying) {
        stopPlayback();
      } else {
        playSelectedSlice();
      }
      return;
    }

    // Clicked outside: reposition selection window around clickSec (maintain 3-6s duration)
    const currentLen = Math.max(MIN_SELECTION_SEC, Math.min(MAX_SELECTION_SEC, endSec - startSec));
    let newStart = Math.max(0, clickSec - currentLen / 2);
    let newEnd = newStart + currentLen;
    if (newEnd > duration) {
      newEnd = duration;
      newStart = Math.max(0, newEnd - currentLen);
    }
    setStartSec(newStart);
    setEndSec(newEnd);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!duration || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickSec = (clickX / rect.width) * duration;

    const distToStart = Math.abs(clickSec - startSec);
    const distToEnd = Math.abs(clickSec - endSec);
    const handleThreshold = duration * 0.05;

    if (distToStart < handleThreshold) {
      isDraggingStart.current = true;
    } else if (distToEnd < handleThreshold) {
      isDraggingEnd.current = true;
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!duration || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const curSec = Math.max(0, Math.min(duration, ((e.clientX - rect.left) / rect.width) * duration));

    if (isDraggingStart.current) {
      const allowedStart = Math.max(0, Math.min(curSec, endSec - MIN_SELECTION_SEC));
      const clampedStart = Math.max(allowedStart, endSec - MAX_SELECTION_SEC);
      setStartSec(clampedStart);
    } else if (isDraggingEnd.current) {
      const allowedEnd = Math.min(duration, Math.max(curSec, startSec + MIN_SELECTION_SEC));
      const clampedEnd = Math.min(allowedEnd, startSec + MAX_SELECTION_SEC);
      setEndSec(clampedEnd);
    }
  };

  const handleMouseUp = () => {
    isDraggingStart.current = false;
    isDraggingEnd.current = false;
  };

  const selectedDuration = Math.max(0, endSec - startSec);

  return (
    <div className="w-full bg-black/80 border border-emerald-500/30 rounded-xl p-3.5 space-y-3 mt-2 select-none shadow-[0_0_20px_rgba(16,185,129,0.08)]">
      {/* Selection Control Bar & Quick Duration Presets */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          {/* Play/Pause Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (isPlaying) {
                stopPlayback();
              } else {
                playSelectedSlice();
              }
            }}
            className={`px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-md ${
              isPlaying
                ? 'bg-amber-400 hover:bg-amber-300 text-black'
                : 'bg-emerald-500 hover:bg-emerald-400 text-black'
            }`}
            title="Click to play only the selected 3-6s slice"
          >
            {isPlaying ? (
              <>
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
                <span>Pause</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                <span>Play Selected</span>
              </>
            )}
          </button>

          {/* Time Readout */}
          <span className="text-gray-300 font-mono text-xs">
            {startSec.toFixed(1)}s – {endSec.toFixed(1)}s
          </span>

          <span className="text-emerald-300 font-mono font-bold bg-emerald-950/80 border border-emerald-500/30 px-2 py-0.5 rounded text-[11px]">
            {selectedDuration.toFixed(1)}s sample
          </span>
        </div>

        {/* 3 to 6 Seconds Quick Preset Selectors */}
        <div className="flex items-center gap-1.5">
          <span className="text-gray-400 text-[10px] uppercase font-mono mr-1 hidden sm:inline">Slice:</span>
          {[3.0, 4.0, 5.0, 6.0].map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => applyPresetDuration(sec)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold transition-all cursor-pointer ${
                Math.abs(selectedDuration - sec) < 0.25
                  ? 'bg-emerald-500 text-black shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                  : 'bg-white/10 hover:bg-white/20 text-gray-300'
              }`}
            >
              {sec.toFixed(0)}s
            </button>
          ))}
        </div>
      </div>

      {/* Interactive Waveform Canvas */}
      <div className="relative w-full h-16 bg-[#030c06] rounded-lg overflow-hidden border border-emerald-500/20 group">
        <canvas
          ref={canvasRef}
          width={640}
          height={64}
          onClick={handleCanvasClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="w-full h-full cursor-pointer block"
          title="Click inside selected area to play only the selected part; drag handles to trim 3-6s"
        />
        <div className="absolute bottom-1 right-2 pointer-events-none text-[9px] font-mono text-emerald-400/60 uppercase">
          Click selected part to play • 3s–6s slice
        </div>
      </div>
    </div>
  );
};

export default AudioWaveform;
