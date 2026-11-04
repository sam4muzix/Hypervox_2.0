import { Dialect, Emotion, SpeechPacing, VoiceOption } from '../types';

export interface RememberedTtsProfile {
  id: string;
  timestamp: number;
  script: string;
  notes: string;
  voiceId: string;
  emotion: Emotion;
  dialect: Dialect;
  pacing: SpeechPacing;
  extractedPronunciations: Record<string, string>;
}

export interface RememberedDubbingProfile {
  id: string;
  timestamp: number;
  fileName: string;
  fileSize: number;
  language: string;
  style: string;
  transcription: string;
  translation: string;
  fingerprint: any;
}

const TTS_STORAGE_KEY = 'hypervox_remembered_tts_profiles';
const DUBBING_STORAGE_KEY = 'hypervox_remembered_dubbing_profiles';
const PRONUNCIATION_DICT_KEY = 'hypervox_pronunciation_dictionary';

/**
 * Parses user notes for phonetic mappings like:
 * "Vango -> Vaangaw" or "Nike: Ny-kee" or "say Chennai as Chen-nai"
 */
export const extractPronunciationPairs = (notes: string): Record<string, string> => {
  const dict: Record<string, string> = {};
  if (!notes || !notes.trim()) return dict;

  // Pattern: "Word -> Pronunciation" or "Word : Pronunciation" or "Word = Pronunciation"
  const pairMatches = notes.matchAll(/([a-zA-Z0-9_\u0B80-\u0BFF]+)\s*(?:->|=>|:|=)\s*([a-zA-Z0-9_\u0B80-\u0BFF\s-]+)/g);
  for (const match of pairMatches) {
    const word = match[1]?.trim().toLowerCase();
    const spoken = match[2]?.trim();
    if (word && spoken && spoken.length < 50) {
      dict[word] = spoken;
    }
  }

  return dict;
};

