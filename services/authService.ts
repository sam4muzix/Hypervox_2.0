// Master Password Authentication & 24-Hour Inactivity Session Service for Hypervox

export interface UserProfile {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  picture?: string;
  passwordVerified: boolean;
  phoneVerified?: boolean;
  signedInAt: string;
  lastActiveAt: number;
}

const STORAGE_KEY = 'hypervox_auth_session_v2';
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
  return enteredPassword.trim() === getMasterPassword();
};

/**
 * Get the current authenticated user session.
 * - Requires `passwordVerified === true`.
 * - Automatically logs out if inactive for more than 24 hours (`Date.now() - lastActiveAt > 24h`).
 * - Refreshes `lastActiveAt` and does NOT ask to log in again within 24 hours.
 */
export const getCurrentUser = (): UserProfile | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as UserProfile;
    if (!parsed || !parsed.passwordVerified) {
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
export const setCurrentUser = (user: Partial<UserProfile>, _rememberMe: boolean = true): void => {
  try {
    const updated: UserProfile = {
      id: user.id || `user_${Date.now()}`,
      name: user.name || 'Studio Producer',
      email: user.email || 'studio@greenmixlabs.com',
      phone: user.phone || '',
      passwordVerified: true,
      phoneVerified: true,
      signedInAt: user.signedInAt || new Date().toISOString(),
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
    sessionStorage.removeItem('hypervox_pending_otp');
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
 * Log verified password login to backend (/api/log-login)
 */
export const logLoginToSheet = async (user: UserProfile): Promise<boolean> => {
  const payload = {
    timestamp: new Date().toISOString(),
    date: new Date().toLocaleDateString('en-US'),
    time: new Date().toLocaleTimeString('en-US'),
    name: user.name || 'Verified Producer',
    email: user.email || 'studio@greenmixlabs.com',
    userId: user.id || 'N/A',
    picture: user.picture || '',
    app: 'Hypervox AI Voice Studio (Password Verified)',
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
