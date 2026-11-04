import React, { useState, useEffect, useRef } from 'react';
import {
  setCurrentUser,
  logLoginToSheet,
  sendPhoneOtp,
  verifyPhoneOtp,
  type UserProfile,
} from '../services/authService';

interface GoogleSignInModalProps {
  isOpen: boolean;
  initialMode?: 'signin' | 'signup';
  onClose?: () => void;
  onSuccess: (user: UserProfile) => void;
}

const COUNTRY_CODES = [
  { code: '+91', label: '🇮🇳 +91 (IN)' },
  { code: '+1', label: '🇺🇸 +1 (US)' },
  { code: '+44', label: '🇬🇧 +44 (UK)' },
  { code: '+971', label: '🇦🇪 +971 (UAE)' },
  { code: '+65', label: '🇸🇬 +65 (SG)' },
  { code: '+60', label: '🇲🇾 +60 (MY)' },
  { code: '+61', label: '🇦🇺 +61 (AU)' },
];

export const GoogleSignInModal: React.FC<GoogleSignInModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [name, setName] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [rememberMe, setRememberMe] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [dispatchedOtpPreview, setDispatchedOtpPreview] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (isOpen) {
      setStep('phone');
      setOtpDigits(['', '', '', '', '', '']);
      setErrorMsg(null);
      setStatusMessage(null);
      setDispatchedOtpPreview(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  if (!isOpen) return null;

  const cleanDigits = phoneNumber.replace(/\D/g, '');
  const fullPhone = `${countryCode}${cleanDigits}`;

  const handleSendOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg(null);

    if (cleanDigits.length < 7 || cleanDigits.length > 15) {
      setErrorMsg('Please enter a valid mobile phone number (10 digits).');
      return;
    }

    setIsSubmitting(true);
    setStatusMessage('Dispatching 6-digit OTP to your phone...');

    const res = await sendPhoneOtp(fullPhone, name.trim() || undefined);
    setIsSubmitting(false);

    if (!res.success) {
      setStatusMessage(null);
      setErrorMsg(res.message || 'Could not send OTP. Please try again.');
      return;
    }

    setDispatchedOtpPreview(res.otpPreview || null);
    setStatusMessage(res.message);
    setOtpDigits(['', '', '', '', '', '']);
    setStep('otp');
    setResendCooldown(30);
    setTimeout(() => {
      otpInputRefs.current[0]?.focus();
    }, 80);
  };

  const handleOtpDigitChange = (index: number, val: string) => {
    const digit = val.replace(/\D/g, '').slice(-1);
    const updated = [...otpDigits];
    updated[index] = digit;
    setOtpDigits(updated);
    setErrorMsg(null);

    if (digit && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const next = ['', '', '', '', '', ''];
    for (let i = 0; i < 6; i++) {
      next[i] = pasted[i] || '';
    }
    setOtpDigits(next);
    const focusIdx = Math.min(5, pasted.length);
    otpInputRefs.current[focusIdx]?.focus();
  };

  const handleAutoFillOtp = () => {
    if (!dispatchedOtpPreview) return;
    const chars = dispatchedOtpPreview.slice(0, 6).split('');
    setOtpDigits([
      chars[0] || '',
      chars[1] || '',
      chars[2] || '',
      chars[3] || '',
      chars[4] || '',
      chars[5] || '',
    ]);
    setErrorMsg(null);
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const enteredOtp = otpDigits.join('');
    if (enteredOtp.length !== 6) {
      setErrorMsg('Please enter all 6 digits of your OTP.');
      return;
    }

    setIsSubmitting(true);
    setStatusMessage('Verifying OTP...');

    const verification = await verifyPhoneOtp(fullPhone, enteredOtp);
    if (!verification.valid) {
      setIsSubmitting(false);
      setStatusMessage(null);
      setErrorMsg(verification.error || 'Invalid OTP code.');
      return;
    }

    const displayName = name.trim() || `User ${cleanDigits.slice(-4)}`;
    const user: UserProfile = {
      id: `phone_${cleanDigits}_${Date.now()}`,
      name: displayName,
      phone: fullPhone,
      email: fullPhone,
      phoneVerified: true,
      picture: `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=10b981&color=000&bold=true`,
      signedInAt: new Date().toISOString(),
    };

    setCurrentUser(user, rememberMe);
    await logLoginToSheet(user);

    setIsSubmitting(false);
    onSuccess(user);
    if (onClose) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-2xl animate-fade-in select-none">
      <div className="relative w-full max-w-md bg-[#07120c] border border-emerald-500/35 rounded-3xl p-6 sm:p-8 space-y-6 shadow-[0_0_70px_rgba(16,185,129,0.22)] overflow-hidden">
        {/* Ambient Glow */}
        <div className="absolute -top-24 -right-24 w-52 h-52 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-52 h-52 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Close Button */}
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-5 right-5 text-gray-400 hover:text-white p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-all cursor-pointer z-10"
            title="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* Header */}
        <div className="text-center space-y-2 relative z-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 shadow-lg shadow-emerald-500/10">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"
              />
            </svg>
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[10px] font-mono font-bold text-emerald-400 uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Phone OTP Security Gate</span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            {step === 'phone' ? 'Verify Your Phone' : 'Enter 6-Digit OTP'}
          </h2>
          <p className="text-xs sm:text-sm text-gray-300 max-w-xs mx-auto leading-relaxed">
            {step === 'phone'
              ? 'HyperVox Studio requires mobile OTP verification before granting access to the neural audio workstation.'
              : `Enter the 6-digit verification code dispatched to ${fullPhone}`}
          </p>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/40 text-xs text-red-300 text-center font-medium relative z-10">
            {errorMsg}
          </div>
        )}

        {/* Live OTP Dispatch Banner (Step 2) */}
        {step === 'otp' && dispatchedOtpPreview && (
          <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/40 flex items-center justify-between gap-3 relative z-10">
            <div className="text-left">
              <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400 block font-bold">
                Instant Studio OTP Code
              </span>
              <span className="text-lg font-mono font-black tracking-[0.25em] text-white">
                {dispatchedOtpPreview}
              </span>
            </div>
            <button
              type="button"
              onClick={handleAutoFillOtp}
              className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs uppercase tracking-wider transition-all cursor-pointer flex-shrink-0"
            >
              Auto-Fill
            </button>
          </div>
        )}

        {step === 'phone' ? (
          <form onSubmit={handleSendOtp} className="space-y-4 relative z-10">
            <div className="space-y-1.5 text-left">
              <label className="block text-xs font-mono font-bold text-gray-300 uppercase tracking-wider">
                Your Name <span className="text-gray-500 font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
                className="w-full bg-black/60 border border-white/15 focus:border-emerald-400 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none transition-all"
              />
            </div>

            <div className="space-y-1.5 text-left">
              <label className="block text-xs font-mono font-bold text-gray-300 uppercase tracking-wider">
                Mobile Phone Number *
              </label>
              <div className="flex gap-2">
                <select
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  className="bg-black/70 border border-white/15 focus:border-emerald-400 rounded-xl px-3 py-3 text-xs sm:text-sm font-mono text-white focus:outline-none cursor-pointer"
                >
                  {COUNTRY_CODES.map((c) => (
                    <option key={c.code} value={c.code} className="bg-[#07120c] text-white">
                      {c.label}
                    </option>
                  ))}
                </select>
                <input
                  type="tel"
                  required
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value.replace(/[^\d\s-]/g, ''))}
                  placeholder="98765 43210"
                  maxLength={15}
                  className="flex-1 bg-black/60 border border-white/15 focus:border-emerald-400 rounded-xl px-4 py-3 text-sm font-mono tracking-wider text-white placeholder-gray-500 focus:outline-none transition-all"
                />
              </div>
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer text-xs text-gray-300 pt-1">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="rounded bg-black/60 border-white/20 text-emerald-500 focus:ring-emerald-500 cursor-pointer"
              />
              <span>Keep my phone verified on this device</span>
            </label>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3.5 px-6 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-black text-xs sm:text-sm uppercase tracking-widest transition-all shadow-[0_0_30px_rgba(16,185,129,0.35)] flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>{isSubmitting ? 'SENDING OTP...' : 'SEND 6-DIGIT OTP'}</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-5 relative z-10">
            {/* 6-Digit OTP Input Boxes */}
            <div className="flex items-center justify-between gap-2 sm:gap-2.5">
              {otpDigits.map((digit, idx) => (
                <input
                  key={idx}
                  ref={(el) => {
                    otpInputRefs.current[idx] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleOtpDigitChange(idx, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                  onPaste={handleOtpPaste}
                  className="w-11 h-13 sm:w-12 sm:h-14 text-center text-lg sm:text-xl font-mono font-black text-white bg-black/70 border border-emerald-500/40 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/30 rounded-xl focus:outline-none transition-all"
                />
              ))}
            </div>

            <div className="flex items-center justify-between text-xs font-mono">
              <button
                type="button"
                onClick={() => {
                  setStep('phone');
                  setErrorMsg(null);
                }}
                className="text-gray-400 hover:text-white underline cursor-pointer transition-colors"
              >
                ← Change Phone Number
              </button>

              <button
                type="button"
                disabled={resendCooldown > 0 || isSubmitting}
                onClick={() => handleSendOtp()}
                className="text-emerald-400 hover:text-emerald-300 disabled:text-gray-500 cursor-pointer disabled:cursor-not-allowed font-bold transition-colors"
              >
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend OTP'}
              </button>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || otpDigits.join('').length !== 6}
              className="w-full py-3.5 px-6 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-black text-xs sm:text-sm uppercase tracking-widest transition-all shadow-[0_0_30px_rgba(16,185,129,0.35)] flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>{isSubmitting ? 'VERIFYING OTP...' : 'VERIFY OTP & ENTER STUDIO'}</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </button>
          </form>
        )}

        {statusMessage && !errorMsg && (
          <p className="text-[11px] font-mono text-emerald-400/80 text-center relative z-10">
            {statusMessage}
          </p>
        )}
      </div>
    </div>
  );
};

export default GoogleSignInModal;
