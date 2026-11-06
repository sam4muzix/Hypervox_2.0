import React, { useState, useEffect, useRef, useCallback } from 'react';
import TtsPanel from './components/TtsPanel';
import StoryPanel from './components/StoryPanel';
import DubbingPanel from './components/DubbingPanel';
import TranscribeTranslatePanel from './components/TranscribeTranslatePanel';
import HypervoxIntro from './components/HypervoxIntro';
import { IntroModal } from './components/IntroModal';
import PasswordGateModal from './components/PasswordGateModal';
import { getCurrentUser, logoutUser, startInactivityWatcher, type UserProfile } from './services/authService';

enum Tab {
  TTS = 'Neural TTS',
  STORY = 'Audio Story Creator',
  DUBBING = 'AI Dubbing',
  TRANSLATION_SUITE = 'Speech & Translation',
}

const TAB_DESCRIPTIONS: Record<Tab, string> = {
  [Tab.TTS]: 'Neural text-to-speech generation with per-sentence emotion control',
  [Tab.STORY]: 'Full script analyzer & multi-voice autonomous audio story creator',
  [Tab.DUBBING]: 'Multi-language regional audio dubbing and voice localization',
  [Tab.TRANSLATION_SUITE]: 'Audio transcription, decoding, and multi-dialect text translation matrix',
};

