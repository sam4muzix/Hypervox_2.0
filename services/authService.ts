// Phone OTP + Master Password Authentication & 24-Hour Inactivity Session Service for Hypervox

export interface UserProfile {
  id: string;
  name: string;
  phone: string;
  email: string;
  picture?: string;
  phoneVerified: boolean;
  passwordVerified: boolean;
  signedInAt: string;
  lastActiveAt: number;
}

const STORAGE_KEY = 'hypervox_auth_session_v2';
const OTP_SESSION_STORE = 'hypervox_pending_otp';
export const INACTIVITY_LIMIT_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Default case-sensitive master password ("RageofSpartan2026")
const MASTER_PASSWORD_B64 = 'UmFnZW9mU3BhcnRhbjIwMjY=';

const getMasterPassword = (): string => {
  try {
    return atob(MASTER_PASSWORD_B64);
  } catch {
    return 'RageofSpartan2026';
  }
};

/**
 * Case-sensitive master password check ("RageofSpartan2026").
 */
export const verifyMasterPassword = (enteredPassword: string): boolean => {
  return enteredPassword === getMasterPassword();
};

interface PendingOtpRecord {
  phone: string;
  codeHash: string;
  expiresAt: number;
}

const hashOtp = (phone: string, code: string): string => {
  const raw = `${phone.trim()}:${code.trim()}:hypervox_salt_2026`;
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
};

/**
 * Get the current authenticated user session.
 * - Requires both `phoneVerified === true` and `passwordVerified === true`.
 * - Automatically logs out if inactive for more than 24 hours (`Date.now() - lastActiveAt > 24h`).
 * - Otherwise refreshes `lastActiveAt` and does NOT ask to log in again within 24 hours.
 */
export const getCurrentUser = (): UserProfile | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as UserProfile;
    if (!parsed || !parsed.phoneVerified || !parsed.passwordVerified || !parsed.phone) {
      logoutUser();
      return null;
    }

    const now = Date.now();
    const lastActive = typeof parsed.lastActiveAt === 'number' ? parsed.lastActiveAt : new Date(parsed.signedInAt).getTime();

    if (now - lastActive > INACTIVITY_LIMIT_MS) {
      logoutUser();
      return null;
    }

    // Update lastActiveAt on access
    parsed.lastActiveAt = now;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    return parsed;
  } catch {
    return null;
  }
};

/**
 * Persist verified user session for 24-hour rolling activity window.
 */
export const setCurrentUser = (user: UserProfile, _rememberMe: boolean = true): void => {
  try {
    const updated: UserProfile = {
      ...user,
      phoneVerified: true,
      passwordVerified: true,
      lastActiveAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage errors
  }
};

/**
 * Touch session activity timestamp on user interaction; returns false if expired (>24h inactive).
 */
export const touchUserActivity = (): boolean => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as UserProfile;
    const now = Date.now();
    const lastActive = typeof parsed.lastActiveAt === 'number' ? parsed.lastActiveAt : now;

    if (now - lastActive > INACTIVITY_LIMIT_MS) {
      logoutUser();
      return false;
    }

    // Throttle writes to localStorage to once every 30 seconds
    if (now - lastActive > 30000) {
      parsed.lastActiveAt = now;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    }
    return true;
  } catch {
    return false;
  }
};

/**
 * Log out user and clear session storage.
 */
export const logoutUser = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('hypervox_otp_user');
    localStorage.removeItem('hypervox_otp_remember_me');
    sessionStorage.removeItem('hypervox_otp_session_user');
    sessionStorage.removeItem(OTP_SESSION_STORE);
  } catch {
    // Ignore
  }
};

/**
 * Starts a 24-hour inactivity monitor that tracks user activity and automatically
 * invokes `onSessionExpired` if the user has been inactive for > 24 hours.
 */
