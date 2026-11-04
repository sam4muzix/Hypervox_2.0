import React, { useState, useRef } from 'react';
import { TranscriptionJob, TranscriptionStyle } from '../types';
import { transcribeAudio, translateText } from '../services/geminiService';

const LANGUAGES = [
  'English', 'Tamil', 'Hindi', 'Telugu', 'Malayalam', 'Kannada', 'Marathi', 'Bengali', 'Gujarati'
];

const STYLES: TranscriptionStyle[] = [
  'Straight Translation',
  'Colloquial (Local Slang)',
  'Classical (Formal)'
];

enum SubTab {
  TRANSCRIPTION = 'Audio Transcription',
  TRANSLATION = 'Text Translation'
}

const TranscribeTranslatePanel: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>(SubTab.TRANSCRIPTION);

  // Transcription States
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [transcribeJob, setTranscribeJob] = useState<TranscriptionJob | null>(null);
  const [transcribeLang, setTranscribeLang] = useState<string>('English');
  const [transcribeStyle, setTranscribeStyle] = useState<TranscriptionStyle>('Straight Translation');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const audioFileInputRef = useRef<HTMLInputElement>(null);

  // Translation States
  const [inputText, setInputText] = useState('');
  const [translateLang, setTranslateLang] = useState('English');
  const [translateStyle, setTranslateStyle] = useState<TranscriptionStyle>('Straight Translation');
  const [outputText, setOutputText] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  // Transcription Handlers
  const handleAudioFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setAudioFile(e.target.files[0]);
      setTranscribeJob(null);
    }
  };

  const handleTranscribe = async () => {
    if (!audioFile) return;

    setIsTranscribing(true);
    const newJob: TranscriptionJob = {
      id: Math.random().toString(36).substring(7),
      file: audioFile,
      status: 'processing'
    };
    setTranscribeJob(newJob);

    try {
      const text = await transcribeAudio(audioFile, transcribeLang, transcribeStyle);
      setTranscribeJob({ ...newJob, status: 'completed', outputText: text });
    } catch (err: any) {
      console.error(err);
      setTranscribeJob({ ...newJob, status: 'failed', error: err.message || 'Transcription failed' });
    } finally {
      setIsTranscribing(false);
    }
  };

  const copyTranscriptionToClipboard = () => {
    if (transcribeJob?.outputText) {
      navigator.clipboard.writeText(transcribeJob.outputText);
    }
  };

  // Translation Handlers
  const handleTranslate = async () => {
    if (!inputText.trim()) {
      setTranslateError("Please enter text to translate.");
      return;
    }
    setTranslateError(null);
    setIsTranslating(true);

    try {
      const result = await translateText(inputText, translateLang, translateStyle);
      setOutputText(result);
    } catch (err: any) {
      setTranslateError(err.message || "Translation failed");
    } finally {
      setIsTranslating(false);
    }
  };

  const copyTranslationToClipboard = () => {
    navigator.clipboard.writeText(outputText);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Sub-tab Navigation */}
      <div className="flex items-center gap-3 border-b border-emerald-500/20 pb-4">
        {Object.values(SubTab).map((tab) => {
          const isActive = activeSubTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveSubTab(tab)}
              className={`
                px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all border
                ${isActive
                  ? 'bg-emerald-500/20 border-emerald-500 text-white shadow-lg shadow-emerald-500/10'
                  : 'bg-white/[0.02] border-white/5 text-gray-400 hover:bg-emerald-500/10 hover:text-white'
                }
              `}
            >
              {tab}
            </button>
          );
        })}
      </div>

      {/* Tab Contents */}
      {activeSubTab === SubTab.TRANSCRIPTION ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Deck: Audio upload and params */}
          <div className="lg:col-span-5 space-y-6">
            <div className="liquid-glass p-6 h-full flex flex-col justify-between min-h-[460px]">
              <div>
                <h2 className="text-xs font-bold text-white uppercase tracking-wider mb-6 pb-3 border-b border-white/10">
                  Audio Upload & Settings
                </h2>

                <div className="space-y-6">
                  <input 
                    type="file" 
                    accept="audio/*" 
                    ref={audioFileInputRef}
                    onChange={handleAudioFileSelect}
                    className="hidden"
                  />
                  <div 
                    onClick={() => audioFileInputRef.current?.click()}
                    className={`
                      h-40 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all ${
                        audioFile 
                          ? 'border-emerald-500 bg-emerald-500/10' 
                          : 'border-emerald-500/20 bg-black/20 hover:border-emerald-500/40'
                      }
                    `}
                  >
                    {audioFile ? (
                      <div className="text-center px-4">
                        <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-2 text-emerald-400">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.125 3.375c2.25 0 3.375 1.125 3.375 3.375v10.5c0 2.25-1.125 3.375-3.375 3.375H4.875C2.625 20.625 1.5 19.5 1.5 17.25V6.75c0-2.25 1.125-3.375 3.375-3.375h14.25z" />
                          </svg>
                        </div>
                        <p className="text-white font-semibold text-xs truncate max-w-[200px]">{audioFile.name}</p>
                        <p className="text-[10px] text-gray-400 mt-1">Click to change audio file</p>
                      </div>
                    ) : (
                      <div className="text-center">
                        <svg className="w-7 h-7 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 003-3V4.5a3 3 0 00-6 0v8.25a3 3 0 003 3z" />
                        </svg>
                        <span className="text-xs font-semibold uppercase text-gray-300">Upload Source Audio</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-gray-400 text-xs font-semibold uppercase mb-2">Target Language</label>
                      <select
                        value={transcribeLang}
                        onChange={(e) => setTranscribeLang(e.target.value)}
                        className="w-full bg-black/40 border border-emerald-500/20 text-white rounded-xl p-3 text-xs focus:border-emerald-500 focus:outline-none"
                      >
                        {LANGUAGES.map(l => <option key={l} value={l} className="bg-[#081810]">{l}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="block text-gray-400 text-xs font-semibold uppercase mb-2">Translation Style</label>
                      <select
                        value={transcribeStyle}
                        onChange={(e) => setTranscribeStyle(e.target.value as TranscriptionStyle)}
                        className="w-full bg-black/40 border border-emerald-500/20 text-white rounded-xl p-3 text-xs focus:border-emerald-500 focus:outline-none"
                      >
                        {STYLES.map(s => <option key={s} value={s} className="bg-[#081810]">{s}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={handleTranscribe}
                disabled={isTranscribing || !audioFile}
                className={`w-full py-3.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all mt-6 ${
                  isTranscribing || !audioFile
                    ? 'bg-white/5 text-gray-600 border border-white/5 cursor-not-allowed'
                    : 'liquid-btn-primary'
                }`}
              >
                {isTranscribing ? 'DECODING AUDIO...' : 'TRANSCRIBE & TRANSLATE'}
              </button>
            </div>
          </div>

          {/* Right Deck: Result */}
          <div className="lg:col-span-7">
            <div className="liquid-glass p-6 h-full min-h-[460px] flex flex-col justify-between">
              <div>
                <div className="bg-black/40 px-6 py-3.5 rounded-t-2xl border-b border-emerald-500/20 flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-200 uppercase tracking-wider">
                    Decoded Output Text
                  </span>
                  {transcribeJob?.status === 'completed' && (
                    <button 
                      onClick={copyTranscriptionToClipboard}
                      className="text-xs font-semibold text-emerald-400 hover:text-white transition-colors flex items-center gap-1.5"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.375a9.06 9.06 0 00-1.5-.124" />
                      </svg>
                      Copy Text
                    </button>
                  )}
                </div>

                <div className="p-4 relative">
                  {transcribeJob?.status === 'processing' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-10 rounded-b-2xl min-h-[300px]">
                      <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3"></div>
                      <p className="text-gray-300 text-xs animate-pulse">Analyzing acoustic spectrum...</p>
                    </div>
                  )}

                  {transcribeJob?.status === 'failed' && (
                    <div className="flex flex-col items-center justify-center text-red-400 p-6 min-h-[300px]">
                      <p className="font-bold text-xs uppercase">Transcription Error</p>
                      <p className="text-xs text-gray-300 mt-1">{transcribeJob.error}</p>
                    </div>
                  )}

                  <textarea
                    readOnly
                    className="w-full min-h-[300px] bg-transparent text-gray-200 focus:outline-none resize-none font-mono text-sm leading-relaxed custom-scrollbar"
                    value={transcribeJob?.outputText || ''}
                    placeholder={isTranscribing ? '' : "Decoded transcript text will appear here..."}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Deck: Input text */}
          <div className="liquid-glass p-6 flex flex-col justify-between min-h-[460px]">
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4">
                Source Text Deck
              </h3>

              <textarea 
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Type or paste source text to translate..."
                className="w-full bg-black/30 border border-white/10 rounded-2xl p-4 text-white font-mono text-sm focus:outline-none focus:border-emerald-500 transition-all resize-none min-h-[200px] custom-scrollbar"
              />
            </div>

            <div className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-400 text-xs font-semibold uppercase mb-1.5">Target Language</label>
                  <select
                    value={translateLang}
                    onChange={(e) => setTranslateLang(e.target.value)}
                    className="w-full bg-black/40 border border-emerald-500/20 text-white rounded-xl p-3 text-xs focus:border-emerald-500 focus:outline-none"
                  >
                    {LANGUAGES.map(l => <option key={l} value={l} className="bg-[#081810]">{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-gray-400 text-xs font-semibold uppercase mb-1.5">Style</label>
                  <select
                    value={translateStyle}
                    onChange={(e) => setTranslateStyle(e.target.value as TranscriptionStyle)}
                    className="w-full bg-black/40 border border-emerald-500/20 text-white rounded-xl p-3 text-xs focus:border-emerald-500 focus:outline-none"
                  >
                    {STYLES.map(s => <option key={s} value={s} className="bg-[#081810]">{s}</option>)}
                  </select>
                </div>
              </div>

              <button
                onClick={handleTranslate}
                disabled={isTranslating || !inputText.trim()}
                className={`w-full py-3.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all ${
                  isTranslating || !inputText.trim()
                    ? 'bg-white/5 text-gray-600 border border-white/5 cursor-not-allowed'
                    : 'liquid-btn-primary'
                }`}
              >
                {isTranslating ? 'TRANSLATING TEXT...' : 'RUN TRANSLATION'}
              </button>
            </div>
          </div>

          {/* Right Deck: Output text */}
          <div className="liquid-glass p-6 flex flex-col justify-between min-h-[460px] relative">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-bold text-gray-200 uppercase tracking-wider">
                  Translated Output Matrix
                </h3>
                {outputText && (
                  <button 
                    onClick={copyTranslationToClipboard} 
                    className="text-xs font-semibold text-emerald-400 hover:text-white flex items-center gap-1.5 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.375a9.06 9.06 0 00-1.5-.124" />
                    </svg>
                    Copy
                  </button>
                )}
              </div>

              {isTranslating && (
                <div className="absolute inset-0 z-10 bg-black/60 backdrop-blur-sm rounded-3xl flex flex-col items-center justify-center min-h-[360px]">
                  <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3"></div>
                  <p className="text-gray-300 text-xs font-semibold animate-pulse">Translating text...</p>
                </div>
              )}
              
              {translateError && (
                <div className="p-4 bg-red-950/40 border border-red-500/40 text-red-300 rounded-xl mb-4 text-xs font-mono">
                  {translateError}
                </div>
              )}

              <textarea 
                readOnly
                value={outputText}
                placeholder="Translated output will appear here..."
                className="w-full bg-black/20 border border-white/5 rounded-2xl p-4 text-gray-200 font-mono text-sm focus:outline-none resize-none custom-scrollbar min-h-[300px]"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TranscribeTranslatePanel;
