import React, { useState, useEffect, useRef } from 'react';
import {
  setCurrentUser,
  logLoginToSheet,
  verifyMasterPassword,
  type UserProfile,
} from '../services/authService';

interface PasswordGateModalProps {
  isOpen: boolean;
  initialMode?: 'signin' | 'signup';
  onClose?: () => void;
  onSuccess: (user: UserProfile) => void;
}

export const PasswordGateModal: React.FC<PasswordGateModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [password, setPassword] = useState('');
  const [producerName, setProducerName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setShowPassword(false);
      setErrorMsg(null);
      setTimeout(() => {
        passwordInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const trimmedPassword = password.trim();
    if (!trimmedPassword) {
      setErrorMsg('Please enter the studio access password.');
      passwordInputRef.current?.focus();
      return;
    }

    setIsSubmitting(true);

    if (!verifyMasterPassword(trimmedPassword)) {
      setIsSubmitting(false);
      setErrorMsg('Incorrect studio password. Access denied.');
      passwordInputRef.current?.focus();
      return;
    }

    const newUser: UserProfile = {
      id: `user_${Date.now()}`,
      name: producerName.trim() || 'Studio Producer',
      email: 'studio@greenmixlabs.com',
      passwordVerified: true,
      phoneVerified: true,
      signedInAt: new Date().toISOString(),
      lastActiveAt: Date.now(),
    };

    setCurrentUser(newUser);
    logLoginToSheet(newUser).catch(() => {});
    setIsSubmitting(false);
    onSuccess(newUser);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-md bg-[#07120c] border border-emerald-500/30 rounded-2xl p-6 sm:p-8 shadow-[0_0_50px_rgba(16,185,129,0.15)] space-y-6">
        {/* Close Button */}
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-5 right-5 p-2 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
            aria-label="Close modal"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* Studio Badge Header */}
        <div className="text-center space-y-3 pt-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 mx-auto shadow-[0_0_20px_rgba(16,185,129,0.2)]">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-mono text-emerald-300 uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Studio Access Gate</span>
          </div>

          <h2 className="text-2xl font-black text-white tracking-wide font-sans">
            Enter Studio Password
          </h2>
          <p className="text-xs text-gray-400 leading-relaxed max-w-xs mx-auto">
            HyperVox Studio requires the master password to unlock the production suite.
          </p>
        </div>

        {/* Error Notice */}
        {errorMsg && (
          <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 text-center font-medium">
            {errorMsg}
          </div>
        )}

        {/* Password Submission Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-[11px] font-mono font-bold text-gray-400 uppercase tracking-wider">
              Producer Name (Optional)
            </label>
            <input
              type="text"
              value={producerName}
              onChange={(e) => setProducerName(e.target.value)}
              placeholder="e.g. Sam"
              className="w-full bg-black/60 border border-white/15 focus:border-emerald-400 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[11px] font-mono font-bold text-gray-400 uppercase tracking-wider">
              Studio Password *
            </label>
            <div className="relative">
              <input
                ref={passwordInputRef}
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrorMsg(null);
                }}
                placeholder="Enter access password"
                className="w-full bg-black/60 border border-white/15 focus:border-emerald-400 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none transition-all pr-12 font-mono tracking-wider"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-1"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-black/40 border border-white/5 text-[11px] font-mono text-gray-400 text-center">
            Session stays active for 24 hours • Auto-logout after 24h of inactivity
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xs uppercase tracking-widest shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <span>{isSubmitting ? 'Unlocking Studio...' : 'Unlock Studio'}</span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
};

export default PasswordGateModal;