export const startInactivityWatcher = (onSessionExpired: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => {};

  const handleActivity = () => {
    const stillValid = touchUserActivity();
    if (!stillValid && !getCurrentUser()) {
      onSessionExpired();
    }
  };

  const checkExpiration = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as UserProfile;
      const lastActive = typeof parsed.lastActiveAt === 'number' ? parsed.lastActiveAt : 0;
      if (Date.now() - lastActive > INACTIVITY_LIMIT_MS) {
        logoutUser();
        onSessionExpired();
      }
    } catch {
      // Ignore
    }
  };

  const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
  events.forEach((ev) => window.addEventListener(ev, handleActivity, { passive: true }));
  window.addEventListener('focus', checkExpiration);
  document.addEventListener('visibilitychange', checkExpiration);

  const intervalId = window.setInterval(checkExpiration, 30000);

  return () => {
    events.forEach((ev) => window.removeEventListener(ev, handleActivity));
    window.removeEventListener('focus', checkExpiration);
    document.removeEventListener('visibilitychange', checkExpiration);
    window.clearInterval(intervalId);
  };
};

/**
 * Resolve the real backend OTP API URL (uses local /api/otp on greenmixlabs.com, or https://greenmixlabs.com/api/otp when running locally).
 */
const getOtpApiUrl = (): string => {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'https://greenmixlabs.com/api/otp';
    }
  }
  return '/api/otp';
};

/**
 * Dispatch a real 6-digit Email OTP to the given email address via the backend (/api/otp).
 */
export const sendPhoneOtp = async (
  emailOrPhone: string,
  name?: string
): Promise<{ success: boolean; message: string }> => {
  const normalizedTarget = emailOrPhone.trim().toLowerCase();

  try {
    const res = await fetch(getOtpApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        action: 'send',
        email: normalizedTarget,
        phone: normalizedTarget,
        name: name || 'HyperVox User',
      }),
    });

    const data = await res.json().catch(() => null);
    if (res.ok && data && data.success) {
      return {
        success: true,
        message: data.message || `6-digit OTP sent to ${normalizedTarget}`,
      };
    }

    return {
      success: false,
      message: (data && data.message) || 'Failed to deliver Email OTP. Please check your email address.',
    };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || 'Network error while contacting Email OTP gateway.',
    };
  }
};

/**
 * Verify the 6-digit Email OTP code entered by the user against the backend (/api/otp).
 */
export const verifyPhoneOtp = async (
  emailOrPhone: string,
  enteredOtp: string
): Promise<{ valid: boolean; error?: string }> => {
  const normalizedTarget = emailOrPhone.trim().toLowerCase();
  const cleanOtp = enteredOtp.replace(/\D/g, '').trim();

  if (cleanOtp.length !== 6) {
    return { valid: false, error: 'Please enter a valid 6-digit OTP code.' };
  }

  try {
    const res = await fetch(getOtpApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        action: 'verify',
        email: normalizedTarget,
        phone: normalizedTarget,
        otp: cleanOtp,
      }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.valid) {
      return { valid: true };
    }
    return {
      valid: false,
      error: (data && data.error) || 'Invalid or expired OTP code. Please check your email and try again.',
    };
  } catch {
    return { valid: false, error: 'Network error verifying OTP. Please try again.' };
  }
};

/**
 * Log verified phone + password login to backend (/api/log-login)
 */
export const logLoginToSheet = async (user: UserProfile): Promise<boolean> => {
  const payload = {
    timestamp: new Date().toISOString(),
    date: new Date().toLocaleDateString('en-US'),
    time: new Date().toLocaleTimeString('en-US'),
    name: user.name || 'Verified User',
    email: user.phone || user.email || 'N/A',
    phone: user.phone || 'N/A',
    userId: user.id || 'N/A',
    picture: user.picture || '',
    app: 'Hypervox AI Voice Studio (OTP + Password Verified)',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  };

  try {
    const res = await fetch('/api/log-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
};

export const decodeGoogleJwt = (token: string): any => {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
};
