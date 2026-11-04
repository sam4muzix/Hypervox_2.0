import React, { useState } from 'react';

interface IntroModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const IntroModal: React.FC<IntroModalProps> = ({ isOpen, onClose }) => {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  if (!isOpen) return null;

  const handleProceed = () => {
    if (dontShowAgain) {
      localStorage.setItem('hypervox_skip_intro', 'true');
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-fade-in select-none">
      
      {/* Dark Ambient Backdrop */}
      <div 
        onClick={handleProceed}
        className="fixed inset-0 bg-black/80 backdrop-blur-2xl transition-opacity"
      />

      {/* Main Glassmorphism Intro Dialog */}
      <div className="relative w-full max-w-4xl bg-[#06140e]/95 border border-emerald-500/30 rounded-3xl p-6 sm:p-8 shadow-[0_0_50px_rgba(16,185,129,0.2)] backdrop-blur-3xl space-y-6 z-10 my-auto text-white overflow-hidden">
        
        {/* Glow Accents */}
        <div className="absolute -top-24 -left-24 w-60 h-60 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-60 h-60 bg-teal-500/20 rounded-full blur-3xl pointer-events-none" />

        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-emerald-500/20 pb-5 relative z-10">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-0.5 shadow-lg shadow-emerald-500/20">
              <div className="w-full h-full bg-black/80 rounded-[14px] flex items-center justify-center text-emerald-400">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.125 3.375c2.25 0 3.375 1.125 3.375 3.375v10.5c0 2.25-1.125 3.375-3.375 3.375H4.875C2.625 20.625 1.5 19.5 1.5 17.25V6.75c0-2.25 1.125-3.375 3.375-3.375h14.25zM12 7.5v9m-3.75-6v3m7.5-3v3m-11.25-1.5v0m15 0v0" />
                </svg>
              </div>
            </div>

            <div>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2">
                HyperVox <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-semibold uppercase tracking-wider">Studio Guide</span>
              </h2>
              <p className="text-xs font-semibold text-emerald-400 tracking-widest uppercase">
                Powered by Greenmix Labs & Google Gemini
              </p>
            </div>
          </div>

          <button
            onClick={handleProceed}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 hover:text-white transition-all"
            title="Close Guide"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Hero Pitch / Summary */}
        <div className="bg-black/40 border border-white/5 rounded-2xl p-4 sm:p-5 relative z-10">
          <p className="text-xs sm:text-sm text-gray-200 leading-relaxed">
            <strong className="text-emerald-400 font-bold">HyperVox</strong> is an enterprise-grade AI audio workstation built for commercial voice synthesis, localized multi-language dubbing, and regional speech matrix transformation. Eliminate studio booking bottlenecks with an autonomous audio-as-code pipeline.
          </p>
        </div>

        {/* 3 Core Workstation Modules Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 relative z-10">
          
          {/* Card 1: Neural TTS */}
          <div className="bg-black/30 border border-white/10 hover:border-emerald-500/40 rounded-2xl p-4 transition-all space-y-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 003-3V4.5a3 3 0 00-3-3s-3 1.343-3 3v8.25a3 3 0 003 3z" />
              </svg>
            </div>
            <h3 className="text-sm font-bold text-white">Neural TTS Engine</h3>
            <p className="text-[11px] text-gray-300 leading-normal">
              16 regional voice personas (*Arjun*, *Anitha*, *Titan*), 14 emotion vibes, inline <code className="text-emerald-400">(Style Tags)</code>, and Live Speech-to-Text Dictation.
            </p>
          </div>

          {/* Card 2: AI Voice Dubbing */}
          <div className="bg-black/30 border border-white/10 hover:border-emerald-500/40 rounded-2xl p-4 transition-all space-y-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 016-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m0 2.25c0 1.944-.33 3.812-.942 5.545M4.25 12.3c.73-1.854 1.258-3.81 1.558-5.836" />
              </svg>
            </div>
            <h3 className="text-sm font-bold text-white">AI Voice Dubbing</h3>
            <p className="text-[11px] text-gray-300 leading-normal">
              9-point vocal fingerprinting, pitch-preserved WSOLA time-stretching to match original duration without chipmunk pitch distortion.
            </p>
          </div>

          {/* Card 3: Speech & Translation Matrix */}
          <div className="bg-black/30 border border-white/10 hover:border-emerald-500/40 rounded-2xl p-4 transition-all space-y-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
              </svg>
            </div>
            <h3 className="text-sm font-bold text-white">Speech Matrix</h3>
            <p className="text-[11px] text-gray-300 leading-normal">
              Audio transcription & multi-dialect translation (*Chennai Tamil*, *Senthamizh*, *Indian English*) powered by Neural Audio Intelligence.
            </p>
          </div>

        </div>

        {/* Use Cases Pills */}
        <div className="space-y-2 relative z-10">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">
            Popular Use Cases
          </span>
          <div className="flex flex-wrap gap-2">
            {[
              'Retail Radio & Promo Ads',
              'Movie & Web Series Dubbing',
              'YouTube Reels & Shorts Audio',
              'Corporate Announcements',
              'Regional Audiobooks & Podcasts',
              'Hands-free Speech-to-Text Scripting'
            ].map((uc, i) => (
              <span key={i} className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-gray-300">
                {uc}
              </span>
            ))}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-emerald-500/20 pt-5 relative z-10">
          
          <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-400 hover:text-gray-200 select-none">
            <input 
              type="checkbox" 
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="rounded bg-black/40 border-white/20 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0 cursor-pointer"
            />
            <span>Don't show guide automatically on startup</span>
          </label>

          <button
            onClick={handleProceed}
            className="w-full sm:w-auto px-8 py-3.5 rounded-xl liquid-btn-primary font-bold text-xs uppercase tracking-widest shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
          >
            <span>ENTER HYPERVOX STUDIO</span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </button>

        </div>

      </div>
    </div>
  );
};
