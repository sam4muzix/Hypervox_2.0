import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Dialect, Emotion, SpeechPacing, VoiceGender, VoiceOption, RegionalLanguage, LANGUAGE_DIALECTS, getLanguageFromDialect } from '../types';
import { generateSpotAudio, clearAudioCache, optimizeScript, cloneVoiceZeroShot, convertVoiceToVoice, detectDialogueScript, localizeAdCopy, LocalizedAdCopyResult } from '../services/geminiService';
import { getBrandFilename } from '../utils/audio';
import { saveDownloadedTtsProfile, getRememberedTtsProfiles, RememberedTtsProfile, LOCKED_WEDDING_EXPO_PROFILE } from '../utils/memoryStore';
import { AudioWaveform } from './AudioWaveform';
import { VoiceCloningModal } from './VoiceCloningModal';
import { WordPrecisionEditorModal } from './WordPrecisionEditorModal';

const AVAILABLE_VOICES: VoiceOption[] = [
  // ── Custom Cloned Voice (Voice Conversion Engine) ──
  { 
    id: 'custom_cloned_voice', 
    name: 'Custom Cloned Voice', 
    gender: VoiceGender.MALE, 
    apiVoiceName: 'Voice Conversion', 
    persona: 'Authentic zero-shot voice conversion matching the vocal timbre, pitch, and resonance of your uploaded sample',
    tag: 'My Voice Sample',
    category: 'Custom Voice'
  },

  // ── Male Voices ──
  { 
    id: 'm_arjun_rj', 
    name: 'Arjun — Electric RJ', 
    gender: VoiceGender.MALE, 
    apiVoiceName: 'Fenrir', 
    persona: 'High-energy FM radio jockey & prime-time commercial superstar with electric Tamil & English swagger',
    tag: 'Radio RJ',
    category: 'Radio & Commercial'
  },
  { 
    id: 'm_vikram_char', 
    name: 'Vikram — Modern Urban', 
    gender: VoiceGender.MALE, 
    apiVoiceName: 'Puck', 
    persona: 'Charismatic, witty, natural conversationalist & creator voice with effortless charm',
    tag: 'Casual & Vlog',
    category: 'Natural & Casual'
  },
  { 
    id: 'm_rajan_trailer', 
    name: 'Rajan — Blockbuster Trailer', 
    gender: VoiceGender.MALE, 
    apiVoiceName: 'Fenrir', 
    persona: 'Epic movie trailer narrator with deep theatrical gravitas, explosive authority, and grand scale',
    tag: 'Cinematic',
    category: 'Cinematic & Bass'
  },
  { 
    id: 'm_anand_velvet', 
    name: 'Anand — Velvet Thunder', 
    gender: VoiceGender.MALE, 
    apiVoiceName: 'Orus', 
    persona: 'Ultra-smooth resonant baritone — warm velvet wrapped around thunderous chest harmonics',
    tag: 'Velvet Baritone',
    category: 'Cinematic & Bass'
  },
  { 
    id: 'm_titan_sub', 
    name: 'Titan — Deep Subwoofer', 
    gender: VoiceGender.MALE, 
    apiVoiceName: 'Iapetus', 
    persona: 'Ultra-low frequency subwoofer bass voice with commanding, godlike reverberation',
    tag: 'Subwoofer Bass',
    category: 'Cinematic & Bass'
  },
  { 
    id: 'm_kabir_doc', 
    name: 'Kabir — Resonant Anchor', 
    gender: VoiceGender.MALE, 
    apiVoiceName: 'Charon', 
    persona: 'Authoritative, intellectual documentary narrator and seasoned prime-time investigative host',
    tag: 'Documentary',
    category: 'Corporate & News'
  },
  { 
    id: 'm_dev_exec', 
    name: 'Dev — Executive Keynote', 
    gender: VoiceGender.MALE, 
    apiVoiceName: 'Algenib', 
    persona: 'Polished tech visionary, corporate keynote presenter with crisp articulate confidence',
    tag: 'Corporate Pro',
    category: 'Corporate & News'
  },
  { 
    id: 'm_surya_news', 
    name: 'Surya — Broadcast News', 
    gender: VoiceGender.MALE, 
    apiVoiceName: 'Enceladus', 
    persona: 'Razor-sharp international broadcast journalist with crystal-clear Indian & Regular English diction',
    tag: 'Broadcast',
    category: 'Corporate & News'
  },
  { 
    id: 'm_karthik_pod', 
    name: 'Karthik — Fireside Story', 
    gender: VoiceGender.MALE, 
    apiVoiceName: 'Sadaltager', 
    persona: 'Warm, empathetic, natural bedside storyteller & podcaster with magnetic conversational rhythm',
    tag: 'Storyteller',
    category: 'Natural & Casual'
  },

  // ── Female Voices ──
  { 
    id: 'f_anitha_anchor', 
    name: 'Anitha — Classic Senthamizh', 
    gender: VoiceGender.FEMALE, 
    apiVoiceName: 'Kore', 
    persona: 'Refined, melodic classical Tamil anchor with impeccable pronunciation and stately grace',
    tag: 'Senthamizh',
    category: 'Corporate & News'
  },
  { 
    id: 'f_priya_urban', 
    name: 'Priya — Bubbly Modern', 
    gender: VoiceGender.FEMALE, 
    apiVoiceName: 'Leda', 
    persona: 'Vibrant, trendy city girl with sparkling youthful energy, infectious enthusiasm, and commercial flair',
    tag: 'Trendy & Upbeat',
    category: 'Radio & Commercial'
  },
  { 
    id: 'f_meera_breezy', 
    name: 'Meera — Breezy Acoustic', 
    gender: VoiceGender.FEMALE, 
    apiVoiceName: 'Aoede', 
    persona: 'Soothing, lyrical acoustic voice with warm natural presence and intimate emotional depth',
    tag: 'Acoustic Warmth',
    category: 'Natural & Casual'
  },
  { 
    id: 'f_scarlett_power', 
    name: 'Scarlett — Cinematic Power', 
    gender: VoiceGender.FEMALE, 
    apiVoiceName: 'Kore', 
    persona: 'Commanding, husky, and highly modulated cinematic ad voice with deep power, authority, and dynamic projection (classic Scarlett style)',
    tag: 'Cinematic Power',
    category: 'Radio & Commercial'
  },
  { 
    id: 'f_scarlett_luxury', 
    name: 'Scarlett — Seductive Luxury', 
    gender: VoiceGender.FEMALE, 
    apiVoiceName: 'Sulafat', 
    persona: 'Silky, intimate, breathy luxury brand ambassador — the essence of high fashion and exclusive allure',
    tag: 'Haute Luxury',
    category: 'Luxury & Smooth'
  },
  { 
    id: 'f_roshni_power', 
    name: 'Roshni — Power Retail', 
    gender: VoiceGender.FEMALE, 
    apiVoiceName: 'Autonoe', 
    persona: 'Bold, punchy, commanding commercial Diva with dynamic projection for high-conversion ads',
    tag: 'Power Commercial',
    category: 'Radio & Commercial'
  },
  { 
    id: 'f_tara_narration', 
    name: 'Tara — Velvet Narration', 
    gender: VoiceGender.FEMALE, 
    apiVoiceName: 'Callirrhoe', 
    persona: 'Hypnotic, velvety smooth narrative artist crafted for captivating audiobooks and rich brand films',
    tag: 'Audiobook Velvet',
    category: 'Luxury & Smooth'
  },
  { 
    id: 'f_maya_husky', 
    name: 'Maya — Smoky Contralto', 
    gender: VoiceGender.FEMALE, 
    apiVoiceName: 'Despina', 
    persona: 'Deep, smoky, sultry cinematic voice with magnetic harmonic richness and noir allure',
    tag: 'Smoky & Sultry',
    category: 'Luxury & Smooth'
  },
  { 
    id: 'f_zara_trailer', 
    name: 'Zara — Cinematic Empress', 
    gender: VoiceGender.FEMALE, 
    apiVoiceName: 'Erinome', 
    persona: 'Commanding theatrical queen with thrilling orchestral gravitas and dramatic movie trailer presence',
    tag: 'Epic Trailer',
    category: 'Cinematic & Bass'
  },
  { 
    id: 'f_nandini_gentle', 
    name: 'Nandini — Gentle Empath', 
    gender: VoiceGender.FEMALE, 
    apiVoiceName: 'Achernar', 
    persona: 'Soft, tender, heartfelt storyteller that brings deep emotional sincerity to touching narratives',
    tag: 'Gentle & Emotive',
    category: 'Natural & Casual'
  },
  { 
    id: 'f_padma_jewellery', 
    name: 'Padma — Jewellery Elegance', 
    gender: VoiceGender.FEMALE, 
    apiVoiceName: 'Aoede', 
    persona: 'Soft, grounded, and richly elegant jewellery ad voice — warm yet refined, like the timeless intimacy of Joy Alukkas ads. Speaks with gentle authority, understated luxury, and deep emotional grace that evokes gold, tradition, and modern Indian femininity',
    tag: 'Jewellery Ad',
    category: 'Luxury & Smooth'
  },
  // ── Kids Characters (Age 10–15) ──
  { 
    id: 'k_aarav_boy', 
    name: 'Aarav — Schoolboy Kid (Age 10-12)', 
    gender: VoiceGender.MALE, 
    apiVoiceName: 'Puck', 
    persona: 'Pre-pubescent 10 to 12-year-old schoolboy with high-pitched child vocal cords, light juvenile vocal weight, playful boyish cadence, and innocent kid excitement (never adult)',
    tag: 'Kid Boy (10-12)',
    category: 'Kids & Animation'
  },
  { 
    id: 'k_ananya_girl', 
    name: 'Ananya — Schoolgirl Kid (Age 10-12)', 
    gender: VoiceGender.FEMALE, 
    apiVoiceName: 'Achird', 
    persona: 'Pre-pubescent 10 to 12-year-old schoolgirl with high-pitched child vocal cords, sweet innocent tone, light juvenile vocal tract, and joyful kid wonder (never adult)',
    tag: 'Kid Girl (10-12)',
    category: 'Kids & Animation'
  },
  { 
    id: 'f_koko_parrot', 
    name: 'Koko — Animated Character', 
    gender: VoiceGender.FEMALE, 
    apiVoiceName: 'Achird', 
    persona: 'High-pitched, playful animated parrot mascot with cute squawks, chirps, and cartoon charm',
    tag: 'Animated Mascot',
    category: 'Kids & Animation'
  },
  // ── Chorus & Multi-Voice Ensembles ──
  { 
    id: 'chorus_grand_choir', 
    name: 'Chorus — Grand Vocal Choir (Mixed Voices)', 
    gender: VoiceGender.FEMALE, 
    apiVoiceName: 'multi', 
    persona: 'Grand multi-voice chorus ensemble of mixed male & female voices speaking in harmonious unison with rich acoustic width',
    tag: 'Grand Choir',
    category: 'Chorus & Multi-Voice'
  },
  { 
    id: 'chorus_stadium_crowd', 
    name: 'Chorus — Stadium Roar & Crowd Chants', 
    gender: VoiceGender.MALE, 
    apiVoiceName: 'multi', 
    persona: 'Thunderous stadium crowd chanting in unison with massive multi-voice power, collective excitement, and stadium echo',
    tag: 'Stadium Crowd',
    category: 'Chorus & Multi-Voice'
  }
];

