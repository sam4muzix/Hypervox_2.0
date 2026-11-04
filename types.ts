
export enum VoiceGender {
  MALE = 'Male',
  FEMALE = 'Female'
}

export interface VoiceOption {
  id: string;
  name: string;
  gender: VoiceGender;
  apiVoiceName: string; 
  persona: string;
  tag?: string;
  category?: string;
}

export interface MultiSpeakerOptions {
  femaleVoiceName?: string;
  maleVoiceName?: string;
}


export enum Emotion {
  SHOUTING        = 'ULTRA-HIGH ENERGY / MAXIMUM SHOUT',
  PEPPY           = 'PEPPY / RADIO PROMO',
  DRAMATIC        = 'DRAMATIC / CINEMATIC TRAILER',
  LUXURY          = 'LUXURY / WHISPER-SOFT',
  HAPPY           = 'CHEERFUL / RETAIL AD',
  SAD             = 'EMOTIONAL / STORYTELLING',
  NEUTRAL         = 'NEUTRAL / NEWS ANNOUNCER',
  ANNOUNCEMENT    = 'AUTHORITATIVE CORPORATE',
  CRICKET_STADIUM = 'CRICKET STADIUM / SHOUTING ROAR',
  SARCASM             = 'SARCASM / WITTY',
  CONVERSATIONAL      = 'CONVERSATIONAL / NATURAL SPEAKING',
  EXCITED             = 'EXCITED / HIGH ENERGY ENTHUSIASM',
  DEEP_BASS           = 'DEEP BASS / RUMBLING AUTHORITY',
  CINEMATIC_NARRATION = 'CINEMATIC NARRATION / TRAILER EPIC',
  JEWELLERY_ELEGANT   = 'JEWELLERY ELEGANT / SOFT GROUNDED RICHNESS',
}

export enum Dialect {
  CHENNAI_TAMIL = 'Tamil (Colloquial speaking form, authentic spoken vernacular cadence, native pronunciation, strictly NO foreign/British accent)',
  CLASSIC_TAMIL = 'Tamil (Formal literature form, classical Senthamizh literary pronunciation, strict formal enunciation, native accent)',
  MALAYALAM = 'Malayalam (Colloquial speaking form, natural contemporary Central/urban spoken dialect, crisp conversational cadence)',
  MALAYALAM_FORMAL = 'Malayalam (Formal literature form, standard broadcast literary pronunciation, classical diction)',
  KANNADA = 'Kannada (Colloquial speaking form, dynamic modern urban conversational dialect, upbeat natural delivery)',
  KANNADA_FORMAL = 'Kannada (Formal literature form, standard literary classical pronunciation, formal enunciation)',
  TELUGU = 'Telugu (Colloquial speaking form, crisp energetic urban contemporary conversational dialect, natural cadence)',
  TELUGU_FORMAL = 'Telugu (Formal literature form, standard literary classical pronunciation, formal enunciation)',
  INDIAN_ENGLISH = 'Indian English',
  REGULAR_ENGLISH = 'Regular English (Standard neutral accent, clear international pronunciation)'
}

export enum RegionalLanguage {
  TAMIL = 'Tamil',
  MALAYALAM = 'Malayalam',
  KANNADA = 'Kannada',
  TELUGU = 'Telugu',
  ENGLISH = 'English',
}

export interface DialectOption {
  dialect: Dialect;
  label: string;
}

export const LANGUAGE_DIALECTS: Record<RegionalLanguage, DialectOption[]> = {
  [RegionalLanguage.TAMIL]: [
    { dialect: Dialect.CHENNAI_TAMIL, label: 'Colloquial' },
    { dialect: Dialect.CLASSIC_TAMIL, label: 'Formal' },
  ],
  [RegionalLanguage.MALAYALAM]: [
    { dialect: Dialect.MALAYALAM, label: 'Colloquial' },
    { dialect: Dialect.MALAYALAM_FORMAL, label: 'Formal' },
  ],
  [RegionalLanguage.KANNADA]: [
    { dialect: Dialect.KANNADA, label: 'Colloquial' },
    { dialect: Dialect.KANNADA_FORMAL, label: 'Formal' },
  ],
  [RegionalLanguage.TELUGU]: [
    { dialect: Dialect.TELUGU, label: 'Colloquial' },
    { dialect: Dialect.TELUGU_FORMAL, label: 'Formal' },
  ],
  [RegionalLanguage.ENGLISH]: [
    { dialect: Dialect.INDIAN_ENGLISH, label: 'Indian English' },
    { dialect: Dialect.REGULAR_ENGLISH, label: 'Regular English' },
  ],
};

export const getLanguageFromDialect = (d: Dialect): RegionalLanguage => {
  if (d === Dialect.CHENNAI_TAMIL || d === Dialect.CLASSIC_TAMIL) return RegionalLanguage.TAMIL;
  if (d === Dialect.MALAYALAM || d === Dialect.MALAYALAM_FORMAL) return RegionalLanguage.MALAYALAM;
  if (d === Dialect.KANNADA || d === Dialect.KANNADA_FORMAL) return RegionalLanguage.KANNADA;
  if (d === Dialect.TELUGU || d === Dialect.TELUGU_FORMAL) return RegionalLanguage.TELUGU;
  return RegionalLanguage.ENGLISH;
};

export interface ProcessingFile {
  id: string;
  file: File;
  language: string; 
  status: 'pending' | 'processing' | 'completed' | 'failed';
  outputUrl?: string;
  outputBlob?: Blob; 
  error?: string;
}

export interface TranscriptionJob {
  id: string;
  file: File;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  outputText?: string;
  error?: string;
}

export enum SpeechPacing {
  SLOW   = 'Slow',
  MEDIUM = 'Medium',
  FAST   = 'Fast',
}

export type DubbingStyle = 'Classical' | 'Local Speaking Form';
export type DubbingGender = 'Auto (Match Source)' | 'Male' | 'Female';
export type TranscriptionStyle = 'Straight Translation' | 'Colloquial (Local Slang)' | 'Classical (Formal)';

export interface StorySegment {
  id: string;
  speaker: string;
  voiceId: string;
  voiceName: string;
  apiVoiceName: string;
  gender: VoiceGender;
  persona: string;
  emotion: Emotion;
  dialect: Dialect;
  text: string;
  type: 'narration' | 'dialogue';
  notes?: string;
}