export const getPronunciationDictionary = (): Record<string, string> => {
  try {
    const raw = localStorage.getItem(PRONUNCIATION_DICT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
};

export const savePronunciationPairs = (pairs: Record<string, string>) => {
  try {
    const current = getPronunciationDictionary();
    const updated = { ...current, ...pairs };
    localStorage.setItem(PRONUNCIATION_DICT_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('[MemoryStore] Failed to persist pronunciation dictionary:', e);
  }
};

export const LOCKED_WEDDING_EXPO_PROFILE: RememberedTtsProfile = {
  id: 'locked_wedding_expo_radio_master',
  timestamp: 1791450746903,
  script: 'M4Marry.com presents… டும் டும் டும் WEDDING EXPO!\n\nஉங்க Wedding preparation என்ன level-ல இருக்கு?\n\nஇப்போதா பேசி முடிச்சீங்களா?… Shopping half-way முடிஞ்சிடுச்சா?… இல்ல, இன்னும் one month தானா?!\n\nM4Marry.com presents… டும் டும் டும் WEDDING EXPO! இடம்: கலைஞர் அறிவாலயம், Oct 16 முதல் 18 வரை. வாங்க… பாருங்க… choose பண்ணுங்க… book பண்ணுங்க! உங்க wedding-க்கு தேவையான எல்லாமே… இங்க இருக்கு!',
  notes: 'High-energy FM radio commercial promo delivery. Crisp enunciation of dates, brand name, and venue with punchy FM radio cadence.',
  voiceId: 'f_anitha_anchor',
  emotion: Emotion.SHOUTING,
  dialect: Dialect.CHENNAI_TAMIL,
  pacing: SpeechPacing.MEDIUM,
  extractedPronunciations: {},
};

export const getRememberedTtsProfiles = (): RememberedTtsProfile[] => {
  try {
    const raw = localStorage.getItem(TTS_STORAGE_KEY);
    const stored: RememberedTtsProfile[] = raw ? JSON.parse(raw) : [];
    // Ensure the locked Wedding Expo profile is always present and pinned at the top
    const withoutLocked = stored.filter(p => p.id !== LOCKED_WEDDING_EXPO_PROFILE.id && p.script.trim() !== LOCKED_WEDDING_EXPO_PROFILE.script.trim());
    return [LOCKED_WEDDING_EXPO_PROFILE, ...withoutLocked];
  } catch (e) {
    return [LOCKED_WEDDING_EXPO_PROFILE];
  }
};

export const saveDownloadedTtsProfile = (profile: {
  script: string;
  notes: string;
  voiceId: string;
  emotion: Emotion;
  dialect: Dialect;
  pacing: SpeechPacing;
}) => {
  try {
    const extracted = extractPronunciationPairs(profile.notes);
    savePronunciationPairs(extracted);

    const profiles = getRememberedTtsProfiles();
    const newEntry: RememberedTtsProfile = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
      script: profile.script.trim(),
      notes: profile.notes.trim(),
      voiceId: profile.voiceId,
      emotion: profile.emotion,
      dialect: profile.dialect,
      pacing: profile.pacing,
      extractedPronunciations: extracted,
    };

    // Keep unique scripts at the top, max 50 entries
    const filtered = profiles.filter(p => p.script.toLowerCase() !== newEntry.script.toLowerCase());
    const updated = [newEntry, ...filtered].slice(0, 50);
    localStorage.setItem(TTS_STORAGE_KEY, JSON.stringify(updated));
    console.log('[MemoryStore] Successfully remembered TTS download profile and pronunciations.');
  } catch (e) {
    console.warn('[MemoryStore] Failed to save TTS download profile:', e);
  }
};

export const getAutoPronunciationGuidance = (script: string, existingNotes: string): string => {
  const dict = getPronunciationDictionary();
  const words = script.toLowerCase().match(/[a-zA-Z0-9_\u0B80-\u0BFF]+/g) || [];
  const foundMappings: string[] = [];

  for (const word of words) {
    if (dict[word] && !existingNotes.toLowerCase().includes(dict[word].toLowerCase())) {
      foundMappings.push(`${word} -> ${dict[word]}`);
    }
  }

  if (foundMappings.length === 0) return existingNotes;
  const autoGuidance = `[Remembered Pronunciations: ${Array.from(new Set(foundMappings)).join(', ')}]`;
  return existingNotes.trim() ? `${existingNotes.trim()} | ${autoGuidance}` : autoGuidance;
};

export const getRememberedDubbingProfiles = (): RememberedDubbingProfile[] => {
  try {
    const raw = localStorage.getItem(DUBBING_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
};

export const saveDownloadedDubbingProfile = (profile: {
  fileName: string;
  fileSize: number;
  language: string;
  style: string;
  transcription: string;
  translation: string;
  fingerprint: any;
}) => {
  try {
    const profiles = getRememberedDubbingProfiles();
    const newEntry: RememberedDubbingProfile = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
      fileName: profile.fileName,
      fileSize: profile.fileSize,
      language: profile.language,
      style: profile.style,
      transcription: profile.transcription,
      translation: profile.translation,
      fingerprint: profile.fingerprint,
    };

    const filtered = profiles.filter(
      p => !(p.fileName === profile.fileName && p.fileSize === profile.fileSize && p.language === profile.language)
    );
    const updated = [newEntry, ...filtered].slice(0, 50);
    localStorage.setItem(DUBBING_STORAGE_KEY, JSON.stringify(updated));
    console.log('[MemoryStore] Successfully remembered Dubbing download profile.');
  } catch (e) {
    console.warn('[MemoryStore] Failed to save Dubbing download profile:', e);
  }
};

export const findRememberedDubbing = (
  fileName: string,
  fileSize: number,
  language: string,
  style: string
): RememberedDubbingProfile | undefined => {
  const profiles = getRememberedDubbingProfiles();
  return profiles.find(
    p => p.fileName === fileName && p.fileSize === fileSize && p.language === language && p.style === style
  );
};