/** Minimalist SVG Icons for Pacing */
const PACING_ICONS: Record<SpeechPacing, React.ReactNode> = {
  [SpeechPacing.SLOW]: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  [SpeechPacing.MEDIUM]: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 8.25h16.5" />
    </svg>
  ),
  [SpeechPacing.FAST]: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
    </svg>
  ),
};

/** Categorized Emotion Delivery Vibes */
const VIBE_CATEGORIES = [
  {
    category: 'High Energy',
    items: [
      { vibe: Emotion.SHOUTING, label: 'Shout' },
      { vibe: Emotion.PEPPY, label: 'Peppy' },
      { vibe: Emotion.EXCITED, label: 'Excited' },
      { vibe: Emotion.CRICKET_STADIUM, label: 'Stadium' },
      { vibe: Emotion.ANNOUNCEMENT, label: 'Announce' },
    ]
  },
  {
    category: 'Cinematic & Deep',
    items: [
      { vibe: Emotion.DRAMATIC, label: 'Dramatic' },
      { vibe: Emotion.DEEP_BASS, label: 'Deep Bass' },
      { vibe: Emotion.CINEMATIC_NARRATION, label: 'Cinematic' },
    ]
  },
  {
    category: 'Natural & Casual',
    items: [
      { vibe: Emotion.HAPPY, label: 'Happy' },
      { vibe: Emotion.NEUTRAL, label: 'Neutral' },
      { vibe: Emotion.CONVERSATIONAL, label: 'Casual' },
    ]
  },
  {
    category: 'Stylized',
    items: [
      { vibe: Emotion.SARCASM, label: 'Sarcasm' },
      { vibe: Emotion.SAD, label: 'Sad' },
      { vibe: Emotion.LUXURY, label: 'Luxury' },
      { vibe: Emotion.JEWELLERY_ELEGANT, label: 'Jewellery' },
    ]
  }
];

/** Minimalist SVG Icons for Emotion Vibes */
const EMOTION_ICONS: Record<Emotion, React.ReactNode> = {
  [Emotion.SHOUTING]: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
    </svg>
  ),
  [Emotion.PEPPY]: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 0L15.75 18m3.75-12v12m-13.5-3a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z" />
    </svg>
  ),
  [Emotion.EXCITED]: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 21l-1.81-4.096L3 15l5.096-1.81L9 9.813l1.81 5.096L15 17l-5.187 1.096z" />
    </svg>
  ),
  [Emotion.CRICKET_STADIUM]: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5" />
    </svg>
  ),
  [Emotion.ANNOUNCEMENT]: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.38-.09-2.072-.09H6a2.25 2.25 0 01-2.25-2.25v-3C3.75 9.25 4.757 8.25 6 8.25h2.268c.69 0 1.384-.03 2.072-.09l7.007-2.628c.677-.254 1.403.245 1.403.966v11.004c0 .72-.726 1.22-1.403.966l-7.007-2.628z" />
    </svg>
  ),
  [Emotion.DRAMATIC]: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5m15.75 0a1.125 1.125 0 001.125-1.125M20.625 19.5h-1.5" />
    </svg>
  ),
  [Emotion.DEEP_BASS]: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.375 9L15 12l-5.625 3V9zM21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  [Emotion.CINEMATIC_NARRATION]: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-2.36a.75.75 0 011.03.69v7.34a.75.75 0 01-1.03.69l-4.72-2.36V10.5zM4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
    </svg>
  ),
  [Emotion.HAPPY]: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm6 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75z" />
    </svg>
  ),
  [Emotion.NEUTRAL]: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5-3h7.5M8.25 6.75h1.5" />
    </svg>
  ),
  [Emotion.SARCASM]: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  [Emotion.SAD]: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm6 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-6.75 4.5a3.75 3.75 0 017.5 0" />
    </svg>
  ),
  [Emotion.LUXURY]: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21V3m0 0L7.5 7.5M12 3l4.5 4.5" />
    </svg>
  ),
  [Emotion.JEWELLERY_ELEGANT]: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
    </svg>
  ),
  [Emotion.CONVERSATIONAL]: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
    </svg>
  ),
};