const TAB_ICONS: Record<Tab, React.ReactNode> = {
  [Tab.TTS]: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.125 3.375c2.25 0 3.375 1.125 3.375 3.375v10.5c0 2.25-1.125 3.375-3.375 3.375H4.875C2.625 20.625 1.5 19.5 1.5 17.25V6.75c0-2.25 1.125-3.375 3.375-3.375h14.25zM12 7.5v9m-3.75-6v3m7.5-3v3m-11.25-1.5v0m15 0v0" />
    </svg>
  ),
  [Tab.STORY]: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  ),
  [Tab.DUBBING]: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 016-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m0 2.25c0 1.944-.33 3.812-.942 5.545M4.25 12.3c.73-1.854 1.258-3.81 1.558-5.836" />
    </svg>
  ),
  [Tab.TRANSLATION_SUITE]: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
    </svg>
  ),
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>(Tab.TTS);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => getCurrentUser());
  const [showIntro, setShowIntro] = useState<boolean>(() => !getCurrentUser());
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);

  const startMusic = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.play().then(() => {
        setIsMusicPlaying(true);
      }).catch((err) => {
        console.warn('Audio waiting for user gesture:', err);
      });
    }
  }, []);

  const toggleMusic = useCallback(() => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      audioRef.current.play().then(() => setIsMusicPlaying(true)).catch(() => {});
    } else {
      audioRef.current.pause();
      setIsMusicPlaying(false);
    }
  }, []);

  // Autoplay fallback upon initial user interaction
  useEffect(() => {
    const handleFirstGesture = () => {
      if (audioRef.current && audioRef.current.paused) {
        audioRef.current.play().then(() => setIsMusicPlaying(true)).catch(() => {});
      }
      window.removeEventListener('click', handleFirstGesture);
      window.removeEventListener('keydown', handleFirstGesture);
    };

    window.addEventListener('click', handleFirstGesture, { once: true });
    window.addEventListener('keydown', handleFirstGesture, { once: true });
    return () => {
      window.removeEventListener('click', handleFirstGesture);
      window.removeEventListener('keydown', handleFirstGesture);
    };
  }, []);

  useEffect(() => {
    const stopWatcher = startInactivityWatcher(() => {
      setCurrentUser(null);
      setShowIntro(true);
    });
    return stopWatcher;
  }, []);

  // Ensure Hypervox always displays from the top of the screen
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [showIntro, activeTab]);

  // 1. Cosmic Intro Screen first; clicking Enter triggers Master Password Verification if not verified within 24h
  if (showIntro || !currentUser || !currentUser.passwordVerified) {
    return (
      <>
        {/* Background Loop Audio */}
        <audio ref={audioRef} loop preload="auto">
          <source src="/audio/gmsitemusic.mp3" type="audio/mpeg" />
          <source src="/audio/gmsitemusic.wav" type="audio/wav" />
        </audio>

        <HypervoxIntro
          isMusicPlaying={isMusicPlaying}
          onToggleMusic={toggleMusic}
          onEnter={() => {
            window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
            startMusic();
            const activeUser = getCurrentUser();
            if (activeUser && activeUser.passwordVerified) {
              setCurrentUser(activeUser);
              setShowIntro(false);
            } else {
              setShowOtpModal(true);
            }
          }}
        />
        <PasswordGateModal
          isOpen={showOtpModal}
          onClose={() => setShowOtpModal(false)}
          onSuccess={(user) => {
            window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
            setCurrentUser(user);
            setShowOtpModal(false);
            setShowIntro(false);
            startMusic();
          }}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#050a07] text-gray-100 font-sans selection:bg-emerald-500/30 selection:text-white relative overflow-x-hidden">
      {/* Background Loop Audio */}
      <audio ref={audioRef} loop preload="auto">
        <source src="/audio/gmsitemusic.mp3" type="audio/mpeg" />
        <source src="/audio/gmsitemusic.wav" type="audio/wav" />
      </audio>

      {/* Studio Feature Guide Modal */}
      <IntroModal isOpen={isGuideOpen} onClose={() => setIsGuideOpen(false)} />

      {/* Background Emerald Fluid Ambient Glows */}
      <div className="fixed top-[-120px] left-[20%] w-[650px] h-[650px] bg-emerald-600/10 rounded-full blur-[160px] pointer-events-none z-0"></div>
      <div className="fixed top-[300px] right-[10%] w-[600px] h-[600px] bg-emerald-500/10 rounded-full blur-[170px] pointer-events-none z-0"></div>

      {/* Floating Green-Tinted Liquid Glass Header */}
      <header className="sticky top-0 z-40 backdrop-blur-3xl bg-[#050a07]/60 border-b border-emerald-500/20 select-none">
        <div className="max-w-[1800px] mx-auto px-6 h-20 flex items-center justify-between relative">
          {/* Left: Studio Modules Drawer & Guide Buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsDrawerOpen(true)}
              className="flex items-center gap-2.5 px-4 py-2 rounded-xl bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-500/30 hover:border-emerald-400 transition-all text-xs font-semibold text-gray-200 shadow-sm cursor-pointer"
            >
              <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6h16.5M3.75 12h16.5m-16.5 6h16.5" />
              </svg>
              <span>Studio Modules</span>
            </button>

            <button
              onClick={() => setIsGuideOpen(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-gray-300 hover:text-white transition-all cursor-pointer"
              title="Open Feature Guide"
            >
              <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
              <span className="hidden sm:inline">Guide</span>
            </button>
          </div>

          {/* Center Title: Big HyperVox + by Greenmix Labs Subtitle */}
          <div className="absolute left-1/2 -translate-x-1/2 text-center pointer-events-none flex flex-col items-center">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white leading-none">
              HyperVox
            </h1>
            <span className="text-xs font-bold text-emerald-400 uppercase tracking-[0.25em] mt-1">
              by Greenmix Labs
            </span>
          </div>

          {/* Right: Music Toggle & Verified Phone User Badge & Sign Out */}
          <div className="flex items-center gap-2.5">
            {/* Music On/Off Toggle Button */}
            <button
              onClick={toggleMusic}
              title={isMusicPlaying ? 'Turn Music Off' : 'Turn Music On'}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/40 bg-black/60 font-mono text-[11px] tracking-wider transition-all hover:border-emerald-400 cursor-pointer"
              style={{
                color: isMusicPlaying ? '#34d399' : '#9ca3af',
                boxShadow: isMusicPlaying ? '0 0 15px rgba(16,185,129,0.3)' : 'none',
              }}
            >
              {isMusicPlaying ? (
                <>
                  <span className="flex items-end gap-0.5 h-3">
                    <span className="w-0.5 bg-emerald-400 h-3 animate-pulse" />
                    <span className="w-0.5 bg-emerald-400 h-1.5 animate-pulse" />
                    <span className="w-0.5 bg-emerald-400 h-2.5 animate-pulse" />
                  </span>
                  <span>MUSIC ON</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.757 3.63 8.25 4.51 8.25H6.75z" />
                  </svg>
                  <span>MUSIC OFF</span>
                </>
              )}
            </button>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-emerald-500/30">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
              <span className="text-xs font-mono font-medium text-white max-w-[130px] truncate hidden sm:inline">
                {currentUser.name || 'Studio Producer'}
              </span>
              <button
                onClick={() => {
                  logoutUser();
                  setCurrentUser(null);
                  setShowIntro(true);
                }}
                className="text-[10px] font-mono text-gray-400 hover:text-red-400 uppercase tracking-wider ml-1 cursor-pointer transition-colors"
                title="Sign out of HyperVox"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ── Slide-Out Green-Tinted Liquid Glass Studio Modules Drawer Modal ───── */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div
            onClick={() => setIsDrawerOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-md transition-opacity"
          />

          <div className="relative w-full max-w-sm bg-[#081810]/95 backdrop-blur-3xl border-r border-emerald-500/30 h-full p-6 flex flex-col justify-between shadow-2xl z-10 animate-slide-drawer">
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-emerald-500/20 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-white">Studio Modules</h2>
                    <p className="text-[11px] text-emerald-400 font-medium">Select Audio Tool</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsDrawerOpen(false)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-2.5">
                {Object.values(Tab).map((tab) => {
                  const isActive = activeTab === tab;
                  return (
                    <button
                      key={tab}
                      onClick={() => {
                        setActiveTab(tab);
                        setIsDrawerOpen(false);
                      }}
                      className={`
                        w-full p-3.5 rounded-2xl text-left transition-all flex items-start gap-3.5 border text-xs font-semibold cursor-pointer
                        ${isActive
                          ? 'bg-emerald-500/20 border-emerald-500 text-white shadow-lg shadow-emerald-500/10'
                          : 'bg-white/[0.03] border-white/5 text-gray-300 hover:bg-emerald-500/10 hover:border-emerald-500/30'
                        }
                      `}
                    >
                      <div className={`p-2 rounded-xl border ${isActive ? 'bg-emerald-500 border-emerald-400 text-black' : 'bg-white/5 border-white/10 text-gray-400'}`}>
                        {TAB_ICONS[tab]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-sm text-white">{tab}</span>
                          {isActive && <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]"></span>}
                        </div>
                        <p className="text-[11px] text-gray-400 font-normal mt-0.5 leading-snug truncate">
                          {TAB_DESCRIPTIONS[tab]}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-4 border-t border-emerald-500/20 text-center">
              <p className="text-[11px] font-bold text-emerald-400 uppercase tracking-widest">HyperVox by Greenmix Labs</p>
            </div>
          </div>
        </div>
      )}

      {/* Main Studio Workstation Modules */}
      <main className="max-w-[1800px] mx-auto px-6 py-8 relative z-10">
        <div className="transition-all duration-300">
          {activeTab === Tab.TTS && <TtsPanel />}
          {activeTab === Tab.STORY && <StoryPanel />}
          {activeTab === Tab.DUBBING && <DubbingPanel />}
          {activeTab === Tab.TRANSLATION_SUITE && <TranscribeTranslatePanel />}
        </div>
      </main>
    </div>
  );
};

export default App;
