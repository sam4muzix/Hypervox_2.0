import React, { useRef, useState, useEffect, useCallback } from 'react';
import { pcmToWav } from '../utils/audio';

interface AudioWaveformProps {
  file: File;
  onSliceChanged?: (slicedFile: File, startSec: number, endSec: number) => void;
}

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

  // Decode audio data into AudioBuffer
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
          setStartSec(0);
          // Default selection to either entire audio or up to 15 seconds
          const initialEnd = Math.min(dur, Math.max(3, Math.min(dur, 15)));
          setEndSec(initialEnd);
        },
        (err) => console.error('[Waveform] Decode error:', err)
      );
    });

    return () => {
      isCancelled = true;
      if (sourceNodeRef.current) {
        try { sourceNodeRef.current.stop(); } catch {}
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        try { audioCtxRef.current.close(); } catch {}
      }
      if (playbackAnimRef.current) {
        cancelAnimationFrame(playbackAnimRef.current);
      }
    };
  }, [file]);

  // Create and notify sliced file when range changes
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

  // Stop playback
  const stopPlayback = useCallback(() => {
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch {}
      sourceNodeRef.current = null;
    }
    if (playbackAnimRef.current) {
      cancelAnimationFrame(playbackAnimRef.current);
      playbackAnimRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  // Play selected slice or pause
  const togglePlaySelected = useCallback(() => {
    if (!audioBuffer) return;

    if (isPlaying) {
      stopPlayback();
      return;
    }

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
  }, [audioBuffer, isPlaying, startSec, endSec, stopPlayback]);

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Compute peaks from channel data
    const channelData = audioBuffer.getChannelData(0);
    const step = Math.ceil(channelData.length / width);
    const amp = height / 2;

    // Draw background grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, amp);
    ctx.lineTo(width, amp);
    ctx.stroke();

    // Waveform bars
    ctx.fillStyle = 'rgba(168, 85, 247, 0.4)'; // purple-500 unselected
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

    // Draw selected region highlight
    if (duration > 0) {
      const xStart = (startSec / duration) * width;
      const xEnd = (endSec / duration) * width;

      // Selection overlay
      ctx.fillStyle = 'rgba(168, 85, 247, 0.2)';
      ctx.fillRect(xStart, 0, xEnd - xStart, height);

      // Selected waveform re-draw in vivid color
      ctx.fillStyle = '#c084fc'; // purple-400
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

      // Left bracket boundary
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(xStart, 0);
      ctx.lineTo(xStart, height);
      ctx.moveTo(xEnd, 0);
      ctx.lineTo(xEnd, height);
      ctx.stroke();

      // Handles
      ctx.fillStyle = '#ec4899';
      ctx.fillRect(xStart - 3, 0, 6, 12);
      ctx.fillRect(xStart - 3, height - 12, 6, 12);
      ctx.fillRect(xEnd - 3, 0, 6, 12);
      ctx.fillRect(xEnd - 3, height - 12, 6, 12);

      // Playhead position
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

  // Mouse interaction on canvas
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!duration || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickSec = (clickX / rect.width) * duration;

    const distToStart = Math.abs(clickSec - startSec);
    const distToEnd = Math.abs(clickSec - endSec);

    if (distToStart < distToEnd && distToStart < duration * 0.15) {
      isDraggingStart.current = true;
    } else if (distToEnd < duration * 0.15) {
      isDraggingEnd.current = true;
    } else {
      // Clicked inside or outside: reposition start
      if (clickSec < endSec) {
        setStartSec(Math.max(0, clickSec));
      } else {
        setEndSec(Math.min(duration, clickSec));
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!duration || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const curSec = Math.max(0, Math.min(duration, ((e.clientX - rect.left) / rect.width) * duration));

    if (isDraggingStart.current) {
      if (curSec < endSec - 0.5) {
        setStartSec(curSec);
      }
    } else if (isDraggingEnd.current) {
      if (curSec > startSec + 0.5) {
        setEndSec(curSec);
      }
    }
  };

  const handleMouseUp = () => {
    isDraggingStart.current = false;
    isDraggingEnd.current = false;
  };

  const selectedDuration = Math.max(0, endSec - startSec);

  return (
    <div className="w-full bg-black/70 border border-purple-500/30 rounded-xl p-3 space-y-2 mt-2 select-none">
      <div className="flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); togglePlaySelected(); }}
            className={`px-2.5 py-1 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm ${
              isPlaying
                ? 'bg-amber-500 hover:bg-amber-400 text-black'
                : 'bg-purple-600 hover:bg-purple-500 text-white'
            }`}
          >
            {isPlaying ? (
              <>
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
                <span>Pause Selected</span>
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
          <span className="text-gray-300 font-mono text-[11px]">
            {startSec.toFixed(1)}s – {endSec.toFixed(1)}s
          </span>
          <span className="text-purple-300 font-semibold bg-purple-950/80 border border-purple-500/30 px-1.5 py-0.5 rounded text-[10px]">
            {selectedDuration.toFixed(1)}s selected
          </span>
        </div>
        <span className="text-gray-400 text-[10px] hidden sm:inline">
          Drag handles or scrub range to extract target timbre (ideal: 3–15s)
        </span>
      </div>

      <div className="relative w-full h-16 bg-purple-950/20 rounded-lg overflow-hidden border border-purple-500/20">
        <canvas
          ref={canvasRef}
          width={640}
          height={64}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="w-full h-full cursor-crosshair block"
        />
      </div>
    </div>
  );
};