const AudioVisualizerMeter: React.FC<{ isPlaying: boolean }> = ({ isPlaying }) => {
  return (
    <div className="flex items-end justify-center gap-[3px] h-8 px-3 py-1 bg-black/40 rounded-xl border border-white/10">
      {[40, 70, 30, 85, 60, 95, 45, 75, 55, 90, 65, 35, 80, 50, 60].map((height, i) => (
        <div
          key={i}
          className={`w-1 rounded-full transition-all duration-300 ${
            isPlaying ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600/40'
          }`}
          style={{
            height: isPlaying ? `${Math.max(20, Math.sin(i + Date.now()) * 100)}%` : `${height / 3.5}%`,
            animationDelay: `${i * 0.08}s`
          }}
        />
      ))}
    </div>
  );
};

const DEFAULT_LANG_STORAGE_KEY = 'hypervox_default_language';
const DEFAULT_DIALECT_STORAGE_KEY = 'hypervox_default_dialect';

const getSavedDefaultLanguage = (): RegionalLanguage => {
  try {
    const saved = localStorage.getItem(DEFAULT_LANG_STORAGE_KEY);
    if (saved && Object.values(RegionalLanguage).includes(saved as RegionalLanguage)) {
      return saved as RegionalLanguage;
    }
  } catch (e) {}
  return RegionalLanguage.TAMIL;
};

const getSavedDefaultDialect = (): Dialect => {
  try {
    const saved = localStorage.getItem(DEFAULT_DIALECT_STORAGE_KEY);
    if (saved && Object.values(Dialect).includes(saved as Dialect)) {
      return saved as Dialect;
    }
  } catch (e) {}
  return Dialect.CHENNAI_TAMIL; // Tamil, Colloquial default
};

