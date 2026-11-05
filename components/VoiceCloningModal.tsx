import React, { useRef, useState } from 'react';
import { AudioWaveform } from './AudioWaveform';

export interface VoiceCloningModalProps {
  isOpen: boolean;
  onClose: () => void;
  referenceVoiceFile: File | null;
  setReferenceVoiceFile: (file: File | null) => void;
  slicedReferenceVoiceFile: File | null;
  setSlicedReferenceVoiceFile: (file: File | null) => void;
  sourceVoiceFile: File | null;
  setSourceVoiceFile: (file: File | null) => void;
  clonedAudioUrl: string | null;
  setClonedAudioUrl: (url: string | null) => void;
  isCloning: boolean;
  isConvertingVc: boolean;
  cloneProgress: { current: number; total: number };
  cloneError: string | null;
  handleVoiceToVoice: () => void;
  handleCloneVoice: () => void;
  script: string;
  audioUrl: string | null;
}

export const VoiceCloningModal: React.FC<VoiceCloningModalProps> = ({
  isOpen,
  onClose,
  referenceVoiceFile,
  setReferenceVoiceFile,
  slicedReferenceVoiceFile,
  setSlicedReferenceVoiceFile,
  sourceVoiceFile,
  setSourceVoiceFile,
  clonedAudioUrl,
  setClonedAudioUrl,
  isCloning,
  isConvertingVc,
  cloneProgress,
  cloneError,
  handleVoiceToVoice,
  handleCloneVoice,
  script,
  audioUrl,
}) => {
  const [isDraggingRef, setIsDraggingRef] = useState(false);
  const [isDraggingSource, setIsDraggingSource] = useState(false);
  const refVoiceInputRef = useRef<HTMLInputElement | null>(null);
  const sourceVoiceInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const handleReferenceFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setReferenceVoiceFile(file);
      setSlicedReferenceVoiceFile(file);
      if (clonedAudioUrl) {
        URL.revokeObjectURL(clonedAudioUrl);
        setClonedAudioUrl(null);
      }
    }
    e.target.value = '';
  };

  const handleSourceFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSourceVoiceFile(file);
    }
    e.target.value = '';
  };

  const handleDropReference = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingRef(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setReferenceVoiceFile(file);
      setSlicedReferenceVoiceFile(file);
      if (clonedAudioUrl) {
        URL.revokeObjectURL(clonedAudioUrl);
        setClonedAudioUrl(null);
      }
    }
  };

  const handleDropSource = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingSource(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setSourceVoiceFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-2xl bg-zinc-950/95 border border-purple-500/40 rounded-2xl shadow-2xl p-6 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-purple-500/20 pb-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.083-1.638.24-2.416.234-.847 1.058-1.354 1.938-1.354h2.24z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-white font-bold text-base tracking-wide">
                  Voice Conversion Studio
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/30 text-purple-300 font-mono font-bold">
                  Zero-Shot Voice Conversion
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                Convert any spoken speech directly into your uploaded reference speaker sample
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Modal Body */}
        <div className="space-y-4 overflow-y-auto pr-1 custom-scrollbar flex-1">
          {/* Target Voice Sample */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-purple-300 uppercase tracking-wider flex items-center gap-2">
                <span>Target Voice Sample (User Given Voice)</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/30 text-purple-200">Required</span>
              </label>
            </div>

            {referenceVoiceFile ? (
              <div className="space-y-3">
                <div
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingRef(true); }}
                  onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingRef(true); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingRef(false); }}
                  onDrop={handleDropReference}
                  className={`bg-black/50 border rounded-xl p-3 flex items-center justify-between gap-3 ${
                    isDraggingRef ? 'border-purple-400 ring-2 ring-purple-400/50' : 'border-purple-500/40'
                  }`}
                >
                  <div className="min-w-0 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-400 flex-shrink-0">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                      </svg>
                    </div>
                    <div className="truncate">
                      <p className="text-xs font-semibold text-white truncate">{referenceVoiceFile.name}</p>
                      <p className="text-[10px] text-gray-400 font-mono">
                        {(referenceVoiceFile.size / 1024 / 1024).toFixed(2)} MB • Target Speaker Timbre
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => refVoiceInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
                    >
                      Change
                    </button>
                    <button
                      onClick={() => {
                        setReferenceVoiceFile(null);
                        setSlicedReferenceVoiceFile(null);
                        if (clonedAudioUrl) {
                          URL.revokeObjectURL(clonedAudioUrl);
                          setClonedAudioUrl(null);
                        }
                      }}
                      className="w-7 h-7 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Waveform Slice Selector */}
                <AudioWaveform
                  file={referenceVoiceFile}
                  onSliceChanged={(slicedFile) => setSlicedReferenceVoiceFile(slicedFile)}
                />
              </div>
            ) : (
              <div
                onClick={() => refVoiceInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingRef(true); }}
                onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingRef(true); }}
                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingRef(false); }}
                onDrop={handleDropReference}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                  isDraggingRef
                    ? 'border-purple-400 bg-purple-950/40 ring-4 ring-purple-500/20'
                    : 'border-purple-500/30 hover:border-purple-400/70 bg-purple-950/10 hover:bg-purple-950/20'
                }`}
              >
                <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 mx-auto flex items-center justify-center mb-2">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-white">Click or Drop Target Voice Sample</p>
                <p className="text-xs text-gray-400 mt-1">Supports MP3, WAV, M4A, FLAC, WebM (clean speech sample)</p>
              </div>
            )}
            <input
              ref={refVoiceInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.webm"
              onChange={handleReferenceFileSelect}
              className="hidden"
            />
          </div>

          {/* Source Audio to Convert */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>Source Audio to Convert (Voice-to-Voice)</span>
              </label>
              <button
                type="button"
                onClick={() => sourceVoiceInputRef.current?.click()}
                className="text-[11px] text-purple-400 hover:text-purple-300 underline font-medium cursor-pointer"
              >
                Upload External Audio
              </button>
            </div>

            {sourceVoiceFile ? (
              <div className="bg-black/40 border border-purple-500/30 rounded-xl p-3 flex items-center justify-between">
                <div className="min-w-0 flex items-center gap-2.5">
                  <span className="text-xs text-emerald-400 font-bold">✓</span>
                  <p className="text-xs text-white truncate font-medium">{sourceVoiceFile.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSourceVoiceFile(null)}
                  className="text-xs text-gray-400 hover:text-red-400 font-medium"
                >
                  Clear
                </button>
              </div>
            ) : (
              <div
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingSource(true); }}
                onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingSource(true); }}
                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingSource(false); }}
                onDrop={handleDropSource}
                className={`bg-black/30 border rounded-xl p-3 flex items-center justify-between text-xs text-gray-400 transition-all ${
                  isDraggingSource ? 'border-purple-400 ring-2 ring-purple-400/50 bg-purple-950/30' : 'border-white/10'
                }`}
              >
                <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                  <span>✓</span>
                  <span>{audioUrl ? 'Using Current Generated Spot Audio' : 'Ready (Generates Spot Audio automatically)'}</span>
                </div>
                <span className="text-[10px] text-gray-500 font-mono">Drop file to override</span>
              </div>
            )}
            <input
              ref={sourceVoiceInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.webm"
              onChange={handleSourceFileSelect}
              className="hidden"
            />
          </div>

          {cloneError && (
            <div className="p-3 bg-red-950/60 border border-red-500/40 text-red-200 text-xs rounded-xl">
              {cloneError}
            </div>
          )}

          {/* Engine Status */}
          <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-purple-950/30 border border-purple-500/20 text-[11px] font-mono">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse" />
              <span className="text-gray-300">Neural Engine:</span>
              <span className="text-purple-300 font-bold">Voice Conversion Neural Flow (Zero-Shot)</span>
            </div>
            <span className="text-emerald-400/90 text-[10px] font-semibold">Studio Clean 3s–6s Target Sample</span>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <button
              onClick={handleVoiceToVoice}
              disabled={isConvertingVc || isCloning || !referenceVoiceFile || (!sourceVoiceFile && !audioUrl)}
              className={`py-3 px-4 rounded-xl font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
                isConvertingVc || isCloning || !referenceVoiceFile || (!sourceVoiceFile && !audioUrl)
                  ? 'bg-purple-950/30 text-gray-500 border border-purple-500/20 cursor-not-allowed'
                  : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-lg cursor-pointer ring-1 ring-purple-400/50'
              }`}
            >
              {isConvertingVc ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Converting Voice-to-Voice...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.083-1.638.24-2.416.234-.847 1.058-1.354 1.938-1.354h2.24z" />
                  </svg>
                  <span>Voice to Voice Convert</span>
                </>
              )}
            </button>

            <button
              onClick={handleCloneVoice}
              disabled={isCloning || isConvertingVc || !referenceVoiceFile || !script.trim()}
              className={`py-3 px-4 rounded-xl font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
                isCloning || isConvertingVc || !referenceVoiceFile || !script.trim()
                  ? 'bg-white/5 text-gray-500 border border-white/5 cursor-not-allowed'
                  : 'bg-white/10 hover:bg-white/20 text-white border border-white/20 hover:border-purple-400 cursor-pointer'
              }`}
            >
              {isCloning ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Cloning Script Text...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                  </svg>
                  <span>Clone Script (Text to Voice)</span>
                </>
              )}
            </button>
          </div>

          {/* Progress status */}
          {(isCloning || isConvertingVc) && cloneProgress.total > 0 && (
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-[11px] font-mono text-purple-300">
                <span>{isCloning ? 'Generating Script & Timbre Transfer...' : 'Running Voice Conversion Flow...'}</span>
                <span>{cloneProgress.current}/{cloneProgress.total}</span>
              </div>
              <div className="w-full bg-black/60 rounded-full h-1.5 overflow-hidden border border-purple-500/20">
                <div
                  className="bg-gradient-to-r from-purple-500 to-indigo-500 h-full transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.round((cloneProgress.current / cloneProgress.total) * 100))}%` }}
                />
              </div>
            </div>
          )}

          {/* Cloned Audio Preview inside modal */}
          {clonedAudioUrl && (
            <div className="mt-3 p-3.5 bg-purple-950/40 border border-purple-500/30 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-purple-300">Cloned Audio Output</span>
                <span className="text-[10px] text-emerald-400 font-mono font-semibold">Ready</span>
              </div>
              <audio controls src={clonedAudioUrl} className="w-full custom-audio-player" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

