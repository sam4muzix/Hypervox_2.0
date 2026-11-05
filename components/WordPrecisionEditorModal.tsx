import React, { useState, useRef, useEffect } from 'react';
import { VoiceOption, Emotion, Dialect, SpeechPacing } from '../types';
import { generateSpotAudio } from '../services/geminiService';

export interface WordPrecisionEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  script: string;
  audioUrl: string | null;
  voice: VoiceOption;
  emotion: Emotion;
  dialect: Dialect;
  pacing: SpeechPacing;
  onApplyMasterEdit: (newBlob: Blob, newScript: string) => void;
}

interface WordToken {
  id: number;
  word: string;
  isWord: boolean;
}

export const WordPrecisionEditorModal: React.FC<WordPrecisionEditorModalProps> = ({
  isOpen,
  onClose,
  script,
  audioUrl,
  voice,
  emotion,
  dialect,
  pacing,
  onApplyMasterEdit,
}) => {
  const [tokens, setTokens] = useState<WordToken[]>([]);
  const [selectedWordIndex, setSelectedWordIndex] = useState<number | null>(null);
  const [replacementWord, setReplacementWord] = useState<string>('');
  const [phoneticHint, setPhoneticHint] = useState<string>('');
  const [isInpainting, setIsInpainting] = useState<boolean>(false);
  const [inpaintedAudioUrl, setInpaintedAudioUrl] = useState<string | null>(null);
  const [inpaintedBlob, setInpaintedBlob] = useState<Blob | null>(null);
  const [updatedScript, setUpdatedScript] = useState<string>(script);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [previewTab, setPreviewTab] = useState<'inpainted' | 'original'>('inpainted');

  // Tokenize script when modal opens
  useEffect(() => {
    if (isOpen && script) {
      const parts = script.split(/(\s+)/);
      const parsed: WordToken[] = parts.map((part, idx) => ({
        id: idx,
        word: part,
        isWord: !/^\s+$/.test(part) && part.length > 0,
      }));
      setTokens(parsed);
      setSelectedWordIndex(null);
      setReplacementWord('');
      setPhoneticHint('');
      setInpaintedAudioUrl(null);
      setInpaintedBlob(null);
      setUpdatedScript(script);
      setEditorError(null);
    }
  }, [isOpen, script]);

  if (!isOpen) return null;

  const handleSelectWord = (token: WordToken) => {
    if (!token.isWord) return;
    setSelectedWordIndex(token.id);
    setReplacementWord(token.word);
    setEditorError(null);
  };

  const handleInpaintWord = async () => {
    if (selectedWordIndex === null || !replacementWord.trim()) {
      setEditorError('Please select a word to replace and provide the new word.');
      return;
    }

    setIsInpainting(true);
    setEditorError(null);

    try {
      // 1. Construct modified script
      const modifiedTokens = tokens.map(t => (t.id === selectedWordIndex ? { ...t, word: replacementWord.trim() } : t));
      const newScriptText = modifiedTokens.map(t => t.word).join('');
      setUpdatedScript(newScriptText);

      // 2. Synthesize with exact voice, dialect, and phonetic guidance
      const guidance = phoneticHint.trim()
        ? `PRONUNCIATION ENFORCEMENT: Enunciate '${replacementWord.trim()}' with: ${phoneticHint.trim()}`
        : `Crisp, clear studio pronunciation of '${replacementWord.trim()}'.`;

      const newBlob = await generateSpotAudio(
        newScriptText,
        voice,
        emotion,
        dialect,
        false,
        guidance,
        undefined,
        pacing
      );

      if (inpaintedAudioUrl) URL.revokeObjectURL(inpaintedAudioUrl);
      const newUrl = URL.createObjectURL(newBlob);
      setInpaintedAudioUrl(newUrl);
      setInpaintedBlob(newBlob);
      setPreviewTab('inpainted');
    } catch (err: any) {
      console.error('[WordEditor] Inpainting error:', err);
      setEditorError(err.message || 'Failed to inpaint word.');
    } finally {
      setIsInpainting(false);
    }
  };

  const handleApplyToMaster = () => {
    if (inpaintedBlob && updatedScript) {
      onApplyMasterEdit(inpaintedBlob, updatedScript);
      onClose();
    }
  };

  const selectedToken = selectedWordIndex !== null ? tokens.find(t => t.id === selectedWordIndex) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-3xl bg-zinc-950/95 border border-emerald-500/40 rounded-2xl shadow-2xl p-6 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-emerald-500/20 pb-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-white font-bold text-base tracking-wide">
                  Word Precision Voice & Audio Inpainting
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/30 text-emerald-300 font-mono font-bold">
                  In-Place Editing
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                Select any word in the generated audio to rewrite, correct phonetics, or replace in-place
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

        {/* Modal Body */}
        <div className="space-y-4 overflow-y-auto pr-1 custom-scrollbar flex-1">
          {/* Step 1: Clickable Script Word Chips */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                <span>1. Select Word from Script to Modify</span>
                <span className="text-[10px] text-gray-400 font-normal font-sans">(Click any word chip)</span>
              </label>
              {selectedToken && (
                <span className="text-xs text-emerald-300 font-mono font-semibold">
                  Selected: <span className="underline decoration-emerald-400 font-bold">"{selectedToken.word}"</span>
                </span>
              )}
            </div>

            <div className="p-4 bg-black/50 border border-white/10 rounded-xl max-h-48 overflow-y-auto flex flex-wrap gap-1.5 custom-scrollbar leading-relaxed">
              {tokens.map((token) => {
                if (!token.isWord) {
                  return <span key={token.id} className="whitespace-pre">{token.word}</span>;
                }
                const isSelected = selectedWordIndex === token.id;
                return (
                  <button
                    key={token.id}
                    onClick={() => handleSelectWord(token)}
                    className={`px-2 py-1 rounded-lg text-xs font-medium transition-all select-none cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-500 text-black font-bold shadow-lg ring-2 ring-emerald-400 scale-105'
                        : 'bg-white/5 hover:bg-white/15 text-gray-200 border border-white/5 hover:border-emerald-500/40'
                    }`}
                  >
                    {token.word}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2: Edit & Phonetic Replacement Inputs */}
          {selectedToken ? (
            <div className="p-4 bg-zinc-900/80 border border-emerald-500/30 rounded-xl space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-gray-300 uppercase mb-1">
                    Replacement Word / Spelling
                  </label>
                  <input
                    type="text"
                    value={replacementWord}
                    onChange={(e) => setReplacementWord(e.target.value)}
                    placeholder="Enter new word..."
                    className="w-full bg-black/60 border border-white/15 focus:border-emerald-500 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-300 uppercase mb-1">
                    Phonetic / Pronunciation Hint (Optional)
                  </label>
                  <input
                    type="text"
                    value={phoneticHint}
                    onChange={(e) => setPhoneticHint(e.target.value)}
                    placeholder="e.g. pronounce with crisp R, not L"
                    className="w-full bg-black/60 border border-white/15 focus:border-emerald-500 rounded-lg px-3 py-2 text-white text-xs focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-gray-400">
                  Voice: <span className="text-white font-semibold">{voice.name}</span> • Dialect: <span className="text-white font-semibold">{dialect}</span>
                </span>

                <button
                  onClick={handleInpaintWord}
                  disabled={isInpainting || !replacementWord.trim()}
                  className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer ${
                    isInpainting || !replacementWord.trim()
                      ? 'bg-emerald-950/40 text-gray-500 border border-emerald-500/20 cursor-not-allowed'
                      : 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-lg ring-1 ring-emerald-400/50'
                  }`}
                >
                  {isInpainting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                      <span>Inpainting Word...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                      </svg>
                      <span>Inpaint & Replace Word</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-black/30 border border-dashed border-white/10 rounded-xl text-center text-xs text-gray-400">
              Select any word above to open the in-place word editor controls.
            </div>
          )}

          {editorError && (
            <div className="p-3 bg-red-950/60 border border-red-500/40 text-red-200 text-xs rounded-xl">
              {editorError}
            </div>
          )}

          {/* Step 3: A/B Audio Comparison & Master Apply */}
          {inpaintedAudioUrl && (
            <div className="p-4 bg-emerald-950/30 border border-emerald-500/40 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPreviewTab('inpainted')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                      previewTab === 'inpainted'
                        ? 'bg-emerald-500 text-black shadow-sm'
                        : 'bg-black/40 text-gray-400 hover:text-white'
                    }`}
                  >
                    ▶ Inpainted Audio Preview
                  </button>
                  <button
                    onClick={() => setPreviewTab('original')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                      previewTab === 'original'
                        ? 'bg-white/20 text-white'
                        : 'bg-black/40 text-gray-400 hover:text-white'
                    }`}
                  >
                    Original Audio
                  </button>
                </div>

                <button
                  onClick={handleApplyToMaster}
                  className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-black font-bold text-xs uppercase tracking-wider rounded-xl shadow-lg transition-all flex items-center gap-2 cursor-pointer"
                >
                  <span>✓ Apply Changes to Master Console</span>
                </button>
              </div>

              <audio
                controls
                src={previewTab === 'inpainted' ? inpaintedAudioUrl : (audioUrl || '')}
                className="w-full custom-audio-player"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