const TtsPanel: React.FC = () => {
  const [defaultLang, setDefaultLang] = useState<RegionalLanguage>(getSavedDefaultLanguage);
  const [defaultDialect, setDefaultDialect] = useState<Dialect>(getSavedDefaultDialect);

  const [selectedLanguage, setSelectedLanguage] = useState<RegionalLanguage>(defaultLang);
  const [dialect, setDialect] = useState<Dialect>(defaultDialect);

  // Keep language in sync if dialect changes programmatically
  useEffect(() => {
    const lang = getLanguageFromDialect(dialect);
    setSelectedLanguage(lang);
  }, [dialect]);

  const isCurrentSelectionDefault = selectedLanguage === defaultLang && dialect === defaultDialect;

  const handleMakeDefault = () => {
    try {
      localStorage.setItem(DEFAULT_LANG_STORAGE_KEY, selectedLanguage);
      localStorage.setItem(DEFAULT_DIALECT_STORAGE_KEY, dialect);
      setDefaultLang(selectedLanguage);
      setDefaultDialect(dialect);
      const dialectLabel = LANGUAGE_DIALECTS[selectedLanguage]?.find(d => d.dialect === dialect)?.label || 'Selected Dialect';
      setToastMessage(`Saved ${selectedLanguage} (${dialectLabel}) as your default!`);
      setTimeout(() => setToastMessage(null), 3000);
    } catch (e) {
      console.error('Failed to save default dialect:', e);
    }
  };

  const [script, setScript] = useState('');
  const [isAutoLocalizing, setIsAutoLocalizing] = useState(false);

  const autoLocalizeScriptForDialect = async (targetLang: RegionalLanguage, targetDialect: Dialect, currentScript?: string) => {
    let rawText = (currentScript !== undefined ? currentScript : script).trim();
    if (!rawText || targetLang === RegionalLanguage.ENGLISH) return;

    // Strip any existing markdown headers or dividers already in the console before translating
    const firstDivider = rawText.search(/\n\s*---\s*\n|\n\s*#{1,4}\s*(?:Malayalam|Kannada|Telugu|Tamil)/i);
    if (firstDivider !== -1) {
      rawText = rawText.substring(0, firstDivider).trim();
    }
    const cleanSourceText = rawText
      .replace(/^#{1,4}\s*(?:Malayalam|Kannada|Telugu|Tamil|Script|Broadcast|Localization)[^\n]*\n?/gim, '')
      .replace(/^---+$/gm, '')
      .trim();

    if (!cleanSourceText) return;

    const isFormal = targetDialect === Dialect.CLASSIC_TAMIL ||
                     targetDialect === Dialect.MALAYALAM_FORMAL ||
                     targetDialect === Dialect.KANNADA_FORMAL ||
                     targetDialect === Dialect.TELUGU_FORMAL;

    const langName = targetLang as 'Malayalam' | 'Kannada' | 'Telugu' | 'Tamil';
    setIsAutoLocalizing(true);
    try {
      const res = await localizeAdCopy(cleanSourceText, [langName], isFormal ? 'formal' : 'colloquial');
      const key = langName.toLowerCase() as 'malayalam' | 'kannada' | 'telugu' | 'tamil';
      const localized = res[key]?.trim();
      if (localized) {
        setScript(localized);
        setToastMessage(`Auto-localized script to ${targetLang} (${isFormal ? 'Formal' : 'Colloquial'})`);
        setTimeout(() => setToastMessage(null), 3000);
      }
    } catch (err: any) {
      console.warn('[autoLocalizeScriptForDialect] Error:', err);
    } finally {
      setIsAutoLocalizing(false);
    }
  };

  const handleLanguageChange = (newLang: RegionalLanguage) => {
    setSelectedLanguage(newLang);
    const availableDialects = LANGUAGE_DIALECTS[newLang];
    if (availableDialects && availableDialects.length > 0) {
      const nextDialect = availableDialects.some(d => d.dialect === dialect) ? dialect : availableDialects[0].dialect;
      setDialect(nextDialect);
      autoLocalizeScriptForDialect(newLang, nextDialect);
    }
  };

  const handleDialectChange = (newDialect: Dialect) => {
    setDialect(newDialect);
    const lang = getLanguageFromDialect(newDialect);
    setSelectedLanguage(lang);
    autoLocalizeScriptForDialect(lang, newDialect);
  };
  const [selectedVoice, setSelectedVoice] = useState<VoiceOption>(AVAILABLE_VOICES[0]);
  const [voiceFilter, setVoiceFilter] = useState<string>('ALL');
  const [emotion, setEmotion] = useState<Emotion>(Emotion.NEUTRAL);
  const [pacing, setPacing] = useState<SpeechPacing>(SpeechPacing.MEDIUM);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [notes, setNotes] = useState('');
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [rememberedProfiles, setRememberedProfiles] = useState<RememberedTtsProfile[]>(() => getRememberedTtsProfiles());

  // ── Multi-Speaker Dialogue (FVO & MVO) States ──
  const dialogueInfo = useMemo(() => detectDialogueScript(script), [script]);
  const [dialogueFemaleVoice, setDialogueFemaleVoice] = useState<string>('Aoede');
  const [dialogueMaleVoice, setDialogueMaleVoice] = useState<string>('Fenrir');

  // Filter matching helper for dynamic voice artist catalog
  const isVoiceMatchingFilter = useCallback((v: VoiceOption, filter: string): boolean => {
    if (filter === 'ALL') return true;
    if (filter === 'Male') return v.gender === VoiceGender.MALE && v.category !== 'Kids & Animation' && v.id !== 'custom_cloned_voice';
    if (filter === 'Female') return v.gender === VoiceGender.FEMALE && v.category !== 'Kids & Animation';
    if (filter === 'Kids & Animation') return v.category === 'Kids & Animation';
    if (filter === 'Custom Voice') return v.id === 'custom_cloned_voice' || v.category === 'Custom Voice';
    return v.category === filter;
  }, []);

  const filteredVoices = useMemo(() => {
    return AVAILABLE_VOICES.filter(v => isVoiceMatchingFilter(v, voiceFilter));
  }, [voiceFilter, isVoiceMatchingFilter]);

  const handleSelectVoiceFilter = (filterKey: string) => {
    setVoiceFilter(filterKey);
    if (filterKey === 'Custom Voice') {
      const cv = AVAILABLE_VOICES.find(v => v.id === 'custom_cloned_voice');
      if (cv) setSelectedVoice(cv);
      setIsCloneModalOpen(true);
      return;
    }
    const matching = AVAILABLE_VOICES.filter(v => isVoiceMatchingFilter(v, filterKey));
    if (matching.length > 0 && !matching.some(v => v.id === selectedVoice.id)) {
      setSelectedVoice(matching[0]);
    }
  };

  // Sync dialogue voice defaults when user selects a specific artist in catalog
  useEffect(() => {
    if (selectedVoice.gender === VoiceGender.FEMALE && selectedVoice.apiVoiceName !== 'multi') {
      setDialogueFemaleVoice(selectedVoice.apiVoiceName);
    } else if (selectedVoice.gender === VoiceGender.MALE && selectedVoice.apiVoiceName !== 'multi') {
      setDialogueMaleVoice(selectedVoice.apiVoiceName);
    }
  }, [selectedVoice]);

  // ── Zero-Shot Voice Cloning & Voice-to-Voice States ──
  const [referenceVoiceFile, setReferenceVoiceFile] = useState<File | null>(null);
  const [slicedReferenceVoiceFile, setSlicedReferenceVoiceFile] = useState<File | null>(null);
  const [sourceVoiceFile, setSourceVoiceFile] = useState<File | null>(null);
  const [clonedAudioUrl, setClonedAudioUrl] = useState<string | null>(null);
  const [isCloning, setIsCloning] = useState(false);
  const [isConvertingVc, setIsConvertingVc] = useState(false);
  const [cloneProgress, setCloneProgress] = useState({ current: 0, total: 0 });
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [isPlayingCloned, setIsPlayingCloned] = useState(false);
  const [activeOutputTab, setActiveOutputTab] = useState<'original' | 'cloned'>('original');
  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
  const [isWordEditorOpen, setIsWordEditorOpen] = useState(false);

  const [isDraggingRef, setIsDraggingRef] = useState(false);
  const [isDraggingSource, setIsDraggingSource] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clonedAudioRef = useRef<HTMLAudioElement | null>(null);
  const refVoiceInputRef = useRef<HTMLInputElement | null>(null);
  const sourceVoiceInputRef = useRef<HTMLInputElement | null>(null);

  const isAudioFile = (file: File): boolean => {
    if (file.type && file.type.startsWith('audio/')) return true;
    const lower = file.name.toLowerCase();
    return /\.(wav|mp3|m4a|aac|flac|ogg|webm|wma|opus)$/i.test(lower);
  };

  const handleReferenceFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setReferenceVoiceFile(file);
      setSlicedReferenceVoiceFile(file);
      setCloneError(null);
      if (clonedAudioUrl) {
        URL.revokeObjectURL(clonedAudioUrl);
        setClonedAudioUrl(null);
      }
    }
    e.target.value = '';
  };

  const handleSourceFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSourceVoiceFile(file);
      setCloneError(null);
    }
    e.target.value = '';
  };

  const handleDropReference = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingRef(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (isAudioFile(file)) {
        setReferenceVoiceFile(file);
        setSlicedReferenceVoiceFile(file);
        setCloneError(null);
        if (clonedAudioUrl) {
          URL.revokeObjectURL(clonedAudioUrl);
          setClonedAudioUrl(null);
        }
      } else {
        setCloneError("Unsupported file type. Please upload an audio file (.wav, .mp3, .m4a, etc.)");
      }
    }
  };

  const handleDropSource = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingSource(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (isAudioFile(file)) {
        setSourceVoiceFile(file);
        setCloneError(null);
      } else {
        setCloneError("Unsupported file type. Please upload an audio file (.wav, .mp3, .m4a, etc.)");
      }
    }
  };

  const handleCloneVoice = async () => {
    if (!referenceVoiceFile) {
      setCloneError("Please choose a clean speaker reference audio sample first.");
      return;
    }
    if (!script.trim()) {
      setCloneError("Script cannot be empty.");
      return;
    }

    setIsCloning(true);
    setCloneError(null);
    setCloneProgress({ current: 0, total: 0 });

    try {
      const targetSample = slicedReferenceVoiceFile || referenceVoiceFile;
      const clonedBlob = await cloneVoiceZeroShot(
        script,
        targetSample,
        emotion,
        dialect,
        pacing,
        (current, total) => setCloneProgress({ current, total })
      );
      if (clonedAudioUrl) URL.revokeObjectURL(clonedAudioUrl);
      const url = URL.createObjectURL(clonedBlob);
      setClonedAudioUrl(url);
      setActiveOutputTab('cloned');
      setToastMessage("Custom voice clone synthesized successfully!");
      setTimeout(() => setToastMessage(null), 3500);
    } catch (err: any) {
      console.error("[VoiceClone] Error:", err);
      setCloneError(err.message || "Failed to clone voice.");
    } finally {
      setIsCloning(false);
    }
  };

  const handleVoiceToVoice = async () => {
    if (!referenceVoiceFile) {
      setCloneError("Please upload your target speaker reference audio sample first.");
      refVoiceInputRef.current?.click();
      return;
    }

    let sourceBlob: Blob | null = null;
    if (sourceVoiceFile) {
      sourceBlob = sourceVoiceFile;
    } else if (audioUrl) {
      try {
        const resp = await fetch(audioUrl);
        sourceBlob = await resp.blob();
      } catch (e) {
        console.warn("Failed to fetch audioUrl blob for VC", e);
      }
    }

    if (!sourceBlob) {
      setCloneError("Please either generate an audio spot first, or upload a source speech audio file to convert.");
      return;
    }

    setIsConvertingVc(true);
    setCloneError(null);
    setCloneProgress({ current: 0, total: 3 });

    try {
      const targetSample = slicedReferenceVoiceFile || referenceVoiceFile;
      const speedMultiplier = pacing === SpeechPacing.SLOW ? 0.85 : pacing === SpeechPacing.FAST ? 1.15 : 1.0;
      const convertedBlob = await convertVoiceToVoice(
        sourceBlob,
        targetSample,
        speedMultiplier,
        (current, total) => setCloneProgress({ current, total })
      );
      if (clonedAudioUrl) URL.revokeObjectURL(clonedAudioUrl);
      const url = URL.createObjectURL(convertedBlob);
      setClonedAudioUrl(url);
      setActiveOutputTab('cloned');
      setToastMessage("Voice-to-Voice converted successfully!");
      setTimeout(() => setToastMessage(null), 3500);
    } catch (err: any) {
      console.error("[VoiceToVoice] Error:", err);
      setCloneError(err.message || "Failed to convert voice.");
    } finally {
      setIsConvertingVc(false);
    }
  };

  const handleLoadRememberedProfile = (profile: RememberedTtsProfile) => {
    setScript(profile.script);
    setNotes(profile.notes);
    setEmotion(profile.emotion);
    setDialect(profile.dialect);
    setPacing(profile.pacing);
    const matchedVoice = AVAILABLE_VOICES.find(v => v.id === profile.voiceId);
    if (matchedVoice) setSelectedVoice(matchedVoice);
    if (profile.id === LOCKED_WEDDING_EXPO_PROFILE.id) {
      setToastMessage("Locked 'Wedding Expo Radio Ad' profile loaded: Anitha • Shout Vibe • Chennai Tamil");
    } else {
      setToastMessage("Replicated downloaded spot configuration & pronunciations.");
    }
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleResetEngine = () => {
    clearAudioCache();
    setAudioUrl(null);
    setError(null);
    setToastMessage("Speech engine cache purged successfully.");
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleOptimize = async () => {
    if (!script.trim()) {
      setError({ message: 'Script cannot be empty. Type or paste your script first.' });
      return;
    }
    setIsOptimizing(true);
    setError(null);
    try {
      const optimized = await optimizeScript(script, dialect);
      setScript(optimized);
    } catch (err: any) {
      console.error("Optimization error:", err);
      setError({ message: 'Failed to auto-match vibes.' });
    } finally {
      setIsOptimizing(false);
    }
  };

  const MAX_STABLE_CHARS = 5000;



  const handleGenerate = async () => {
    if (!script.trim()) {
      setError({ message: 'Script cannot be empty.' });
      return;
    }

    // Direct Text-to-Voice Conversion if Custom Voice is selected
    if (selectedVoice.id === 'custom_cloned_voice') {
      if (!referenceVoiceFile) {
        setError({ message: 'Please upload a reference audio sample for your Custom Voice first.' });
        refVoiceInputRef.current?.click();
        return;
      }
      setIsLoading(true);
      setError(null);
      setProgress({ current: 0, total: 4 });
      if (audioUrl) URL.revokeObjectURL(audioUrl);

      try {
        const targetSample = slicedReferenceVoiceFile || referenceVoiceFile;
        const blob = await cloneVoiceZeroShot(
          script,
          targetSample,
          emotion,
          dialect,
          pacing,
          (current, total) => setProgress({ current, total })
        );
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setActiveOutputTab('original');
        setToastMessage("Custom voice synthesized successfully with your voice sample!");
        setTimeout(() => setToastMessage(null), 3500);
      } catch (err: any) {
        console.error("[CustomVoice] Error:", err);
        setError({ message: err.message || "Failed to generate custom cloned voice." });
      } finally {
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);
    setError(null);
    setProgress({ current: 0, total: 0 });
    if (audioUrl) URL.revokeObjectURL(audioUrl);

    try {
      const blob = await generateSpotAudio(
        script, 
        selectedVoice, 
        emotion, 
        dialect, 
        dialogueInfo.isDialogue, 
        notes, 
        (current, total) => setProgress({ current, total }),
        pacing,
        {
          femaleVoiceName: dialogueFemaleVoice,
          maleVoiceName: dialogueMaleVoice,
        }
      );
      setAudioUrl(URL.createObjectURL(blob));
    } catch (err: any) {
      console.error("Synthesis error:", err);
      let parsedError = err;
      try {
        if (err.message && err.message.startsWith('{')) {
          parsedError = JSON.parse(err.message);
        }
      } catch (e) {
        // Ignore
      }

      let errorMessage = parsedError.message || (parsedError.error && parsedError.error.message) || err.message || 'An unexpected error occurred.';
      const status = parsedError.status || parsedError.code || (parsedError.error && parsedError.error.code) || err.status || err.code;
      
      if (errorMessage.includes('TTS_ENGINE_ERROR: OTHER')) {
        errorMessage = "Engine unavailable after multiple retries. Try breaking your script into shorter paragraphs, switching voices (e.g. Fenrir → Puck), or wait 30 seconds and retry.";
      } else if (errorMessage.includes('TTS_ENGINE_ERROR: SAFETY')) {
        errorMessage = "Cloud safety policy flagged this script phrase. Try slightly softening extreme words, or switch to 'Custom Cloned Voice' for 100% unrestricted local zero-filter speech generation.";
      } else if (status === 429) {
        errorMessage = "API quota reached. Please check billing or try again in a minute.";
      }
      
      setError({ message: errorMessage, code: status?.toString() });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-fade-in relative">
      {/* Universal Hidden File Selectors at Root */}
      <input
        type="file"
        id="hypervox-ref-voice-input"
        accept="audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.webm,.wma,.opus"
        ref={refVoiceInputRef}
        onChange={handleReferenceFileSelect}
        className="hidden"
        style={{ display: 'none' }}
      />
      <input
        type="file"
        id="hypervox-source-voice-input"
        accept="audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.webm,.wma,.opus"
        ref={sourceVoiceInputRef}
        onChange={handleSourceFileSelect}
        className="hidden"
        style={{ display: 'none' }}
      />
      
      {/* ── Left Column: Performance Parameters + Voice Conversion (Stacked) ── */}
      <div className="lg:col-span-5 space-y-6">
        
        {/* Card 1: Performance Parameters */}
        <div className="liquid-glass p-5 space-y-5">
          <div className="pb-3 border-b border-white/10">
            <h2 className="text-xs font-bold text-white uppercase tracking-wider">
              Performance Parameters
            </h2>
          </div>
          
          <div className="space-y-4">
            {/* Language & Dialect Selection with User Default Persistence */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-gray-400 text-xs font-semibold uppercase tracking-wider">
                  Language & Dialect
                </label>
                
                {/* Make Default Indicator / Button */}
                {isCurrentSelectionDefault ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/40 flex items-center gap-1 shadow-sm">
                    <span>★ Default</span>
                  </span>
                ) : (
                  <button
                    onClick={handleMakeDefault}
                    type="button"
                    className="text-[10px] px-2.5 py-0.5 rounded-full bg-white/5 hover:bg-emerald-500/20 text-gray-400 hover:text-emerald-300 border border-white/10 hover:border-emerald-500/40 transition-all font-semibold flex items-center gap-1 cursor-pointer"
                    title="Save this Language and Dialect as your permanent startup default"
                  >
                    <span>☆ Make Default</span>
                  </button>
                )}
              </div>

              {/* Language Dropdown */}
              <div>
                <span className="block text-[11px] text-gray-400 font-medium mb-1">
                  Language
                </span>
                <div className="relative">
                  <select
                    value={selectedLanguage}
                    onChange={(e) => handleLanguageChange(e.target.value as RegionalLanguage)}
                    className="w-full bg-black/40 border border-white/10 hover:border-white/20 text-white rounded-xl p-2.5 text-xs appearance-none focus:border-emerald-500 focus:outline-none cursor-pointer transition-all font-medium pr-8"
                  >
                    {Object.values(RegionalLanguage).map((lang) => (
                      <option key={lang} value={lang}>
                        {lang === RegionalLanguage.TAMIL ? 'Tamil (தமிழ்)' :
                         lang === RegionalLanguage.MALAYALAM ? 'Malayalam (മലയാളം)' :
                         lang === RegionalLanguage.KANNADA ? 'Kannada (ಕನ್ನಡ)' :
                         lang === RegionalLanguage.TELUGU ? 'Telugu (తెలుగు)' :
                         'English'}
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 text-xs">
                    ▼
                  </div>
                </div>
              </div>

              {/* Dialect Dropdown (dynamically filtered by chosen language) */}
              <div>
                <span className="block text-[11px] text-gray-400 font-medium mb-1">
                  Dialect & Style
                </span>
                <div className="relative">
                  <select
                    value={dialect}
                    onChange={(e) => handleDialectChange(e.target.value as Dialect)}
                    className="w-full bg-black/40 border border-white/10 hover:border-white/20 text-white rounded-xl p-2.5 text-xs appearance-none focus:border-emerald-500 focus:outline-none cursor-pointer transition-all font-medium pr-8"
                  >
                    {LANGUAGE_DIALECTS[selectedLanguage]?.map((opt) => (
                      <option key={opt.dialect} value={opt.dialect}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 text-xs">
                    ▼
                  </div>
                </div>
              </div>
            </div>

            {/* Speech Pacing Control */}
            <div>
              <label className="block text-gray-400 text-xs font-semibold uppercase mb-1.5 tracking-wider">
                Speech Pacing & Tempo
              </label>
              <div className="grid grid-cols-3 gap-2 bg-black/30 p-1 rounded-xl border border-white/10">
                {([
                  { speed: SpeechPacing.SLOW,   label: 'Slow' },
                  { speed: SpeechPacing.MEDIUM,  label: 'Medium' },
                  { speed: SpeechPacing.FAST,    label: 'Fast' },
                ] as const).map(({ speed, label }) => {
                  const isSelected = pacing === speed;
                  return (
                    <button
                      key={speed}
                      onClick={() => setPacing(speed)}
                      className={`py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 select-none ${
                        isSelected
                          ? 'bg-emerald-500 text-black font-bold shadow-sm'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      {PACING_ICONS[speed]}
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Categorized Emotional Delivery Vibe Matrix */}
            <div>
              <label className="block text-gray-400 text-xs font-semibold uppercase mb-1.5 tracking-wider">
                Emotional Delivery Vibe
              </label>
              <div className="space-y-2.5">
                {VIBE_CATEGORIES.map(cat => (
                  <div key={cat.category} className="space-y-1">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                      {cat.category}
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {cat.items.map(({ vibe, label }) => {
                        const isSelected = emotion === vibe;
                        return (
                          <button
                            key={vibe}
                            onClick={() => setEmotion(vibe)}
                            title={vibe}
                            className={`px-2 py-1.5 rounded-lg border text-left transition-all flex items-center gap-1.5 select-none text-xs ${
                              isSelected
                                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400 font-bold'
                                : 'bg-black/30 border-white/5 text-gray-400 hover:border-white/20 hover:text-white'
                            }`}
                          >
                            <span className="flex-shrink-0">{EMOTION_ICONS[vibe]}</span>
                            <span className="truncate">{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Voice Artist Profile */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider">
                  Voice Artist Profile
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsCloneModalOpen(true)}
                    className="text-[10px] text-purple-400 hover:text-purple-300 font-bold uppercase tracking-wider flex items-center gap-1 px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/30 cursor-pointer"
                  >
                    <span>Clone Studio</span>
                    <span>↗</span>
                  </button>
                  <span className="text-[10px] text-emerald-400 font-mono transition-all">
                    {filteredVoices.length} {filteredVoices.length === 1 ? 'ARTIST' : 'ARTISTS'}
                  </span>
                </div>
              </div>

              {/* Quick Filter Pills (All, Male, Female, Kids, Custom & Styles) */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 mb-2.5 custom-scrollbar text-[10px]">
                {[
                  { id: 'ALL', label: 'All' },
                  { id: 'Male', label: 'Male' },
                  { id: 'Female', label: 'Female' },
                  { id: 'Kids & Animation', label: 'Kids & Animation' },
                  { id: 'Custom Voice', label: 'Custom Voice' },
                  { id: 'Radio & Commercial', label: 'Radio & Commercial' },
                  { id: 'Cinematic & Bass', label: 'Cinematic & Bass' },
                  { id: 'Luxury & Smooth', label: 'Luxury & Smooth' },
                  { id: 'Natural & Casual', label: 'Natural & Casual' },
                  { id: 'Corporate & News', label: 'Corporate & News' },
                  { id: 'Chorus & Multi-Voice', label: 'Chorus & Multi-Voice' },
                ].map(tab => {
                  const isActive = voiceFilter === tab.id;
                  const count = AVAILABLE_VOICES.filter(v => isVoiceMatchingFilter(v, tab.id)).length;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => handleSelectVoiceFilter(tab.id)}
                      className={`px-2.5 py-1 rounded-lg border whitespace-nowrap transition-all font-semibold flex items-center gap-1 cursor-pointer select-none ${
                        isActive
                          ? 'bg-emerald-500 text-black border-emerald-400 shadow-sm'
                          : 'bg-black/30 border-white/10 text-gray-400 hover:text-white hover:border-white/20'
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span className={`text-[9px] px-1 py-0.2 rounded font-mono ${isActive ? 'bg-black/20 text-black font-bold' : 'bg-white/5 text-gray-400'}`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Voice Cards Grid with Dynamic Resizing */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 transition-all duration-300 ease-in-out">
                {filteredVoices.map((v) => {
                  const isSelected = selectedVoice.id === v.id;
                  const isCustom = v.id === 'custom_cloned_voice';
                  return (
                    <button
                      key={v.id}
                      onClick={() => {
                        setSelectedVoice(v);
                        if (isCustom) setIsCloneModalOpen(true);
                      }}
                      title={v.persona}
                      className={`p-2.5 rounded-xl border text-left transition-all duration-200 select-none relative flex flex-col justify-between cursor-pointer ${
                        isSelected 
                          ? isCustom
                            ? 'bg-purple-500/20 border-purple-400 text-white shadow-lg ring-1 ring-purple-500/50 scale-[1.01]'
                            : 'bg-emerald-500/20 border-emerald-400 text-white shadow-lg ring-1 ring-emerald-500/50 scale-[1.01]' 
                          : 'bg-black/30 border-white/5 text-gray-400 hover:border-white/20 hover:text-white hover:bg-white/[0.03]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1.5 mb-1">
                        <span className={`text-xs font-bold truncate ${isCustom ? 'text-purple-300' : 'text-gray-100'}`}>
                          {v.name}
                        </span>
                        {v.tag && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold flex-shrink-0 ${
                            isSelected 
                              ? isCustom
                                ? 'bg-purple-400/20 text-purple-300 border border-purple-400/30'
                                : 'bg-emerald-400/20 text-emerald-300 border border-emerald-400/30' 
                              : 'bg-white/5 text-gray-400 border border-white/10'
                          }`}>
                            {v.tag}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between mt-1 text-[10px]">
                        <span className={`capitalize font-medium ${
                          isCustom
                            ? 'text-purple-400'
                            : v.category === 'Kids & Animation'
                              ? 'text-amber-400'
                              : v.gender === VoiceGender.MALE
                                ? 'text-sky-400/90'
                                : 'text-rose-400/90'
                        }`}>
                          {isCustom ? 'Custom Cloned Voice' : (v.category === 'Kids & Animation' ? 'Kid' : v.gender)}
                        </span>
                        <span className="text-gray-400 truncate max-w-[110px] text-right font-light">
                          {v.category}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Custom Voice Trigger Card */}
              {selectedVoice.id === 'custom_cloned_voice' && (
                <div className="mt-3 p-3 rounded-xl border border-purple-500/40 bg-purple-950/30 flex items-center justify-between gap-3 shadow-lg">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                      <span>Custom Cloned Voice Active</span>
                    </p>
                    <p className="text-[10px] text-purple-200/80 truncate font-mono mt-0.5">
                      {referenceVoiceFile ? `Sample: ${referenceVoiceFile.name}` : 'No target sample loaded yet'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsCloneModalOpen(true)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white flex-shrink-0 shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>{referenceVoiceFile ? 'Manage Sample' : 'Upload & Clone Voice'}</span>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>



      </div>

      {/* ── Right Column: Script Console & Action Trigger + Output ────────── */}
      <div className="lg:col-span-7 space-y-6">
        
        {/* Error Alert */}
        {error && (
          <div className="bg-red-950/40 border border-red-500/40 p-4 rounded-2xl flex items-start gap-3">
            <div className="flex-grow min-w-0">
              <div className="flex items-center justify-between mb-1">
                <p className="text-red-200 text-xs font-bold uppercase">
                  Engine Notice {error.code && `[${error.code}]`}
                </p>
                <button onClick={() => setError(null)} className="text-[10px] text-red-400 hover:text-white uppercase">
                  Dismiss
                </button>
              </div>
              <p className="text-gray-300 text-xs leading-relaxed">{error.message}</p>
            </div>
          </div>
        )}

        {/* Script Console Card */}
        <div className="liquid-glass p-1 flex flex-col min-h-[440px]">
          
          <div className="bg-black/40 rounded-t-[18px] px-5 py-3 border-b border-white/10 flex flex-wrap items-center justify-between gap-4">
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              Script Production Console
            </span>
            
            <div className="flex items-center gap-2.5 flex-wrap">
              <button
                onClick={() => handleLoadRememberedProfile(LOCKED_WEDDING_EXPO_PROFILE)}
                className="px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/50 text-amber-300 hover:text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm"
                title="Lock & Load the exact Wedding Expo radio ad voice & vibe (Anitha • Shouting / Peak Energy • Chennai Tamil)"
              >
                <span>★ Lock: Wedding Expo Ad</span>
              </button>

              {rememberedProfiles.length > 0 && (
                <select
                  onChange={(e) => {
                    const prof = rememberedProfiles.find(p => p.id === e.target.value);
                    if (prof) handleLoadRememberedProfile(prof);
                  }}
                  value=""
                  className="bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 hover:text-white rounded-lg px-2.5 py-1 text-xs font-semibold focus:outline-none cursor-pointer"
                  title="Replicate a previously downloaded production"
                >
                  <option value="" disabled>Replicate Download ({rememberedProfiles.length})</option>
                  {rememberedProfiles.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.id === LOCKED_WEDDING_EXPO_PROFILE.id ? '★ Wedding Expo (Radio Ad Master)' : `${p.script.slice(0, 28)}... (${p.dialect})`}
                    </option>
                  ))}
                </select>
              )}

              {isLoading && progress.total > 0 && (
                <span className="text-xs font-semibold text-emerald-400 animate-pulse">
                  Synthesizing Part {progress.current} of {progress.total}
                </span>
              )}

              <button
                onClick={handleResetEngine}
                disabled={isLoading}
                className="px-3 py-1 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white rounded-lg text-xs font-medium transition-all"
              >
                Clear Cache
              </button>

              <button
                onClick={handleOptimize}
                disabled={isLoading || isOptimizing}
                className={`px-3 py-1 border rounded-lg text-xs font-medium transition-all ${
                  isOptimizing 
                    ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400 animate-pulse' 
                    : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-300 hover:text-white'
                }`}
              >
                {isOptimizing ? 'Matching Vibe...' : 'Auto Vibe Match'}
              </button>

              {isAutoLocalizing && (
                <span className="text-xs text-emerald-400 font-semibold animate-pulse flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 shadow-sm">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  Auto-localizing script...
                </span>
              )}

              <span className={`text-xs font-medium ${script.length > MAX_STABLE_CHARS ? 'text-emerald-400' : 'text-gray-400'}`}>
                {script.length} / {MAX_STABLE_CHARS} CHARS
              </span>
            </div>
          </div>

          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            disabled={isLoading}
            placeholder="Type or paste your speech script here...
Tip: For dialogues, use 'FVO: ...' for female and 'MVO: ...' for male voice-over.
Tip: Use (Style) tags for per-sentence emotion delivery — e.g. (Shouting) Massive sale today! (Dramatic) Offer ends tonight."
            className="flex-grow bg-transparent text-white p-5 focus:outline-none text-sm resize-none leading-relaxed placeholder:text-gray-500 custom-scrollbar disabled:opacity-50 min-h-[280px]"
          />

          <div className="p-4 bg-black/40 border-t border-white/5">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-gray-400 flex-shrink-0">Sync Notes:</span>
              <input 
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes: e.g. 'Pronounce brand name slowly'"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 transition-all"
              />
            </div>
          </div>
        </div>

        {/* Multi-Speaker Dialogue Detected Deck */}
        {dialogueInfo.isDialogue && (
          <div className="liquid-glass p-4 border border-emerald-500/30 bg-emerald-950/20 rounded-2xl space-y-3.5 animate-fade-in">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/20 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <span>Multi-Speaker Dialogue Detected</span>
                  <span className="text-[10px] text-emerald-400 font-mono">({dialogueInfo.turnsCount} turns)</span>
                </h4>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono border border-emerald-500/40 font-semibold">
                  FVO & MVO Engine
                </span>
              </div>
            </div>

            <p className="text-[11px] text-gray-300 leading-relaxed">
              Dialogue format detected. FVO lines will speak with female timbre and MVO lines with male resonance:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* FVO Selector */}
              <div className="bg-black/50 border border-rose-500/30 hover:border-rose-500/50 p-3 rounded-xl space-y-1.5 transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-rose-300 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-rose-400" />
                    <span>FVO (Female Voice)</span>
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-950/60 text-rose-300 font-mono">Female</span>
                </div>
                <select
                  value={dialogueFemaleVoice}
                  onChange={(e) => setDialogueFemaleVoice(e.target.value)}
                  className="w-full bg-black/80 border border-white/10 text-white rounded-lg p-2 text-xs focus:border-rose-400 focus:outline-none cursor-pointer font-medium"
                >
                  <option value="Aoede">Priya — Energetic Commercial</option>
                  <option value="Achernar">Nandini — Gentle Empath</option>
                  <option value="Kore">Deepika — Authoritative</option>
                  <option value="Achird">Ananya — Kid Girl</option>
                </select>
              </div>

              {/* MVO Selector */}
              <div className="bg-black/50 border border-sky-500/30 hover:border-sky-500/50 p-3 rounded-xl space-y-1.5 transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-sky-300 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-sky-400" />
                    <span>MVO (Male Voice)</span>
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-950/60 text-sky-300 font-mono">Male</span>
                </div>
                <select
                  value={dialogueMaleVoice}
                  onChange={(e) => setDialogueMaleVoice(e.target.value)}
                  className="w-full bg-black/80 border border-white/10 text-white rounded-lg p-2 text-xs focus:border-sky-400 focus:outline-none cursor-pointer font-medium"
                >
                  <option value="Fenrir">Arjun — Electric RJ / High-Energy</option>
                  <option value="Puck">Vikram — Modern Urban / Dynamic</option>
                  <option value="Charon">Rajan / Kabir — Deep Cinematic</option>
                  <option value="Orus">Anand — Velvet Thunder Baritone</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Single-Word Strong Action Button */}
        <button
          onClick={handleGenerate}
          disabled={isLoading}
          className={`w-full py-4 rounded-xl font-bold text-base uppercase tracking-widest transition-all ${
            isLoading ? 'bg-white/5 text-gray-500 cursor-wait' : 'liquid-btn-primary'
          }`}
        >
          {isLoading
            ? `SYNTHESIZING... (${progress.current}/${progress.total})`
            : dialogueInfo.isDialogue
            ? 'SYNTHESIZE DIALOGUE (FVO + MVO)'
            : 'SYNTHESIZE'}
        </button>

        {/* Audio Player & Zero-Shot Voice Clone Pipeline */}
        {audioUrl && (
          <div className="space-y-4 animate-fade-in">
            {/* Main Audio Output Card */}
            <div className="liquid-glass-accent p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between border-b border-white/10 pb-3 gap-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveOutputTab('original')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                      activeOutputTab === 'original'
                        ? 'bg-emerald-500 text-black shadow-md'
                        : 'bg-white/5 text-gray-400 hover:text-white'
                    }`}
                  >
                    Master (Generated)
                  </button>
                  {clonedAudioUrl && (
                    <button
                      onClick={() => setActiveOutputTab('cloned')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                        activeOutputTab === 'cloned'
                          ? 'bg-purple-500 text-white shadow-md'
                          : 'bg-purple-950/40 text-purple-300 hover:text-white border border-purple-500/30'
                      }`}
                    >
                      <span>★ Cloned Voice</span>
                    </button>
                  )}
                </div>

                <AudioVisualizerMeter isPlaying={activeOutputTab === 'original' ? isPlayingAudio : isPlayingCloned} />
              </div>
              
              {/* Audio Player */}
              {activeOutputTab === 'original' ? (
                <audio 
                  ref={audioRef}
                  controls 
                  src={audioUrl} 
                  onPlay={() => setIsPlayingAudio(true)}
                  onPause={() => setIsPlayingAudio(false)}
                  onEnded={() => setIsPlayingAudio(false)}
                  className="w-full custom-audio-player" 
                />
              ) : (
                <audio 
                  ref={clonedAudioRef}
                  controls 
                  src={clonedAudioUrl || ''} 
                  onPlay={() => setIsPlayingCloned(true)}
                  onPause={() => setIsPlayingCloned(false)}
                  onEnded={() => setIsPlayingCloned(false)}
                  className="w-full custom-audio-player" 
                />
              )}
              
              {/* Dual Download Options */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <a 
                  href={audioUrl} 
                  download={getBrandFilename(script, 'master_audio', 'wav')} 
                  onClick={() => {
                    saveDownloadedTtsProfile({
                      script,
                      notes,
                      voiceId: selectedVoice.id,
                      emotion,
                      dialect,
                      pacing,
                    });
                    setRememberedProfiles(getRememberedTtsProfiles());
                    setToastMessage("Master generated audio downloaded & profile saved.");
                    setTimeout(() => setToastMessage(null), 3500);
                  }}
                  className="liquid-btn-primary text-center font-bold py-3 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  <span>Download Master WAV</span>
                </a>

                {/* Word Precision Audio Editor Button (Inpainting) */}
                <button
                  type="button"
                  onClick={() => setIsWordEditorOpen(true)}
                  className="bg-indigo-600/30 hover:bg-indigo-600/40 text-indigo-300 hover:text-white border border-indigo-400/40 font-bold py-3 px-4 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg"
                  title="Select individual words or audio segments in pop-up window to inpaint and replace alone"
                >
                  <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                  </svg>
                  <span>Edit Words Alone (Popup Editor)</span>
                </button>

                {clonedAudioUrl ? (
                  <a 
                    href={clonedAudioUrl} 
                    download={getBrandFilename(script, 'cloned_voice', 'wav')} 
                    onClick={() => {
                      saveDownloadedTtsProfile({
                        script,
                        notes: referenceVoiceFile ? `${notes} [Cloned Voice: ${referenceVoiceFile.name}]`.trim() : notes,
                        voiceId: `cloned_${referenceVoiceFile?.name || 'custom'}`,
                        emotion,
                        dialect,
                        pacing,
                      });
                      setRememberedProfiles(getRememberedTtsProfiles());
                      setToastMessage("Cloned custom voice audio downloaded & profile saved.");
                      setTimeout(() => setToastMessage(null), 3500);
                    }}
                    className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-center font-bold py-3 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg transition-all"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.125 3.375c2.25 0 3.375 1.125 3.375 3.375v10.5c0 2.25-1.125 3.375-3.375 3.375H4.875C2.625 20.625 1.5 19.5 1.5 17.25V6.75c0-2.25 1.125-3.375 3.375-3.375h14.25zM12 7.5v9m-3.75-6v3m7.5-3v3m-11.25-1.5v0m15 0v0" />
                    </svg>
                    <span>Download Cloned WAV</span>
                  </a>
                ) : (
                  <button 
                    onClick={() => {
                      if (audioUrl) URL.revokeObjectURL(audioUrl);
                      if (clonedAudioUrl) URL.revokeObjectURL(clonedAudioUrl);
                      setAudioUrl(null);
                      setClonedAudioUrl(null);
                      setReferenceVoiceFile(null);
                      setScript('');
                      setIsPlayingAudio(false);
                      setIsPlayingCloned(false);
                    }} 
                    className="liquid-btn-secondary py-3 rounded-xl text-xs font-bold uppercase tracking-wider"
                  >
                    Reset Console
                  </button>
                )}
              </div>
            </div>

            {/* ── Direct Voice-to-Voice & Text-to-Voice Cloning Studio Launcher Banner ── */}
            <div className="liquid-glass p-4 border border-purple-500/30 bg-purple-950/20 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-400 flex-shrink-0">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.083-1.638.24-2.416.234-.847 1.058-1.354 1.938-1.354h2.24z" />
                  </svg>
                </div>
                <div>
                  <h4 className="text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2">
                    <span>Direct Voice-to-Voice & Voice Conversion Studio</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/30 text-purple-300 font-mono font-bold">Voice Conversion</span>
                  </h4>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {referenceVoiceFile ? `Active Sample: ${referenceVoiceFile.name}` : 'Transform spoken voice into target voice sample or convert script text'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 flex-shrink-0">
                {clonedAudioUrl && (
                  <span className="text-[10px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">
                    ✓ Converted Ready
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setIsCloneModalOpen(true)}
                  className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg transition-all flex items-center gap-2 cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                  <span>Open Voice Conversion Window</span>
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
      
      {/* ── Voice Cloning Modal ── */}
      <VoiceCloningModal
        isOpen={isCloneModalOpen}
        onClose={() => setIsCloneModalOpen(false)}
        referenceVoiceFile={referenceVoiceFile}
        setReferenceVoiceFile={setReferenceVoiceFile}
        slicedReferenceVoiceFile={slicedReferenceVoiceFile}
        setSlicedReferenceVoiceFile={setSlicedReferenceVoiceFile}
        sourceVoiceFile={sourceVoiceFile}
        setSourceVoiceFile={setSourceVoiceFile}
        clonedAudioUrl={clonedAudioUrl}
        setClonedAudioUrl={setClonedAudioUrl}
        isCloning={isCloning}
        isConvertingVc={isConvertingVc}
        cloneProgress={cloneProgress}
        cloneError={cloneError}
        handleVoiceToVoice={handleVoiceToVoice}
        handleCloneVoice={handleCloneVoice}
        script={script}
        audioUrl={audioUrl}
      />

      {/* ── Word-Level Voice Precision Inpainting Editor Modal ── */}
      <WordPrecisionEditorModal
        isOpen={isWordEditorOpen}
        onClose={() => setIsWordEditorOpen(false)}
        script={script}
        audioUrl={audioUrl}
        voice={selectedVoice}
        emotion={emotion}
        dialect={dialect}
        pacing={pacing}
        onApplyMasterEdit={(newBlob, newScript) => {
          if (audioUrl) URL.revokeObjectURL(audioUrl);
          const newUrl = URL.createObjectURL(newBlob);
          setAudioUrl(newUrl);
          setScript(newScript);
          setToastMessage('Word replacement applied to master track.');
          setTimeout(() => setToastMessage(null), 3500);
        }}
      />
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 liquid-glass text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 font-semibold text-xs border border-white/10">
          <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          {toastMessage}
        </div>
      )}
    </div>
  );
};

export default TtsPanel;
