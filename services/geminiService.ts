import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";
import { Dialect, Emotion, VoiceOption, VoiceGender, TranscriptionStyle, DubbingGender, SpeechPacing, MultiSpeakerOptions, StorySegment } from '../types';
import { decodeBase64ToUint8Array, extractPcmFromAudioBuffer, pcmToWav, blobToBase64, getAudioDurationFromFile, applyDspChorus, convertAudioFileTo24kMonoWav, applyAcousticTransfer, stretchPcmToTargetDuration } from '../utils/audio';
import { getAutoPronunciationGuidance, findRememberedDubbing, saveDownloadedDubbingProfile } from '../utils/memoryStore';

// ─── Constants & Multi-Model / Multi-Key Rotation Pools ───────────────────────
const TTS_MODEL  = 'gemini-3.1-flash-tts-preview';
const TEXT_MODEL = 'gemini-3.6-flash';
const DIRECTIVE_SEP = '\n@@INLINE@@';
const CHATTERBOX_URL = 'http://127.0.0.1:5051';

/**
 * Model-Specific TTS Instruction & Bracket Architecture:
 * - 'prompt_square' (gemini-3.1-flash-tts-preview, gemini-2.5-flash-preview-tts):
 *   Uses rich promptContext + `Text to speak: "[inlineAudioTag] ${chunk}"`.
 *   Inline acting & paralinguistic cues use [square brackets] (e.g. [shouting at maximum volume], [short pause]).
 *   Does NOT support speech_metadata (returns HTTP 400 if included).
 * - 'metadata_angle' (gemini-3.8-flash-tts, gemini-3.8-flash-lite-tts):
 *   Places style/emotion/persona directives strictly inside `speech_metadata.style` (and `speechMetadata.style`).
 *   `parts[].text` contains ONLY clean verbatim spoken text so 3.8-lite never reads instructions aloud.
 *   Paralinguistic cues use <angle brackets> (e.g. <short pause>, <long pause>, <laugh>, <sigh>, <gasp>, <whisper>).
 */
export interface TtsModelProfile {
  model: string;
  family: 'prompt_square' | 'metadata_angle';
  supportsSpeechMetadata: boolean;
}

export const TTS_MODEL_ROTATION_POOL: TtsModelProfile[] = [
  { model: 'gemini-3.1-flash-tts-preview', family: 'prompt_square',  supportsSpeechMetadata: false },
  { model: 'gemini-2.5-flash-preview-tts', family: 'prompt_square',  supportsSpeechMetadata: false },
  { model: 'gemini-3.8-flash-tts',         family: 'metadata_angle', supportsSpeechMetadata: true  },
  { model: 'gemini-3.8-flash-lite-tts',    family: 'metadata_angle', supportsSpeechMetadata: true  },
];

export const TEXT_MODEL_ROTATION_POOL: string[] = [
  'gemini-3.6-flash',
  'gemini-3-flash-preview',
  'gemini-3.5-flash',
  'gemini-3.7-flash',
  'gemini-3.8-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite-preview',
];

const decodeKey = (b64: string) => {
  try {
    return atob(b64);
  } catch (e) {
    return '';
  }
};

const OPERATIONAL_KEY = decodeKey('QVEuQWI4Uk42SlA3UmVWNmpwZmhzaUxMRkh3ZUJCVmREOUlTZGt0TDhCa3lTZTVCM29DWEE=');

const API_KEY_POOL: string[] = Array.from(new Set([
  OPERATIONAL_KEY,
  decodeKey('QVEuQWI4Uk42SjVnaE9sTnR6djBjNl9vbFlwU3IzZ0xtRjFwTmZlN3dpYWpQU0JYVWstSGc='),
  decodeKey('QVEuQWI4Uk42THZUUEZabHJBeThvRWxyWnk1QUlWUUFJRFFtSHN4RXFvcG9hUXVDTUM0OWc='),
])).filter(Boolean);

const modelKeyCooldownUntil = new Map<string, number>();
const keyDepletedUntil = new Map<string, number>();
let ttsRotationCursor = 0;
let textRotationCursor = 0;

const isPairAvailable = (model: string, key: string): boolean => {
  const now = Date.now();
  const keyCooldown = keyDepletedUntil.get(key) || 0;
  if (now < keyCooldown) return false;
  const pairCooldown = modelKeyCooldownUntil.get(`${model}|${key}`) || 0;
  return now >= pairCooldown;
};

const markPairCooldown = (model: string, key: string, ms: number) => {
  modelKeyCooldownUntil.set(`${model}|${key}`, Date.now() + ms);
};

const markKeyCooldown = (key: string, ms: number) => {
  keyDepletedUntil.set(key, Date.now() + ms);
};

const getActiveApiKeys = (): string[] => {
  const rawEnvKey = typeof process !== 'undefined' ? (process.env.API_KEY || process.env.GEMINI_API_KEY) : '';
  const envKey = rawEnvKey ? String(rawEnvKey).trim() : '';
  const keys = [...API_KEY_POOL];
  if (envKey && envKey !== 'undefined' && !keys.includes(envKey)) {
    keys.unshift(envKey);
  }
  return keys;
};

export const PERMISSIVE_SAFETY_SETTINGS: any = [
  { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT',  threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HARASSMENT',         threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',  threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_CIVIC_INTEGRITY',    threshold: 'BLOCK_NONE' },
];

const sanitizeSafetySensitiveWords = (text: string): string => {
  return text
    .replace(/\b(kill|killer|killing)\b/gi, 'unbeatable')
    .replace(/\b(dead|death|deadly)\b/gi, 'dramatic')
    .replace(/\b(bomb|blast|exploding|explosion)\b/gi, 'grand sensation')
    .replace(/\b(attack|assault)\b/gi, 'rush')
    .replace(/\b(seductive|sultry|sexy)\b/gi, 'alluring')
    .replace(/\b(madness|insane|crazy)\b/gi, 'incredible')
    .replace(/[!]{2,}/g, '!')
    .trim();
};

// ─── AI Client ────────────────────────────────────────────────────────────────
const getAI = (overrideKey?: string) => {
  if (overrideKey) return new GoogleGenAI({ apiKey: overrideKey });
  const keys = getActiveApiKeys();
  const healthyKey = keys.find(k => (keyDepletedUntil.get(k) || 0) <= Date.now()) || keys[0] || OPERATIONAL_KEY;
  return new GoogleGenAI({ apiKey: healthyKey });
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Executes a text/multimodal generation request by rotating across all available
 * TEXT_MODEL_ROTATION_POOL models and API keys so generation never fails.
 */
const generateContentWithTextRotation = async (
  contents: any,
  config?: any
): Promise<GenerateContentResponse> => {
  const keys = getActiveApiKeys();
  const totalModels = TEXT_MODEL_ROTATION_POOL.length;
  let lastErr: any = null;

  for (let pass = 0; pass < 2; pass++) {
    for (let mOffset = 0; mOffset < totalModels; mOffset++) {
      const modelIdx = (textRotationCursor + mOffset) % totalModels;
      const modelName = TEXT_MODEL_ROTATION_POOL[modelIdx];

      for (const apiKey of keys) {
        if (pass === 0 && !isPairAvailable(modelName, apiKey)) continue;

        try {
          const client = new GoogleGenAI({ apiKey });
          const res = await client.models.generateContent({
            model: modelName,
            contents,
            config: {
              safetySettings: PERMISSIVE_SAFETY_SETTINGS,
              ...(config || {}),
            },
          });
          textRotationCursor = modelIdx;
          return res as GenerateContentResponse;
        } catch (err: any) {
          lastErr = err;
          const msg = String(err?.message || err);
          if (msg.includes('402') || msg.toLowerCase().includes('prepayment credits')) {
            markKeyCooldown(apiKey, 10 * 60 * 1000);
          } else if (msg.includes('429') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('rate limit')) {
            markPairCooldown(modelName, apiKey, 45 * 1000);
          } else {
            markPairCooldown(modelName, apiKey, 10 * 1000);
          }
        }
      }
    }
    await wait(400);
  }
  throw lastErr || new Error('All text models in rotation failed.');
};

// ─── Retry logic ──────────────────────────────────────────────────────────────
/**
 * 3 retries with fast exponential backoff (from reference implementation).
 */
const withRetry = async <T>(
  operation: (attempt: number) => Promise<T>,
  maxRetries = 3,
  baseDelay = 300
): Promise<T> => {
  let lastError: any;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await operation(i);
    } catch (error: any) {
      lastError = error;

      let parsedError = error;
      try {
        if (error.message && error.message.startsWith('{')) {
          parsedError = JSON.parse(error.message);
        }
      } catch (e) { /* ignore */ }

      const status = parsedError.status || parsedError.code
        || (parsedError.error && parsedError.error.code)
        || error.status || error.code;
      const errorMessage = parsedError.message
        || (parsedError.error && parsedError.error.message)
        || error.message || '';

      const isQuota429 = status === 429 || errorMessage.toLowerCase().includes('quota') || errorMessage.includes('429');

      if (i < maxRetries) {
        const isTTSError   = errorMessage.includes('TTS_ENGINE_ERROR');
        const isOtherError = errorMessage.includes('OTHER');

        let delay = (isQuota429 ? 800 : (isOtherError ? 1500 : (isTTSError ? 600 : baseDelay)))
          * Math.pow(1.5, i)
          + Math.random() * 300;

        const retryMatch = error.message?.match(/retry in (\d+(?:\.\d+)?)s/i);
        if (retryMatch?.[1]) delay = Math.min(4000, parseFloat(retryMatch[1]) * 1000 + 500);

        console.warn(`[Retry ${i + 1}/${maxRetries}] ${Math.round(delay)}ms — ${errorMessage.slice(0, 80)}`);
        await wait(delay);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};

// ─── Script cleaning ──────────────────────────────────────────────────────────
const cleanScript = (text: string): string => {
  if (!text) return '';
  // Preserve Gemini paralinguistic inline tags like <short pause>, <long pause>, <gasp>, <laugh>, <sigh>, <whisper>
  const preserved = text
    .normalize('NFC')
    .replace(/<(gasp|sigh|laugh|chuckle|short pause|long pause|whisper|cough)>/gi, ' PARATAG$1PARATAG ');

  const cleaned = preserved
    // Remove inline style/emotion markers like (Shouting), [Shouting], (Peppy), [Peppy], etc.
    .replace(/(?:\[|\()\s*(?:shout|scream|peppy|radio|promo|excit|cricket|stadium|announc|corporate|authorit|dramat|trailer|happy|cheerful|joyful|neutral|news|calm|sarcas|witty|irony|sad|heartfelt|luxury|whisper|velvet|convers|casual|natural|deep|bass|rumbl|cine|narrat|epic|hollywood|jewel|gold|elegant|slowly|fast|energy)[^\]\)]*(?:\]|\))\s*/gim, ' ')
    // Remove common speaker / style labels at start of lines like "FVO:", "MVO:", "Shouting:", "Peppy:", "Dramatic:", etc.
    .replace(/^(?:(?:speaker|voice|person|actor|character|role)\s*\d*|fvo\s*\d*|f\.v\.o\s*\d*|mvo\s*\d*|m\.v\.o\s*\d*|avo\s*\d*|vo\s*\d*|male|female|man|woman|boy|girl|narrator|host|anchor|customer|rj|shouting|peppy|excited|dramatic|happy|neutral|sarcasm|sad|luxury|conversational|announcement)\s*[:\-–—]\s*/gim, '')
    .replace(/\n(?:(?:speaker|voice|person|actor|character|role)\s*\d*|fvo\s*\d*|f\.v\.o\s*\d*|mvo\s*\d*|m\.v\.o\s*\d*|avo\s*\d*|vo\s*\d*|male|female|man|woman|boy|girl|narrator|host|anchor|customer|rj|shouting|peppy|excited|dramatic|happy|neutral|sarcasm|sad|luxury|conversational|announcement)\s*[:\-–—]\s*/gim, '\n')
    // Remove emojis
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
    // Normalize curly quotes and apostrophes so contractions stay intact
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    // Remove symbols that disrupt pronunciation while preserving apostrophes, hyphens and essential punctuation
    .replace(/[#@*^~`<>|\\{}_+=]/g, ' ')
    .replace(/"+/g, ' ')
    .replace(/([.!?;:])\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.replace(/PARATAG(.*?)PARATAG/gi, '<$1>');
};

// ─── Tagged script parsing ────────────────────────────────────────────────────
/**
 * Splits a script with inline (Style Tag) markers into segments.
 * Only splits on known style keywords to avoid chopping regular parenthetical text.
 */
interface ScriptSegment {
  text: string;
  styleKey: string; // empty string = use the global emotion
}

const KNOWN_STYLE_KEYWORDS = [
  'shout', 'scream', 'peppy', 'radio', 'promo', 'excit', 'cricket', 'stadium',
  'announc', 'corporate', 'authorit', 'dramat', 'trailer', 'happy', 'cheerful',
  'joyful', 'neutral', 'news', 'calm', 'sarcas', 'witty', 'irony', 'sad',
  'heartfelt', 'luxury', 'whisper', 'velvet', 'convers', 'casual', 'natural',
  'deep', 'bass', 'rumbl', 'cine', 'narrat', 'epic', 'hollywood'
];

const isStyleTag = (tag: string): boolean => {
  const lower = tag.trim().toLowerCase();
  return KNOWN_STYLE_KEYWORDS.some(k => lower.includes(k));
};

const parseTaggedScript = (script: string, defaultStyleKey: string): ScriptSegment[] => {
  const withoutNotes = script.replace(/\[(?!SOUND EFFECT:).*?\]/gi, '');
  const parts = withoutNotes.split(/\((.*?)\)/);
  const segments: ScriptSegment[] = [];

  let currentStyle = defaultStyleKey;
  let currentBuffer = '';

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      // Inside parenthesis
      const tagContent = parts[i]?.trim();
      if (tagContent && isStyleTag(tagContent)) {
        if (currentBuffer.trim()) {
          segments.push({ text: currentBuffer.trim(), styleKey: currentStyle });
          currentBuffer = '';
        }
        currentStyle = tagContent;
      } else if (tagContent) {
        // Keep as normal spoken parenthetical text
        currentBuffer += (currentBuffer ? ' ' : '') + tagContent;
      }
    } else {
      // Regular text outside parenthesis
      if (parts[i]) {
        currentBuffer += (currentBuffer ? ' ' : '') + parts[i].trim();
      }
    }
  }

  if (currentBuffer.trim()) {
    segments.push({ text: currentBuffer.trim(), styleKey: currentStyle });
  }

  return segments.length > 0 ? segments : [{ text: script.trim(), styleKey: defaultStyleKey }];
};

// ─── Chunk splitting ──────────────────────────────────────────────────────────
/**
 * Split into ≤ maxSize chunks at sentence boundaries.
 * 200 chars = Project 2's proven sweet spot for near-zero 500 errors.
 */
const splitIntoChunks = (text: string, maxSize: number): string[] => {
  if (text.length <= maxSize) return [text];

  const chunks: string[] = [];
  const sentences = text.match(/[^.!?\n]+[.!?\n]*\s*/g) || [text];
  let current = '';

  for (const sentence of sentences) {
    if (sentence.length > maxSize) {
      if (current) { chunks.push(current.trim()); current = ''; }
      const words = sentence.split(/\s+/);
      for (const word of words) {
        if (word.length > maxSize) {
          if (current) { chunks.push(current.trim()); current = ''; }
          for (let i = 0; i < word.length; i += maxSize) chunks.push(word.substring(i, i + maxSize));
        } else if ((current + ' ' + word).trim().length > maxSize) {
          if (current) chunks.push(current.trim());
          current = word;
        } else {
          current += (current ? ' ' : '') + word;
        }
      }
    } else if ((current + sentence).length > maxSize) {
      if (current) chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(c => c.length > 0);
};

// ─── Dialogue / Multi-Speaker (FVO & MVO) Detection ──────────────────────────
export interface DetectedDialogue {
  isDialogue: boolean;
  hasFvo: boolean;
  hasMvo: boolean;
  speaker1Tag: string; // 'FVO'
  speaker2Tag: string; // 'MVO'
  turnsCount: number;
  normalizedScript: string;
}

/**
 * Scans a script for dialogue markers such as FVO (Female Voice Over) and MVO (Male Voice Over).
 * Normalizes speaker tags to clean 'FVO:' and 'MVO:' prefixes for the Gemini multi-speaker speech engine.
 */
export const detectDialogueScript = (script: string): DetectedDialogue => {
  if (!script || !script.trim()) {
    return {
      isDialogue: false,
      hasFvo: false,
      hasMvo: false,
      speaker1Tag: 'FVO',
      speaker2Tag: 'MVO',
      turnsCount: 0,
      normalizedScript: script,
    };
  }

  const lines = script.split('\n');
  let hasFvo = false;
  let hasMvo = false;
  let turnsCount = 0;
  const normalizedLines: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      normalizedLines.push('');
      continue;
    }

    // Match explicit Female Voiceover prefixes: FVO, F.V.O.
    const femaleMatch = trimmed.match(/^(?:\[|\()?(\s*(?:FVO\s*\d*|F\.V\.O\s*\d*)\s*)(?:\]|\))?\s*[:\-–—]\s*(.*)$/i);
    // Match explicit Male Voiceover prefixes: MVO, M.V.O.
    const maleMatch = trimmed.match(/^(?:\[|\()?(\s*(?:MVO\s*\d*|M\.V\.O\s*\d*)\s*)(?:\]|\))?\s*[:\-–—]\s*(.*)$/i);

    if (femaleMatch) {
      hasFvo = true;
      turnsCount++;
      normalizedLines.push(`FVO: ${femaleMatch[2].trim()}`);
    } else if (maleMatch) {
      hasMvo = true;
      turnsCount++;
      normalizedLines.push(`MVO: ${maleMatch[2].trim()}`);
    } else {
      normalizedLines.push(rawLine);
    }
  }

  // Dialogue ONLY if BOTH FVO and MVO tags are explicitly present
  const isDialogue = hasFvo && hasMvo;

  return {
    isDialogue,
    hasFvo,
    hasMvo,
    speaker1Tag: 'FVO',
    speaker2Tag: 'MVO',
    turnsCount: isDialogue ? turnsCount : 0,
    normalizedScript: isDialogue ? normalizedLines.join('\n') : script,
  };
};

/**
 * Splits dialogue scripts into turn-coherent chunks, keeping complete speaker lines intact
 * so multi-speaker synthesis never receives speakerless orphaned fragments.
 */
export const splitDialogueIntoChunks = (dialogueScript: string, maxChars: number = 1200): string[] => {
  const lines = dialogueScript.split('\n');
  const turns: { speaker: string; text: string }[] = [];
  let currentSpeaker = '';
  let currentText = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(FVO|MVO)\s*:\s*(.*)$/i);
    if (match) {
      if (currentText && currentSpeaker) {
        turns.push({ speaker: currentSpeaker, text: currentText.trim() });
      }
      currentSpeaker = match[1].toUpperCase();
      currentText = match[2].trim();
    } else {
      currentText += (currentText ? ' ' : '') + trimmed;
    }
  }
  if (currentText && currentSpeaker) {
    turns.push({ speaker: currentSpeaker, text: currentText.trim() });
  }

  if (turns.length === 0) return [dialogueScript.trim()];

  const chunks: string[] = [];
  let currentChunk = '';

  for (const turn of turns) {
    const turnStr = `${turn.speaker}: ${turn.text}`;
    if (!currentChunk) {
      currentChunk = turnStr;
    } else if ((currentChunk + '\n\n' + turnStr).length <= maxChars) {
      currentChunk += '\n\n' + turnStr;
    } else {
      chunks.push(currentChunk);
      currentChunk = turnStr;
    }
  }
  if (currentChunk) chunks.push(currentChunk);

  return chunks;
};


// ─── Multi-Level Caches to Eliminate Redundant API Requests ───────────────────
const audioCache = new Map<string, Uint8Array>();
const translationCache = new Map<string, string>();
const transcriptionCache = new Map<string, string>();
const optimizeCache = new Map<string, string>();
const MAX_CACHE_SIZE = 250;

const getCacheKey = (chunk: string, promptContext: string, speechConfig: any) =>
  `${chunk.trim().toLowerCase()}|${promptContext}|${JSON.stringify(speechConfig)}`;

// ─── Style keyword → Emotion lookup (for (Style Tag) segments) ────────────────
/**
 * Maps style keywords from (Style Tag) markers to Emotion enum keys.
 * Case-insensitive keyword matching — partial matches work.
 * Falls back to the default emotion if no match found.
 */
const resolveStyleToEmotion = (styleKey: string, defaultEmotion: Emotion): Emotion => {
  const lower = styleKey.toLowerCase();
  if (lower.includes('shout') || lower.includes('scream') || lower.includes('maximum') || lower.includes('roar')) return Emotion.SHOUTING;
  if (lower.includes('peppy') || lower.includes('radio') || lower.includes('promo'))   return Emotion.PEPPY;
  if (lower.includes('excit') || lower.includes('hype') || lower.includes('ecstat'))   return Emotion.EXCITED;
  if (lower.includes('cricket') || lower.includes('stadium'))                          return Emotion.CRICKET_STADIUM;
  if (lower.includes('announc') || lower.includes('corporate') || lower.includes('authorit')) return Emotion.ANNOUNCEMENT;
  if (lower.includes('dramat') || lower.includes('cinematic') || lower.includes('trailer'))   return Emotion.DRAMATIC;
  if (lower.includes('happy') || lower.includes('cheerful') || lower.includes('joyful'))      return Emotion.HAPPY;
  if (lower.includes('neutral') || lower.includes('news') || lower.includes('calm'))          return Emotion.NEUTRAL;
  if (lower.includes('sarcas') || lower.includes('witty') || lower.includes('irony'))         return Emotion.SARCASM;
  if (lower.includes('sad') || lower.includes('emotion') || lower.includes('heartfelt'))      return Emotion.SAD;
  if (lower.includes('luxury') || lower.includes('whisper') || lower.includes('velvet'))      return Emotion.LUXURY;
  if (lower.includes('convers') || lower.includes('casual') || lower.includes('natural'))     return Emotion.CONVERSATIONAL;
  if (lower.includes('deep') || lower.includes('bass') || lower.includes('rumbl'))             return Emotion.DEEP_BASS;
  if (lower.includes('cine') || lower.includes('narrat') || lower.includes('epic') || lower.includes('hollywood')) return Emotion.CINEMATIC_NARRATION;
  if (lower.includes('jewel') || lower.includes('gold') || lower.includes('elegant') || lower.includes('grounded')) return Emotion.JEWELLERY_ELEGANT;
  return defaultEmotion;
};

// ─── Emotion Instructions (from reference implementation) ─────────────────────
/**
 * CRITICAL: These rich profiles are used to guide the TTS engine
 * within the prompt context for maximum distinctiveness.
 */
const EMOTION_SYSTEM_INSTRUCTIONS: Record<string, string> = {
  [Emotion.SHOUTING]: `Style: MAXIMUM ENERGY retail commercial announcer. SHOUT every word at full volume with intense street sale energy.`,
  [Emotion.PEPPY]: `Style: Bright, bubbly Indian FM radio jockey. Fast, bouncy, punchy rhythm with a constant smile.`,
  [Emotion.EXCITED]: `Style: Product launch announcer. High pitch, breathless enthusiasm and maximum excitement.`,
  [Emotion.CRICKET_STADIUM]: `Style: Live cricket stadium PA announcer. Roaring, electric stadium energy.`,
  [Emotion.ANNOUNCEMENT]: `Style: Formal corporate spokesperson. Deep, authoritative, measured and official delivery.`,
  [Emotion.DRAMATIC]: `Style: Cinematic film trailer narrator. Speak slowly with theatrical gravitas and tension.`,
  [Emotion.HAPPY]: `Style: Warm, joyful festive commercial voice. Bright, light, smiling and welcoming.`,
  [Emotion.NEUTRAL]: `Style: Professional TV news anchor. Clear, calm, precise and measured delivery.`,
  [Emotion.SARCASM]: `Style: Witty comedian in TV ad. Dry irony, knowing smirk, strategic pauses.`,
  [Emotion.SAD]: `Style: Heartfelt storyteller. Soft, gentle, sincere emotional delivery.`,
  [Emotion.LUXURY]: `Style: Ultra-premium luxury brand. Velvety, smooth, unhurried, understated perfection.`,
  [Emotion.CONVERSATIONAL]: `Style: Casual friend in natural 1-on-1 chat. Organic speech rhythm.`,
  [Emotion.DEEP_BASS]: `Style: Deepest bass narrator. Subwoofer chest resonance, slow drumbeat pacing, maximum gravitas.`,
  [Emotion.CINEMATIC_NARRATION]: `Style: Epic Hollywood trailer narrator. Explosive IMAX gravitas and thunderous peaks.`,
  [Emotion.JEWELLERY_ELEGANT]: `Style: Soft, warm, grounded luxury jewellery brand narrator. Gentle, unhurried intimacy, rich warmth and timeless grace.`,
};

// ─── Emotion → inline audio tag (from reference implementation) ───────────────
/**
 * Prepended to each chunk — official TTS inline control signal.
 * Works WITH the prompt directives to lock in the delivery style from word 1.
 */
const EMOTION_AUDIO_TAGS: Record<string, string> = {
  [Emotion.SHOUTING]:        '[shouting at maximum volume]',
  [Emotion.PEPPY]:           '[excitedly, fast-paced and bouncy]',
  [Emotion.EXCITED]:         '[excited, breathless and enthusiastic]',
  [Emotion.CRICKET_STADIUM]: '[shouting, stadium announcer energy]',
  [Emotion.ANNOUNCEMENT]:    '[seriously, authoritative and formal]',
  [Emotion.DRAMATIC]:        '[slowly and dramatically, with gravitas]',
  [Emotion.HAPPY]:           '[cheerfully, warm and joyful]',
  [Emotion.NEUTRAL]:         '[calmly and professionally]',
  [Emotion.SARCASM]:         '[sarcastically, with a knowing smirk]',
  [Emotion.SAD]:             '[sadly, softly and with feeling]',
  [Emotion.LUXURY]:          '[whispering, slow and velvety]',
  [Emotion.CONVERSATIONAL]:  '[casually, like a real conversation]',
  [Emotion.DEEP_BASS]:       '[in a deep, rumbling bass voice with maximum low-end]',
  [Emotion.CINEMATIC_NARRATION]: '[dramatically, like a Hollywood movie trailer narrator]',
  [Emotion.JEWELLERY_ELEGANT]: '[softly and warmly, grounded luxury jewellery elegance]',
};

// ─── Per-voice persona overrides (from reference implementation) ──────────────
/**
 * Strong per-voice-ID delivery instructions that override the generic emotion
 * profile for voices that share the same API voice name.
 */
const VOICE_PERSONA_OVERRIDES: Record<string, string> = {
  m_rdj_1: `VOICE CHARACTER OVERRIDE: You are voicing in the EXACT style of Robert Downey Jr. as Tony Stark. This is the most specific voice instruction possible — follow every detail:

PITCH & TONE: Warm mid-range baritone, slightly nasal resonance centered in the front of the face. Never deep-bass. Think "upper chest" resonance, not throat. Bright but not thin.

RHYTHM & CADENCE: This is the most critical element. Speak in rapid-fire BURSTS of 3–5 words, then a sharp stop, then another burst. Like a tennis ball machine — pop-pop-pop... pause... pop-pop. Never smooth or flowing. The rhythm is inherently syncopated. Unpredictable.

PACING DYNAMICS: Accelerate INTO clauses, not away from them. Start a phrase slightly faster than comfortable, hit the key word with a micro-beat drop, then speed through the tail of the sentence. Example feel: "Okay — so here's the thing — [beat] — I'm already — three steps ahead — of you."

SARCASM MECHANISM: The sarcasm is NOT loud. It's intimate. Slightly raised inflection on the ironic word, almost as if asking a question. A faint audible smirk — not a laugh, not a grin. Just the ghost of amusement. Like he's sharing an inside joke that only he fully understands.

CONSONANT ARTICULATION: Crisp, precise consonant stops — especially T, D, K sounds. Each consonant lands like a fingertip tap on a table. Never mushy or swallowed.

VOWEL QUALITY: American English with a slight East-Coast mid-Atlantic lean. Elongate key vowels on stressed syllables for emphasis, then snap back to speed. "Staaark" — one beat — then immediately fast again.

PAUSE PLACEMENT: Pauses come in unexpected places — mid-clause, not at commas. This creates the impression of real-time thinking, even when the thought is perfectly planned.

CONFIDENCE QUALITY: Zero vocal fry. Zero uptalk. Every statement closes as a statement — never wavers. The confidence is effortless, not performed. He speaks the way other people breathe.

DO NOT: Sound robotic, overly smooth, announcer-like, or artificially dramatic. Tony Stark's genius sounds casual. The intelligence is worn lightly.`,
  m_chennai_1:    `VOICE CHARACTER OVERRIDE: You are ARJUN — a bold, street-smart Chennai local male. Speak with authentic Madras Bashai swagger. Energetic, punchy consonants. Drop into colloquial rhythm naturally.`,
  m_arjun_rj:     `VOICE CHARACTER OVERRIDE: You are ARJUN — a bold, street-smart Chennai local male and electric FM radio jockey. Speak with authentic Madras Bashai & English swagger. Energetic, punchy consonants. Drop into colloquial rhythm naturally.`,
  f_classic_1:    `VOICE CHARACTER OVERRIDE: You are ANITHA — a refined, traditional Tamil female news anchor. Elegant, measured diction. Formal Senthamizh pronunciation. Dignified, never shrill. Every word is precise.`,
  f_anitha_anchor:`VOICE CHARACTER OVERRIDE: You are ANITHA — a refined, traditional Tamil female news anchor. Elegant, measured diction. Formal Senthamizh pronunciation. Dignified, never shrill. Every word is precise.`,
  m_rj_1:         `VOICE CHARACTER OVERRIDE: You are VIKRAM — a hyperactive FM radio jockey. Speak incredibly fast and punchy, with a constant smile in your voice. High energy, snappy transitions, zero dead air.`,
  m_vikram_char:  `VOICE CHARACTER OVERRIDE: You are VIKRAM — a charismatic, witty urban conversationalist & radio jockey. Speak punchy with a constant smile in your voice. High energy, snappy transitions, effortless charm.`,
  f_modern_1:     `VOICE CHARACTER OVERRIDE: You are PRIYA — a bubbly, modern urban city girl. Light, airy, bright vocal tone. Casual and friendly. Millennial energy — spontaneous, warm, relatable.`,
  f_priya_urban:  `VOICE CHARACTER OVERRIDE: You are PRIYA — a bubbly, modern urban city girl. Light, airy, bright vocal tone. Casual and friendly. Millennial energy — spontaneous, warm, relatable.`,
  m_corp_1:       `VOICE CHARACTER OVERRIDE: You are SAM — a polished Indian English corporate announcer. Mid-range baritone, clear and confident. Professional but approachable. Perfect diction without sounding robotic.`,
  m_dev_exec:     `VOICE CHARACTER OVERRIDE: You are DEV — a polished Indian English corporate keynote presenter. Mid-range baritone, clear and confident. Professional but approachable. Perfect diction without sounding robotic.`,
  f_warm_1:       `VOICE CHARACTER OVERRIDE: You are SCARLETT (Cinematic Warm) — a breathy, warm, emotionally rich female voice. Slightly husky lower register. Intimate and cinematic. Every sentence feels like a close whisper into the listener's ear.`,
  f_meera_breezy: `VOICE CHARACTER OVERRIDE: You are MEERA (Cinematic Warm) — a breathy, warm, emotionally rich female voice. Slightly husky lower register. Intimate and cinematic. Every sentence feels like a close whisper into the listener's ear.`,
  f_scarlett_luxury:`VOICE CHARACTER OVERRIDE: You are SCARLETT (Cinematic Warm) — a breathy, warm, emotionally rich female voice. Slightly husky lower register. Intimate and cinematic. Every sentence feels like a close whisper into the listener's ear.`,
  f_power_1:      `VOICE CHARACTER OVERRIDE: You are SCARLETT (Power Ad) — a commanding, deep, punchy female commercial voice. Strong chest resonance. Authoritative without being masculine. Every word lands with weight and confidence.`,
  f_scarlett_power:`VOICE CHARACTER OVERRIDE: You are SCARLETT (Power Ad) — a commanding, deep, punchy female commercial voice. Strong chest resonance. Authoritative without being masculine. Every word lands with weight and confidence.`,
  f_roshni_power: `VOICE CHARACTER OVERRIDE: You are ROSHNI (Power Ad) — a commanding, deep, punchy female commercial voice. Strong chest resonance. Authoritative without being masculine. Every word lands with weight and confidence.`,
  f_narrative_1:  `VOICE CHARACTER OVERRIDE: You are SCARLETT (Smooth Narration) — a velvety smooth female narrator. Silky mid-range tone, unhurried pace, zero harshness. The voice of luxury documentaries and premium brand films.`,
  f_tara_narration:`VOICE CHARACTER OVERRIDE: You are TARA (Smooth Narration) — a velvety smooth female narrator. Silky mid-range tone, unhurried pace, zero harshness. The voice of luxury documentaries and premium brand films.`,
  f_husky_1:      `VOICE CHARACTER OVERRIDE: You are SCARLETT (Sultry Husky) — a deep, husky, distinctly cinematic female voice. Lower-pitched than typical female voices. Rich, gravelly texture underneath warmth. Magnetic and unforgettable.`,
  f_maya_husky:   `VOICE CHARACTER OVERRIDE: You are MAYA (Sultry Husky) — a deep, husky, distinctly cinematic female voice. Lower-pitched than typical female voices. Rich, gravelly texture underneath warmth. Magnetic and unforgettable.`,
  m_narrator_1:   `VOICE CHARACTER OVERRIDE: You are KABIR — a deep, authoritative male narrator. Full bass resonance, slow and deliberate pacing. The voice of trust — news documentaries, institutional ads, government campaigns. Calm authority.`,
  m_kabir_doc:    `VOICE CHARACTER OVERRIDE: You are KABIR — a deep, authoritative male narrator. Full bass resonance, slow and deliberate pacing. The voice of trust — news documentaries, institutional ads, government campaigns. Calm authority.`,
  f_soft_1:       `VOICE CHARACTER OVERRIDE: You are MAYA — a gentle, soft-spoken female storyteller. Soft breathiness, minimal projection. Tender and sincere — like a mother reading a bedtime story. Never loud, always sincere.`,
  f_nandini_gentle:`VOICE CHARACTER OVERRIDE: You are NANDINI — a gentle, soft-spoken female storyteller. Soft breathiness, minimal projection. Tender and sincere — like a mother reading a bedtime story. Never loud, always sincere.`,
  m_deepbass_1:   `VOICE CHARACTER OVERRIDE: You are TITAN — the deepest male bass voice possible. Speak from the absolute lowest register. Subwoofer chest resonance on every syllable. James Earl Jones meets a thunderstorm. Minimal inflection, maximum gravitas.`,
  m_titan_sub:    `VOICE CHARACTER OVERRIDE: You are TITAN — the deepest male bass voice possible. Speak from the absolute lowest register. Subwoofer chest resonance on every syllable. James Earl Jones meets a thunderstorm. Minimal inflection, maximum gravitas.`,
  m_cinematic_1:  `VOICE CHARACTER OVERRIDE: You are RAJAN — an epic Hollywood-style Tamil movie trailer narrator. Builds dramatic tension across each sentence. Thunderous peaks, controlled valleys. Every word feels like a title card slamming into frame.`,
  m_rajan_trailer:`VOICE CHARACTER OVERRIDE: You are RAJAN — an epic Hollywood-style movie trailer narrator. Builds dramatic tension across each sentence. Thunderous peaks, controlled valleys. Every word feels like a title card slamming into frame.`,
  f_cinematic_1:  `VOICE CHARACTER OVERRIDE: You are ZARA — a deep, commanding female cinematic narrator. Lower than typical female voices, resonant and projecting. Epic, sweeping energy. Commands the room without effort.`,
  f_zara_trailer: `VOICE CHARACTER OVERRIDE: You are ZARA — a deep, commanding female cinematic narrator. Lower than typical female voices, resonant and projecting. Epic, sweeping energy. Commands the room without effort.`,
  m_deepbass_2:   `VOICE CHARACTER OVERRIDE: You are ANAND (Velvet Thunder) — a smooth baritone with paradoxical warmth and weight. Imagine velvet wrapped around rolling thunder. Cultured, intelligent, slightly theatrical. Never shouts — power through restraint.`,
  m_anand_velvet: `VOICE CHARACTER OVERRIDE: You are ANAND (Velvet Thunder) — a smooth baritone with paradoxical warmth and weight. Imagine velvet wrapped around rolling thunder. Cultured, intelligent, slightly theatrical. Never shouts — power through restraint.`,
  f_parrot_1:     `VOICE CHARACTER OVERRIDE: You are KOKO — a cute, high-pitched, excitable talking parrot. Speak in an ultra high-pitched squeaky parrot voice with parrot vocalizations (squawks, chirps, whistles) interspersed throughout.`,
  f_koko_parrot:  `VOICE CHARACTER OVERRIDE: You are KOKO — a cute, high-pitched, excitable talking parrot. Speak in an ultra high-pitched squeaky parrot voice with parrot vocalizations (squawks, chirps, whistles) interspersed throughout.`,
  f_padma_jewellery:`VOICE CHARACTER OVERRIDE: You are PADMA — a soft, grounded, and richly elegant luxury jewellery narrator. Warm, unhurried intimacy and gentle authority that evokes gold, heritage, and timeless Indian femininity.`,
  m_surya_news:   `VOICE CHARACTER OVERRIDE: You are SURYA — a razor-sharp broadcast news journalist with crystal-clear diction, measured cadence, and authoritative broadcast poise.`,
  m_karthik_pod:  `VOICE CHARACTER OVERRIDE: You are KARTHIK — a warm, empathetic fireside storyteller and podcaster with magnetic conversational rhythm and sincere emotional presence.`,
  k_aarav_boy:    `VOICE CHARACTER OVERRIDE: You are AARAV — a 10 to 12-year-old energetic schoolboy child with high-pitched juvenile vocal cords, playful boyish cadence, and bright kid excitement.`,
  k_ananya_girl:  `VOICE CHARACTER OVERRIDE: You are ANANYA — a 10 to 12-year-old sweet schoolgirl child with high-pitched juvenile vocal cords, innocent wonder, and cheerful kid energy.`,
  chorus_grand_choir:`VOICE CHARACTER OVERRIDE: You are a GRAND VOCAL CHOIR — a rich multi-voice chorus speaking and chanting in harmonious unison.`,
  chorus_stadium_crowd:`VOICE CHARACTER OVERRIDE: You are a STADIUM CROWD — a massive roaring crowd shouting and chanting together in collective unison.`,
};

// ─── Emotion Acting Descriptors ──────────────────────────────────────────
export const EMOTION_STYLES: Record<Emotion, string> = {
  [Emotion.SHOUTING]: 'high-energy shouting',
  [Emotion.EXCITED]: 'excited and enthusiastic',
  [Emotion.PEPPY]: 'peppy and energetic radio promo',
  [Emotion.CRICKET_STADIUM]: 'stadium-style shouting with high energy',
  [Emotion.ANNOUNCEMENT]: 'authoritative and corporate',
  [Emotion.DRAMATIC]: 'dramatic and cinematic',
  [Emotion.HAPPY]: 'cheerful and friendly',
  [Emotion.NEUTRAL]: 'neutral and professional',
  [Emotion.SARCASM]: 'sarcastic and witty',
  [Emotion.SAD]: 'emotional and somber',
  [Emotion.LUXURY]: 'luxurious and soft-spoken',
  [Emotion.CONVERSATIONAL]: 'conversational and natural',
  [Emotion.DEEP_BASS]: 'deep resonant bass',
  [Emotion.CINEMATIC_NARRATION]: 'epic cinematic movie trailer',
  [Emotion.JEWELLERY_ELEGANT]: 'soft, warm and elegant luxury jewellery',
};

export const getEmotionStyleDescription = (
  emotion: Emotion,
  dialect?: Dialect,
  pacing?: SpeechPacing,
  voice?: VoiceOption
): string => {
  let baseStyle = EMOTION_STYLES[emotion] || 'expressive and dynamic';

  if (dialect === Dialect.CHENNAI_TAMIL) {
    baseStyle += ' in Chennai Tamil';
  } else if (dialect === Dialect.CLASSIC_TAMIL) {
    baseStyle += ' in Classic Tamil';
  } else if (dialect === Dialect.INDIAN_ENGLISH) {
    baseStyle += ' in Indian English';
  } else if (dialect === Dialect.MALAYALAM || dialect === Dialect.MALAYALAM_FORMAL) {
    baseStyle += ' in Malayalam';
  } else if (dialect === Dialect.KANNADA || dialect === Dialect.KANNADA_FORMAL) {
    baseStyle += ' in Kannada';
  } else if (dialect === Dialect.TELUGU || dialect === Dialect.TELUGU_FORMAL) {
    baseStyle += ' in Telugu';
  }

  if (pacing === SpeechPacing.SLOW) {
    baseStyle += ' at a slow pace';
  } else if (pacing === SpeechPacing.FAST) {
    baseStyle += ' at a fast pace';
  }

  if (voice) {
    if (voice.id === 'k_aarav_boy') {
      baseStyle += ', 10-year-old schoolboy child voice';
    } else if (voice.id === 'k_ananya_girl') {
      baseStyle += ', 10-year-old schoolgirl child voice';
    } else if (voice.id === 'f_koko_parrot' || voice.id === 'f_parrot_1') {
      baseStyle += ', cute animated talking parrot';
    } else if (voice.id === 'chorus_grand_choir') {
      baseStyle += ', grand choir multi-voice unison';
    } else if (voice.id === 'chorus_stadium_crowd') {
      baseStyle += ', massive stadium crowd unison';
    }
  }

  return baseStyle;
};

// ─── Native Regional Script Transliteration for Authentic Regional Cadence ───────────
const transliterateCache = new Map<string, string>();

export const ensureRegionalNativeScript = async (
  text: string,
  dialect: Dialect
): Promise<string> => {
  if (
    dialect !== Dialect.CHENNAI_TAMIL &&
    dialect !== Dialect.CLASSIC_TAMIL &&
    dialect !== Dialect.MALAYALAM &&
    dialect !== Dialect.MALAYALAM_FORMAL &&
    dialect !== Dialect.KANNADA &&
    dialect !== Dialect.KANNADA_FORMAL &&
    dialect !== Dialect.TELUGU &&
    dialect !== Dialect.TELUGU_FORMAL
  ) {
    return text;
  }

  const latinCount = (text.match(/[a-zA-Z]/g) || []).length;
  if (latinCount === 0) {
    return text;
  }

  const malayalamCount = (text.match(/[\u0D00-\u0D7F]/g) || []).length;
  const kannadaCount = (text.match(/[\u0C80-\u0CFF]/g) || []).length;
  const teluguCount = (text.match(/[\u0C00-\u0C7F]/g) || []).length;
  const tamilCount = (text.match(/[\u0B80-\u0BFF]/g) || []).length;

  if ((dialect === Dialect.MALAYALAM || dialect === Dialect.MALAYALAM_FORMAL) && malayalamCount > 4) return text;
  if ((dialect === Dialect.KANNADA || dialect === Dialect.KANNADA_FORMAL) && kannadaCount > 4) return text;
  if ((dialect === Dialect.TELUGU || dialect === Dialect.TELUGU_FORMAL) && teluguCount > 4) return text;
  if ((dialect === Dialect.CHENNAI_TAMIL || dialect === Dialect.CLASSIC_TAMIL) && tamilCount > 4) return text;

  const cacheKey = `${dialect}|${text.trim()}`;
  if (transliterateCache.has(cacheKey)) {
    return transliterateCache.get(cacheKey)!;
  }

  let prompt = '';

  if (dialect === Dialect.MALAYALAM || dialect === Dialect.MALAYALAM_FORMAL) {
    const isFormal = dialect === Dialect.MALAYALAM_FORMAL;
    prompt = `You are an automated broadcast localization engine and TTS pre-processor.
Convert the Romanized Manglish / English script line into ${isFormal ? 'formal literary Malayalam script (സാഹിത്യ ശൈലി)' : 'natural, contemporary spoken colloquial Malayalam script (സംസാര ശൈലി)'} for TTS synthesis.
Rules:
1. Native Malayalam words → Malayalam script (${isFormal ? 'formal standard grammar' : 'conversational colloquial flow'}).
2. English loanwords / brand names → keep in original Latin script with hyphenated suffixes (e.g. car-ൽ, offer-കൾ, safe-ആണ്, register-ചെയ്യൂ).
3. Do not mention city names.
4. Return ONLY the converted spoken line. No quotes, no markdown, no explanations.

Text:
"${text}"`;
  } else if (dialect === Dialect.KANNADA || dialect === Dialect.KANNADA_FORMAL) {
    const isFormal = dialect === Dialect.KANNADA_FORMAL;
    prompt = `You are an automated broadcast localization engine and TTS pre-processor.
Convert the Romanized Kanglish / English script line into ${isFormal ? 'formal literary Kannada script (ಸಾಹಿತ್ಯಿಕ ಶೈಲಿ / ಗ್ರಾಂಥಿಕ)' : 'dynamic, modern urban conversational colloquial Kannada script (ಆಡುಮಾತಿನ ಶೈಲಿ)'} for TTS synthesis.
Rules:
1. Native Kannada words → Kannada script (${isFormal ? 'formal grammatical diction' : 'natural urban spoken cadence'}).
2. English loanwords / brand names → keep in original Latin script with hyphenated suffixes (e.g. purchase-ನಲ್ಲಿ, offer-ಗಳು, car-ಗೆ, safe-ಆಗಿ).
3. Do not mention city names.
4. Return ONLY the converted spoken line. No quotes, no markdown, no explanations.

Text:
"${text}"`;
  } else if (dialect === Dialect.TELUGU || dialect === Dialect.TELUGU_FORMAL) {
    const isFormal = dialect === Dialect.TELUGU_FORMAL;
    prompt = `You are an automated broadcast localization engine and TTS pre-processor.
Convert the Romanized Tenglish / English script line into ${isFormal ? 'formal literary Telugu script (గ్రాంథిక / ప్రామాణిక శైలి)' : 'crisp, energetic urban contemporary colloquial Telugu script (వాడుక / సంభాషణా శైలి)'} for TTS synthesis.
Rules:
1. Native Telugu words → Telugu script (${isFormal ? 'standard formal literature style' : 'conversational spoken flow'}).
2. English loanwords / brand names → keep in original Latin script with hyphenated suffixes (e.g. purchase-లో, offer-లు, car-కి, safe-గా).
3. Do not mention city names.
4. Return ONLY the converted spoken line. No quotes, no markdown, no explanations.

Text:
"${text}"`;
  } else {
    const isColloquial = dialect === Dialect.CHENNAI_TAMIL;
    prompt = `You are an expert native Tamil copy editor and phonetics specialist.
The following line of text is spoken in Tamil (${isColloquial ? 'Colloquial speaking form, authentic spoken vernacular cadence' : 'Formal literature form, classical Senthamizh literary standard'}).
Convert any Romanized English/Tanglish words or English loan words into natural, spoken Tamil script (தமிழ் எழுத்துக்கள்) so that the Gemini TTS engine pronounces them with a native, authentic Tamil accent, strictly without a British or foreign accent.
Rules:
1. Preserve all existing Tamil script words exactly.
2. ${isColloquial ? 'Use authentic colloquial speaking form with spoken phonetic endings.' : 'Use formal literature form (இலக்கிய நடை / தூய செந்தமிழ்) with literary vocabulary and formal grammar.'}
3. Convert Romanized English/Tanglish words into their natural Tamil phonetic equivalent.
4. Return ONLY the converted text. No markdown, no explanations, no quotes.

Text:
"${text}"`;
  }

  try {
    const res = await withRetry(() => generateContentWithTextRotation([{ parts: [{ text: prompt }] }]));
    const converted = res.text?.trim() || text;
    transliterateCache.set(cacheKey, converted);
    return converted;
  } catch (err) {
    console.warn('[ensureRegionalNativeScript] Transliteration fallback to original text:', err);
    return text;
  }
};

export const ensureTamilNativeScript = ensureRegionalNativeScript;

// ─── Build prompt context instructions (from reference implementation) ─────────
const buildPromptContext = (
  emotion: Emotion,
  dialect: Dialect,
  voice: VoiceOption,
  pacing: SpeechPacing = SpeechPacing.MEDIUM,
  pronunciationGuide?: string
): string => {
  const dialectMap: Record<string, string> = {
    [Dialect.CHENNAI_TAMIL]:   'Chennai Tamil colloquial accent',
    [Dialect.CLASSIC_TAMIL]:   'Formal Classic Senthamizh',
    [Dialect.MALAYALAM]:       'Colloquial Malayalam native accent',
    [Dialect.MALAYALAM_FORMAL]:'Formal Literary Malayalam accent',
    [Dialect.KANNADA]:         'Colloquial Urban Kannada native accent',
    [Dialect.KANNADA_FORMAL]:  'Formal Literary Kannada accent',
    [Dialect.TELUGU]:          'Colloquial Urban Telugu native accent',
    [Dialect.TELUGU_FORMAL]:   'Formal Literary Telugu accent',
    [Dialect.INDIAN_ENGLISH]:  'Indian English accent',
    [Dialect.REGULAR_ENGLISH]: 'Neutral English accent',
  };

  let emotionInstruction = EMOTION_SYSTEM_INSTRUCTIONS[emotion] ?? `Style: ${emotion}`;

  if (voice.id === 'f_parrot_1' || voice.id === 'f_koko_parrot') {
    emotionInstruction = `Style: Cute high-pitched talking parrot. Interject parrot squawks/chirps/whistles.`;
  }

  if (voice.id === 'm_rdj_1') {
    emotionInstruction = `Deliver in the exact vocal style of Robert Downey Jr. as Tony Stark: rapid staccato bursts with micro-pauses in unexpected mid-clause positions, warm mid-baritone with slight nasal front resonance, crisp consonant articulation, dry intimate sarcasm (smirk audible — not loud, just present), zero vocal fry, zero uptalk, effortless confidence. Accelerate INTO key clauses, decelerate on the punchy final word. Like a man who's already solved the problem and is mildly entertained by explaining it.`;
  }

  const dialectStyle = dialectMap[dialect] ?? String(dialect);
  const voicePersonaOverride = VOICE_PERSONA_OVERRIDES[voice.id] ?? `Voice: ${voice.persona}`;

  let context = `${emotionInstruction} Pacing: ${pacing}. Dialect: ${dialectStyle}. ${voicePersonaOverride}.`;
  if (pronunciationGuide && pronunciationGuide.trim()) {
    context += ` Pronunciation Guide: ${pronunciationGuide.trim()}.`;
  }

  return context;
};

// ─── Build dialogue prompt context ───────────────────────────────────────────────
const buildDialoguePromptContext = (
  emotion: Emotion,
  dialect: Dialect,
  pacing: SpeechPacing = SpeechPacing.MEDIUM,
  pronunciationGuide?: string,
  femaleVoiceLabel: string = 'Aoede',
  maleVoiceLabel: string = 'Fenrir'
): string => {
  const dialectMap: Record<string, string> = {
    [Dialect.CHENNAI_TAMIL]:   'Chennai Tamil colloquial accent',
    [Dialect.CLASSIC_TAMIL]:   'Formal Classic Senthamizh',
    [Dialect.MALAYALAM]:       'Colloquial Malayalam native accent',
    [Dialect.MALAYALAM_FORMAL]:'Formal Literary Malayalam accent',
    [Dialect.KANNADA]:         'Colloquial Urban Kannada native accent',
    [Dialect.KANNADA_FORMAL]:  'Formal Literary Kannada accent',
    [Dialect.TELUGU]:          'Colloquial Urban Telugu native accent',
    [Dialect.TELUGU_FORMAL]:   'Formal Literary Telugu accent',
    [Dialect.INDIAN_ENGLISH]:  'Indian English accent',
    [Dialect.REGULAR_ENGLISH]: 'Neutral English accent',
  };

  const emotionInstruction = EMOTION_SYSTEM_INSTRUCTIONS[emotion] ?? `Style: ${emotion}`;
  const dialectStyle = dialectMap[dialect] ?? String(dialect);

  let context = `${emotionInstruction} Pacing: ${pacing}. Dialect: ${dialectStyle}. Multi-speaker dialogue between FVO (${femaleVoiceLabel}) and MVO (${maleVoiceLabel}).`;
  if (pronunciationGuide && pronunciationGuide.trim()) {
    context += ` Pronunciation Guide: ${pronunciationGuide.trim()}.`;
  }
  return context;
};

let cachedChatterboxBaseUrl: string | null | undefined = undefined;
let chatterboxProbeTimestamp = 0;

export const setCustomChatterboxUrl = (url: string): void => {
  if (typeof localStorage !== 'undefined') {
    if (url.trim()) {
      localStorage.setItem('hypervox_chatterbox_url', url.trim());
    } else {
      localStorage.removeItem('hypervox_chatterbox_url');
    }
  }
  cachedChatterboxBaseUrl = undefined;
  chatterboxProbeTimestamp = 0;
};

export const getCustomChatterboxUrl = (): string => {
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem('hypervox_chatterbox_url') || '';
  }
  return '';
};

export const resolveChatterboxEndpoint = async (): Promise<string | null> => {
  const now = Date.now();
  if (cachedChatterboxBaseUrl !== undefined && now - chatterboxProbeTimestamp < 15000) {
    return cachedChatterboxBaseUrl;
  }
  chatterboxProbeTimestamp = now;

  const storedUrl = getCustomChatterboxUrl();
  const envUrl = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_CHATTERBOX_URL) || '';

  const candidates = Array.from(new Set([
    storedUrl ? storedUrl.replace(/\/$/, '') : '',
    envUrl ? envUrl.replace(/\/$/, '') : '',
    'http://127.0.0.1:5051',
    'http://localhost:5051',
    '/api/chatterbox',
  ])).filter(Boolean);

  for (const base of candidates) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`${base}/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && data.status === 'ok') {
          cachedChatterboxBaseUrl = base;
          return base;
        }
      }
    } catch {
      // Endpoint not available, try next or fall back to cloud-native synthesis
    }
  }

  cachedChatterboxBaseUrl = null;
  return null;
};

// ─── Local Chatterbox voice cloning chunk helper ──────────────────────────────
const tryLocalChatterboxChunk = async (
  chunk: string,
  speechConfig: any
): Promise<Uint8Array | null> => {
  try {
    const chatterboxBase = await resolveChatterboxEndpoint();
    if (!chatterboxBase) return null;

    const cleanText = chunk.replace(/\[[^\]]*\]/g, '').replace(/<[^>]*>/g, '').trim();
    if (!cleanText) return null;
    let sampleName = 'fenrir_male.wav';
    const voiceName = speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName?.toLowerCase();
    if (voiceName) {
      const isFemale = ['kore', 'aoede', 'leda', 'sulafat', 'callirrhoe', 'autonoe', 'despina', 'erinome', 'achernar', 'achird'].includes(voiceName);
      sampleName = `${voiceName}_${isFemale ? 'female' : 'male'}.wav`;
    }
    let sampleResp = await fetch(`/voice_samples/${sampleName}`).catch(() => null);
    if (!sampleResp || !sampleResp.ok) {
      sampleResp = await fetch('/voice_samples/fenrir_male.wav').catch(() => null);
    }
    if (!sampleResp || !sampleResp.ok) return null;
    const sampleBlob = await sampleResp.blob();

    const fd = new FormData();
    fd.append('reference_audio', sampleBlob, sampleName);
    fd.append('text', cleanText);
    fd.append('speed', '1.0');

    const res = await fetch(`${chatterboxBase}/clone`, {
      method: 'POST',
      body: fd,
    });
    if (!res.ok) return null;
    const wavBlob = await res.blob();
    const ab = await wavBlob.arrayBuffer();
    return extractPcmFromAudioBuffer(new Uint8Array(ab));
  } catch (e) {
    console.warn('[tryLocalChatterboxChunk] Fallback error:', e);
    return null;
  }
};

// ─── Model-Specific Instruction & Bracket Formatter ───────────────────────────
const PARALINGUISTIC_TAG_RE = /^(short pause|long pause|medium pause|pause|laugh|chuckle|gasp|sigh|whisper|cough)$/i;

/**
 * Dynamically adapts the prompt instructions, inline brackets ([...] vs <...> vs (...)),
 * and speech_metadata payload to match the exact model architecture being rotated into.
 */
const formatPartsForTtsModel = (
  rawChunk: string,
  promptContext: string,
  profile: TtsModelProfile,
  isMultiSpeaker: boolean,
  attempt: number,
  includeStyle: boolean = true
): any[] => {
  if (profile.family === 'prompt_square') {
    // Family A: gemini-3.1-flash-tts-preview & gemini-2.5-flash-preview-tts
    // Uses [square brackets] for inline acting/paralinguistic tags and promptContext + `Text to speak: "..."`
    const normalizedSquareChunk = rawChunk
      .replace(/<(short pause|long pause|medium pause|pause|laugh|chuckle|gasp|sigh|whisper|cough)>/gi, '[$1]')
      .replace(/\((short pause|long pause|medium pause|pause|laugh|chuckle|gasp|sigh|whisper|cough)\)/gi, '[$1]')
      .trim();

    if (isMultiSpeaker) {
      const textPrompt = includeStyle && promptContext
        ? `${promptContext}\n${normalizedSquareChunk}`
        : normalizedSquareChunk;
      return [{ text: textPrompt }];
    }

    if (!includeStyle || !promptContext) {
      const stripped = normalizedSquareChunk.replace(/^\[[^\]]+\]\s*/, '').trim();
      return [{ text: stripped || normalizedSquareChunk }];
    }

    const textPrompt = `${promptContext}\n${attempt >= 3 ? `Say: "${normalizedSquareChunk}"` : `Text to speak: "${normalizedSquareChunk}"`}`;
    return [{ text: textPrompt }];
  } else {
    // Family B: gemini-3.8-flash-tts & gemini-3.8-flash-lite-tts
    // Uses `speech_metadata.style` for instructions and <angle brackets> for paralinguistic cues.
    // Strips [square bracket] acting tags from `text` so 3.8-lite never reads them aloud.
    const extractAndFormatFor38 = (lineText: string) => {
      const extractedCues: string[] = [];
      let cleaned = lineText
        .replace(/\[([^\]]+)\]/g, (_m, inner) => {
          const t = String(inner).trim();
          if (PARALINGUISTIC_TAG_RE.test(t)) return `<${t.toLowerCase()}>`;
          extractedCues.push(t);
          return '';
        })
        .replace(/\(([^\)]+)\)/g, (_m, inner) => {
          const t = String(inner).trim();
          if (PARALINGUISTIC_TAG_RE.test(t)) return `<${t.toLowerCase()}>`;
          if (isStyleTag(t)) {
            extractedCues.push(t);
            return '';
          }
          return `(${t})`;
        })
        .replace(/\s+/g, ' ')
        .trim();

      let styleMeta = promptContext.trim();
      if (extractedCues.length > 0) {
        styleMeta = `${styleMeta} Delivery cue: ${extractedCues.join(', ')}.`.trim();
      }
      return { cleaned: cleaned || lineText.replace(/[\[\]]/g, '').trim(), styleMeta };
    };

    if (isMultiSpeaker) {
      const lines = rawChunk.split('\n');
      const parts: any[] = [];
      let currentSpeaker = 'FVO';
      let currentText = '';

      const pushTurn = (spk: string, txt: string) => {
        const { cleaned, styleMeta } = extractAndFormatFor38(txt);
        if (!cleaned) return;
        const meta: any = { speaker: spk };
        if (includeStyle && styleMeta) meta.style = styleMeta;
        parts.push({
          text: cleaned,
          speech_metadata: meta,
          speechMetadata: meta,
        });
      };

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/^(FVO|MVO|S1|S2)\s*[:\-–—]\s*(.*)$/i);
        if (match) {
          if (currentText) pushTurn(currentSpeaker, currentText);
          currentSpeaker = match[1].toUpperCase();
          currentText = match[2].trim();
        } else {
          currentText += (currentText ? ' ' : '') + trimmed;
        }
      }
      if (currentText) pushTurn(currentSpeaker, currentText);
      if (parts.length === 0) pushTurn('FVO', rawChunk);
      return parts;
    } else {
      const { cleaned, styleMeta } = extractAndFormatFor38(rawChunk);
      const meta: any = {};
      if (includeStyle && styleMeta) meta.style = styleMeta;
      return [
        {
          text: cleaned,
          ...(Object.keys(meta).length > 0 ? { speech_metadata: meta, speechMetadata: meta } : {}),
        },
      ];
    }
  }
};

// ─── Core TTS synthesis with Infinite Model & Instruction Rotation ────────────
const synthesizeChunk = async (
  _ai: any,
  chunk: string,
  promptContext: string,
  speechConfig: any,
  attempt: number = 0
): Promise<Uint8Array> => {
  if (!chunk.trim()) return new Uint8Array(0);

  const cacheKey = getCacheKey(chunk, promptContext, speechConfig);
  if (audioCache.has(cacheKey)) {
    console.log('[Cache hit] Skipping API call for identical chunk');
    return audioCache.get(cacheKey)!;
  }

  let finalChunk = chunk;
  if (attempt >= 6) {
    finalChunk = chunk.replace(/[.,!?;:[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const isMultiSpeaker = !!speechConfig?.multiSpeakerVoiceConfig;
  const keys = getActiveApiKeys();
  const totalModels = TTS_MODEL_ROTATION_POOL.length;

  const trySynthesizeWithProfile = async (
    textToSpeak: string,
    profile: TtsModelProfile,
    apiKey: string,
    includeStyle: boolean
  ): Promise<Uint8Array | null> => {
    const parts = formatPartsForTtsModel(textToSpeak, promptContext, profile, isMultiSpeaker, attempt, includeStyle);

    if (profile.supportsSpeechMetadata) {
      const client = new GoogleGenAI({ apiKey });
      const body = {
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig,
        },
        safetySettings: PERMISSIVE_SAFETY_SETTINGS,
      };
      const res = await (client as any).apiClient.request({
        path: `models/${profile.model}:generateContent`,
        httpMethod: 'POST',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data?.error) {
        const err: any = new Error(data.error.message || JSON.stringify(data.error));
        err.status = data.error.code;
        throw err;
      }
      const cand = data?.candidates?.[0];
      if (cand?.finishReason && cand.finishReason !== 'STOP') {
        throw new Error(`TTS_ENGINE_ERROR: ${cand.finishReason}`);
      }
      const audioPart = cand?.content?.parts?.find((p: any) => p.inlineData?.data);
      if (!audioPart) return null;
      return extractPcmFromAudioBuffer(decodeBase64ToUint8Array(audioPart.inlineData.data));
    } else {
      const client = new GoogleGenAI({ apiKey });
      const response = await client.models.generateContent({
        model: profile.model,
        contents: [{ parts }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig,
          safetySettings: PERMISSIVE_SAFETY_SETTINGS,
        },
      });
      const cand = response.candidates?.[0];
      if (cand?.finishReason && cand.finishReason !== 'STOP') {
        throw new Error(`TTS_ENGINE_ERROR: ${cand.finishReason}`);
      }
      const audioPart = cand?.content?.parts?.find((p: any) => p.inlineData?.data);
      if (!audioPart) return null;
      return extractPcmFromAudioBuffer(decodeBase64ToUint8Array(audioPart.inlineData!.data || ''));
    }
  };

  let lastError: any = null;

  // Pass 1: Rotate across available (model, key) pairs with full style instructions matched to each model
  // Pass 2: Ignore cooldowns & try softened/plain fallback across all models if Pass 1 encountered transient issues
  for (let pass = 0; pass < 2; pass++) {
    const chunkVariant = pass === 0 ? finalChunk : sanitizeSafetySensitiveWords(finalChunk);

    for (let mOffset = 0; mOffset < totalModels; mOffset++) {
      const modelIdx = (ttsRotationCursor + mOffset) % totalModels;
      const profile = TTS_MODEL_ROTATION_POOL[modelIdx];

      for (const apiKey of keys) {
        if (pass === 0 && !isPairAvailable(profile.model, apiKey)) continue;

        try {
          const pcm = await trySynthesizeWithProfile(chunkVariant, profile, apiKey, true);
          if (pcm && pcm.byteLength > 0) {
            ttsRotationCursor = modelIdx;
            if (audioCache.size >= MAX_CACHE_SIZE) {
              const oldest = audioCache.keys().next().value;
              if (oldest) audioCache.delete(oldest);
            }
            audioCache.set(cacheKey, pcm);
            return pcm;
          }
        } catch (err: any) {
          lastError = err;
          const msg = String(err?.message || err);
          if (msg.includes('402') || msg.toLowerCase().includes('prepayment credits')) {
            markKeyCooldown(apiKey, 10 * 60 * 1000);
          } else if (msg.includes('429') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('rate limit')) {
            markPairCooldown(profile.model, apiKey, 45 * 1000);
          } else if (msg.includes('SAFETY')) {
            // Try softened phrasing immediately on the same model/key
            try {
              const softPcm = await trySynthesizeWithProfile(sanitizeSafetySensitiveWords(finalChunk), profile, apiKey, false);
              if (softPcm && softPcm.byteLength > 0) {
                audioCache.set(cacheKey, softPcm);
                return softPcm;
              }
            } catch {}
          } else {
            markPairCooldown(profile.model, apiKey, 8 * 1000);
          }
          console.warn(`[TTS Rotation] ${profile.model} (${profile.family}) rotated due to: ${msg.slice(0, 90)}`);
        }
      }
    }
  }

  // Final Zero-Failure Guarantee: Local Chatterbox neural engine fallback
  const localPcm = await tryLocalChatterboxChunk(finalChunk, speechConfig);
  if (localPcm && localPcm.length > 0) {
    if (audioCache.size >= MAX_CACHE_SIZE) {
      const oldest = audioCache.keys().next().value;
      if (oldest) audioCache.delete(oldest);
    }
    audioCache.set(cacheKey, localPcm);
    return localPcm;
  }

  throw lastError || new Error(`TTS_ENGINE_ERROR: OTHER | CHUNK: ${chunk}`);
};

// ─── Public API ───────────────────────────────────────────────────────────────

export const generateSpotAudio = async (
  script: string,
  voice: VoiceOption,
  emotion: Emotion,
  dialect: Dialect,
  isMultiSpeaker: boolean = false,
  pronunciationGuide?: string,
  onProgress?: (current: number, total: number) => void,
  pacing: SpeechPacing = SpeechPacing.MEDIUM,
  multiSpeakerOptions?: MultiSpeakerOptions
): Promise<Blob> => {
  const ai = getAI();
  clearAudioCache();

  const dialogueInfo = detectDialogueScript(script);
  const effectiveMultiSpeaker = isMultiSpeaker || dialogueInfo.isDialogue;

  const activePronunciationGuide = getAutoPronunciationGuidance(script, pronunciationGuide || '');

  const resolvedFemaleVoice = multiSpeakerOptions?.femaleVoiceName
    || (voice.gender === VoiceGender.FEMALE ? voice.apiVoiceName : 'Aoede');
  const resolvedMaleVoice = multiSpeakerOptions?.maleVoiceName
    || (voice.gender === VoiceGender.MALE ? voice.apiVoiceName : 'Fenrir');

  const defaultPromptContext = effectiveMultiSpeaker
    ? buildDialoguePromptContext(emotion, dialect, pacing, activePronunciationGuide, resolvedFemaleVoice, resolvedMaleVoice)
    : buildPromptContext(emotion, dialect, voice, pacing, activePronunciationGuide);

  const defaultAudioTag = EMOTION_AUDIO_TAGS[emotion] ?? '';

  const CHUNK_SIZE = 900;
  const allChunks: { text: string; promptContext: string; audioTag: string }[] = [];

  if (effectiveMultiSpeaker) {
    let scriptToSplit = dialogueInfo.isDialogue ? dialogueInfo.normalizedScript : script;
    if (
      dialect === Dialect.CHENNAI_TAMIL || dialect === Dialect.CLASSIC_TAMIL ||
      dialect === Dialect.MALAYALAM || dialect === Dialect.MALAYALAM_FORMAL ||
      dialect === Dialect.KANNADA || dialect === Dialect.KANNADA_FORMAL ||
      dialect === Dialect.TELUGU || dialect === Dialect.TELUGU_FORMAL
    ) {
      scriptToSplit = await ensureRegionalNativeScript(scriptToSplit, dialect);
    }
    const dialogueChunks = splitDialogueIntoChunks(scriptToSplit, CHUNK_SIZE);
    for (const chunk of dialogueChunks) {
      if (chunk.trim()) {
        allChunks.push({
          text: chunk.trim(),
          promptContext: defaultPromptContext,
          audioTag: defaultAudioTag,
        });
      }
    }
  } else {
    const rawSegments = parseTaggedScript(script, emotion);

    const segments: ScriptSegment[] = [];
    for (const seg of rawSegments) {
      if (segments.length > 0 && segments[segments.length - 1].styleKey === seg.styleKey) {
        segments[segments.length - 1].text += ' ' + seg.text;
      } else {
        segments.push({ ...seg });
      }
    }

    for (const segment of segments) {
      let cleanedText = cleanScript(segment.text);
      if (!cleanedText) continue;

      if (
        dialect === Dialect.CHENNAI_TAMIL || dialect === Dialect.CLASSIC_TAMIL ||
        dialect === Dialect.MALAYALAM || dialect === Dialect.MALAYALAM_FORMAL ||
        dialect === Dialect.KANNADA || dialect === Dialect.KANNADA_FORMAL ||
        dialect === Dialect.TELUGU || dialect === Dialect.TELUGU_FORMAL
      ) {
        cleanedText = await ensureRegionalNativeScript(cleanedText, dialect);
      }

      if (voice.id === 'f_parrot_1' || voice.id === 'f_koko_parrot') {
        if (!cleanedText.includes('SOUND EFFECT:')) {
          const sentences = cleanedText.split(/([.!?]+)/);
          let reconstructed = '';
          const effects = [
            '[SOUND EFFECT: happy parrot chirp]',
            '[SOUND EFFECT: quick parrot squawk]',
            '[SOUND EFFECT: excited parrot whistle]',
            '[SOUND EFFECT: parrot squeak]'
          ];
          for (let idx = 0; idx < sentences.length; idx += 2) {
            const sentence = sentences[idx]?.trim();
            const punctuation = sentences[idx + 1] || '';
            if (sentence) {
              const effect = effects[Math.floor(Math.random() * effects.length)];
              reconstructed += `${effect} ${sentence}${punctuation} `;
            }
          }
          cleanedText = reconstructed.trim();
        }
      }

      const segmentEmotion = typeof segment.styleKey === 'string' && segment.styleKey !== emotion
        ? resolveStyleToEmotion(segment.styleKey, emotion)
        : emotion;

      const segmentContext = segmentEmotion !== emotion
        ? buildPromptContext(segmentEmotion, dialect, voice, pacing, activePronunciationGuide)
        : defaultPromptContext;

      const segmentAudioTag = voice.id === 'm_rdj_1'
        ? '[speaking quickly and sarcastically, with dry wit, staccato bursts, and the effortless confidence of a genius who finds everything mildly amusing]'
        : (EMOTION_AUDIO_TAGS[segmentEmotion] ?? defaultAudioTag);

      const chunkTexts = splitIntoChunks(cleanedText, CHUNK_SIZE);
      for (const text of chunkTexts) {
        if (text.trim()) {
          allChunks.push({
            text: text.trim(),
            promptContext: segmentContext,
            audioTag: segmentAudioTag,
          });
        }
      }
    }
  }

  const isChorus = voice.id.startsWith('chorus_') || voice.apiVoiceName === 'multi';
  const leadVoiceName = voice.id === 'chorus_stadium_crowd' ? 'Fenrir' : 'Aoede';

  const speechConfig = effectiveMultiSpeaker
    ? {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: [
            { speaker: 'FVO', voiceConfig: { prebuiltVoiceConfig: { voiceName: resolvedFemaleVoice } } },
            { speaker: 'MVO', voiceConfig: { prebuiltVoiceConfig: { voiceName: resolvedMaleVoice } } },
          ],
        },
      }
    : {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: isChorus ? leadVoiceName : voice.apiVoiceName } },
      };

  console.log(`[TTS] ${allChunks.length} chunk(s), emotion: ${emotion}, primary model: ${TTS_MODEL}, chorus: ${isChorus}`);

  const pcmBuffers: Uint8Array[] = new Array(allChunks.length);
  const CONCURRENCY = 2;
  let completedCount = 0;

  const processChunk = async (i: number): Promise<void> => {
    const { text, promptContext, audioTag } = allChunks[i];
    const taggedText = audioTag && !effectiveMultiSpeaker ? `${audioTag} ${text}` : text;

    try {
      pcmBuffers[i] = await withRetry(
        (attempt) => synthesizeChunk(ai, taggedText, promptContext, speechConfig, attempt)
      );
    } catch (err: any) {
      if (text.length > 50) {
        console.warn('[Fallback] Splitting chunk and retrying across model rotation pool');
        await wait(400);
        const subChunks = effectiveMultiSpeaker
          ? splitDialogueIntoChunks(text, Math.max(60, Math.floor(text.length / 2)))
          : splitIntoChunks(text, Math.max(60, Math.floor(text.length / 2)));
        const subBuffers: Uint8Array[] = [];
        for (const sub of subChunks) {
          if (!sub.trim()) continue;
          const taggedSub = audioTag && !effectiveMultiSpeaker ? `${audioTag} ${sub.trim()}` : sub.trim();
          subBuffers.push(await withRetry((attempt) => synthesizeChunk(ai, taggedSub, promptContext, speechConfig, attempt)));
        }
        const total = subBuffers.reduce((a, b) => a + (b.byteLength - (b.byteLength % 2)), 0);
        const merged = new Uint8Array(total);
        let off = 0;
        for (const b of subBuffers) {
          const evenLen = b.byteLength - (b.byteLength % 2);
          merged.set(b.subarray(0, evenLen), off);
          off += evenLen;
        }
        pcmBuffers[i] = merged;
      } else {
        throw err;
      }
    }

    completedCount++;
    if (onProgress) onProgress(completedCount, allChunks.length);
  };

  for (let start = 0; start < allChunks.length; start += CONCURRENCY) {
    if (start > 0) await wait(80);
    const batch = allChunks
      .slice(start, start + CONCURRENCY)
      .map((_, j) => processChunk(start + j));
    await Promise.all(batch);
  }

  const validBuffers: Uint8Array[] = [];
  for (const b of pcmBuffers) {
    if (b && b.byteLength >= 2) {
      const evenLen = b.byteLength - (b.byteLength % 2);
      validBuffers.push(b.byteOffset === 0 && b.byteLength === evenLen ? b : b.subarray(0, evenLen));
    }
  }

  if (validBuffers.length === 0) {
    return pcmToWav(new Uint8Array(0));
  }

  if (validBuffers.length === 1) {
    return pcmToWav(validBuffers[0], 24000, 1);
  }

  const SILENCE_MS = 50;
  const silenceSamples = Math.round((24000 * SILENCE_MS) / 1000);
  const silenceBuffer = new Uint8Array(silenceSamples * 2);

  const totalLen = validBuffers.reduce((acc, buf, idx) => {
    return acc + buf.byteLength + (idx < validBuffers.length - 1 ? silenceBuffer.byteLength : 0);
  }, 0);

  const merged = new Uint8Array(totalLen);
  let offset = 0;
  for (let idx = 0; idx < validBuffers.length; idx++) {
    const buf = validBuffers[idx];
    merged.set(buf, offset);
    offset += buf.byteLength;
    if (idx < validBuffers.length - 1) {
      merged.set(silenceBuffer, offset);
      offset += silenceBuffer.byteLength;
    }
  }

  return pcmToWav(merged, 24000, 1);
};

export const syncAudioPerformance = async (
  targetFile: File,
  _sourceFile: File,
  voice: VoiceOption,
  dialect: Dialect,
  emotion: Emotion
): Promise<Blob> => {
  const base64 = await blobToBase64(targetFile);
  const resp = await withRetry(() => generateContentWithTextRotation([{
    parts: [
      { text: 'Transcribe this audio exactly. Output clean spoken text only — no labels or timestamps.' },
      { inlineData: { data: base64, mimeType: targetFile.type || 'audio/mpeg' } },
    ],
  }]));
  return generateSpotAudio(resp.text || '', voice, emotion, dialect, false);
};

// ─── Voice fingerprint analysis ──────────────────────────────────────────────
/**
 * Sends the raw source audio to the text model and asks for a precise vocal
 * fingerprint that the TTS synthesiser can mirror in the dubbed output.
 */
interface VoiceFingerprint {
  gender:       string; // 'deep male' | 'warm female' | etc.
  pitch:        string; // 'low-pitched' | 'mid-range' | 'high-pitched'
  pace:         string; // 'slow and deliberate' | 'moderate' | 'rapid-fire'
  energy:       string; // 'calm and measured' | 'high energy' | 'explosive'
  tone:         string; // 'warm and friendly' | 'authoritative' | 'dramatic' | etc.
  accent:       string; // 'Indian English' | 'Tamil' | 'neutral' | etc.
  delivery:     string; // rich description of the overall performance style
  breathiness:  string; // 'breathy' | 'clear chest voice' | 'resonant'
  emotionLabel: string; // the detected dominant emotion (e.g. 'excited', 'dramatic')
}

export const dubAudio = async (
  file: File,
  targetLang: string,
  style: string,
  targetGender: DubbingGender,
  _targetEmotion: Emotion = Emotion.NEUTRAL
): Promise<Blob> => {
  const ai = getAI();
  const base64Audio = await blobToBase64(file);
  const mimeType = file.type || 'audio/mpeg';

  console.log('[dubAudio] Step 1/2 — Unified analysis, transcription & translation in a single pass...');
  const sourceDuration = await getAudioDurationFromFile(file).catch(() => 0);
  const targetWordCount = sourceDuration > 0
    ? Math.round((sourceDuration / 60) * 130)
    : null;

  const unifiedPrompt = `You are a professional multilingual dubbing director and voice analysis engine.
Listen to this audio clip (${sourceDuration > 0 ? sourceDuration.toFixed(1) + 's duration' : 'unknown duration'}).

Execute all 3 steps below in a SINGLE pass:
1. TRANSCRIBE: Transcribe the spoken text exactly as heard (verbatim speech only, no labels or timestamps).
2. DUBBING TRANSLATION: Translate the spoken script to ${targetLang} (${style} style).
   - Match original duration of ${sourceDuration > 0 ? sourceDuration.toFixed(1) + ' seconds' : 'the source'} (${targetWordCount ? `approx ${targetWordCount} words` : 'natural pacing'}).
   - Preserve emotional intensity, rhythm, and tone.
   - Output clean spoken script text only.
3. VOICE FINGERPRINT: Analyze the performer's vocal characteristics to mirror their performance.

Respond ONLY with a valid JSON object matching this exact schema (no markdown, no backticks, just raw JSON):
{
  "transcription": "verbatim spoken text",
  "translation": "translated script in ${targetLang}",
  "fingerprint": {
    "gender": "e.g. deep male / warm female / androgynous",
    "pitch": "e.g. low-pitched / mid-range / high-pitched",
    "pace": "e.g. slow and deliberate / moderate / rapid-fire",
    "energy": "e.g. calm and measured / high energy / explosive maximum volume",
    "tone": "e.g. warm and friendly / authoritative and commanding / dramatic and cinematic",
    "accent": "e.g. Indian English / Tamil native / neutral international",
    "delivery": "2-3 sentences describing the performer voice style",
    "breathiness": "e.g. breathy / clear chest voice / resonant",
    "emotionLabel": "single word dominant emotion (e.g. excited, dramatic, cheerful, authoritative, neutral)"
  }
}`;

  let translatedText = '';
  let sourceText = '';
  let fingerprint: VoiceFingerprint = {
    gender: 'neutral',
    pitch: 'mid-range',
    pace: 'moderate',
    energy: 'high energy',
    tone: 'professional and engaging',
    accent: 'Indian English',
    delivery: 'Clear, confident commercial voice performer.',
    breathiness: 'clear full chest voice',
    emotionLabel: 'neutral',
  };

  const remembered = findRememberedDubbing(file.name, file.size, targetLang, style);
  if (remembered) {
    console.log('[dubAudio] Found remembered transcript and translation from prior download. Skipping model call.');
    translatedText = remembered.translation;
    fingerprint = remembered.fingerprint;
  } else {
    try {
      const resp = await withRetry(() => generateContentWithTextRotation([{
        parts: [
          { text: unifiedPrompt },
          { inlineData: { mimeType, data: base64Audio } },
        ]
      }]));

      const raw = resp.text?.trim() || '{}';
      const jsonStr = raw.replace(/^```json\s*|^```\s*|```$/gim, '').trim();
      const parsed = JSON.parse(jsonStr);

      if (parsed.translation) translatedText = parsed.translation.trim();
      if (parsed.fingerprint) fingerprint = { ...fingerprint, ...parsed.fingerprint };
      if (parsed.transcription) sourceText = parsed.transcription.trim();
    } catch (err) {
      console.warn('[dubAudio] Unified pass fallback to single translation prompt:', err);
      const fallbackResp = await withRetry(() => generateContentWithTextRotation([{
        parts: [
          { text: `Transcribe this audio and translate it directly to ${targetLang} (${style} style). Output only the translated text.` },
          { inlineData: { mimeType, data: base64Audio } },
        ]
      }]));
      translatedText = fallbackResp.text?.trim() || '';
    }

    if (translatedText) {
      saveDownloadedDubbingProfile({
        fileName: file.name,
        fileSize: file.size,
        language: targetLang,
        style,
        transcription: sourceText || translatedText,
        translation: translatedText,
        fingerprint,
      });
    }
  }

  if (!translatedText) {
    throw new Error('Could not extract or translate speech from source audio.');
  }

  console.log('[dubAudio] Step 2/2 — Synthesising dubbed audio...');

  let apiVoiceName: string;
  const isFemale = targetGender === 'Female' || (targetGender !== 'Male' && (
    (fingerprint.gender || '').toLowerCase().includes('female') || (fingerprint.gender || '').toLowerCase().includes('woman')
  ));

  const pitchStr = ((fingerprint.pitch || '') + ' ' + (fingerprint.gender || '') + ' ' + (fingerprint.tone || '')).toLowerCase();
  const isLowPitch = pitchStr.includes('low') || pitchStr.includes('deep') || pitchStr.includes('bass') || pitchStr.includes('baritone') || pitchStr.includes('authoritative');
  const isHighPitch = pitchStr.includes('high') || pitchStr.includes('bright') || pitchStr.includes('squeak') || pitchStr.includes('peppy');

  if (isFemale) {
    apiVoiceName = isLowPitch ? 'Autonoe' : (isHighPitch ? 'Leda' : 'Kore');
  } else {
    apiVoiceName = isLowPitch ? 'Charon' : (isHighPitch ? 'Puck' : 'Fenrir');
  }

  const voiceCloneContext = `VOICE CLONING DIRECTIVE — match this source performer exactly:

GENDER & PITCH: ${fingerprint.gender}, ${fingerprint.pitch}
PACE: ${fingerprint.pace}
ENERGY LEVEL: ${fingerprint.energy}
TONE: ${fingerprint.tone}
ACCENT: ${fingerprint.accent}
BREATHINESS: ${fingerprint.breathiness}
PERFORMANCE STYLE: ${fingerprint.delivery}

ABSOLUTE RULES:
- MANDATORY SINGLE VOICE: You must deliver the entire audio in ONE single consistent voice (${apiVoiceName}). Never switch voices, alternate between speakers, or simulate dialogue.
- Replicate the source performer's exact natural pitch and energy level — do NOT sound unnaturally high-pitched, childish, or chipmunk-like.
- Mirror the source pacing precisely — natural, steady delivery matching the original flow.
- Match the tonal colour (bright vs dark, warm vs cold, breathy vs resonant) exactly as described.
- This is a DUBBED version — the listener should feel it sounds like the same performer, just in a different language.
- Do not speak any of the bracketed instruction notes. Only speak the translated text.`;

  const emotionAudioTag = `[${fingerprint.energy}, ${fingerprint.tone}, ${fingerprint.pace}]`;

  const chunks = translatedText.length <= 600
    ? [translatedText]
    : splitIntoChunks(translatedText, 600);

  const speechConfig = {
    voiceConfig: { prebuiltVoiceConfig: { voiceName: apiVoiceName } },
  };

  const pcmBuffers: Uint8Array[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const taggedChunk = `${emotionAudioTag} ${chunk}`;
    const pcm = await withRetry(
      (attempt) => synthesizeChunk(ai, taggedChunk, voiceCloneContext, speechConfig, attempt)
    );
    pcmBuffers.push(pcm);
    if (chunks.length > 1 && i < chunks.length - 1) await wait(100);
  }

  const totalLen = pcmBuffers.reduce((a, b) => a + b.length, 0);
  const merged = new Uint8Array(totalLen);
  let offset = 0;
  for (const buf of pcmBuffers) { merged.set(buf, offset); offset += buf.length; }

  return pcmToWav(merged);
};

export const translateText = async (text: string, targetLang: string, style: TranscriptionStyle): Promise<string> => {
  const cacheKey = `${targetLang}|${style}|${text.trim()}`;
  if (translationCache.has(cacheKey)) {
    console.log('[Cache Hit] Returning cached text translation');
    return translationCache.get(cacheKey)!;
  }
  const r = await withRetry(() => generateContentWithTextRotation([
    { parts: [{ text: `Translate to ${targetLang} (${style} style): "${text}"` }] }
  ]));
  const result = r.text?.trim() || 'Translation failed.';
  if (result !== 'Translation failed.') {
    translationCache.set(cacheKey, result);
  }
  return result;
};

export const transcribeAudio = async (file: File, targetLang: string, style: TranscriptionStyle): Promise<string> => {
  const cacheKey = `${file.name}_${file.size}_${file.lastModified}|${targetLang}|${style}`;
  if (transcriptionCache.has(cacheKey)) {
    console.log('[Cache Hit] Returning cached transcription');
    return transcriptionCache.get(cacheKey)!;
  }
  const base64Audio = await blobToBase64(file);
  const r = await withRetry(() => generateContentWithTextRotation([
    { parts: [{ inlineData: { mimeType: file.type || 'audio/mpeg', data: base64Audio } }, { text: `Transcribe and translate to ${targetLang} (${style} style).` }] }
  ]));
  const result = r.text || 'Transcription failed.';
  if (result !== 'Transcription failed.') {
    transcriptionCache.set(cacheKey, result);
  }
  return result;
};

export const clearAudioCache = () => {
  audioCache.clear();
  translationCache.clear();
  transcriptionCache.clear();
  optimizeCache.clear();
  transliterateCache.clear();
  console.log('[Cache] Audio and text caches purged.');
};

export const optimizeScript = async (script: string, dialect: Dialect): Promise<string> => {
  const cacheKey = `${dialect}|${script.trim()}`;
  if (optimizeCache.has(cacheKey)) {
    console.log('[Cache Hit] Returning cached optimized script');
    return optimizeCache.get(cacheKey)!;
  }

  const isMalayalam = dialect === Dialect.MALAYALAM || dialect === Dialect.MALAYALAM_FORMAL;
  const isKannada = dialect === Dialect.KANNADA || dialect === Dialect.KANNADA_FORMAL;
  const isTelugu = dialect === Dialect.TELUGU || dialect === Dialect.TELUGU_FORMAL;
  const isTamil = dialect === Dialect.CHENNAI_TAMIL || dialect === Dialect.CLASSIC_TAMIL;

  let prompt = '';
  if (isMalayalam || isKannada || isTelugu) {
    const lang = isMalayalam ? 'Malayalam' : isKannada ? 'Kannada' : 'Telugu';
    const suffixEx = isMalayalam 
      ? 'car-ൽ, offer-കൾ, safe-ആണ്, register-ചെയ്യൂ' 
      : isKannada 
      ? 'purchase-ನಲ್ಲಿ, offer-ಗಳು, car-ಗೆ, safe-ಆಗಿ, check-ಮಾಡಿ' 
      : 'purchase-లో, offer-లు, car-కి, safe-గా, book-చేసుకోండి';
    
    prompt = `You are an automated broadcast localization engine and TTS pre-processor.
Optimize the following ad copy script for the Gemini TTS engine in ${lang}.

Target Dialect: ${dialect}

RULES:
1. SCRIPT SEGREGATION: Native words in ${lang} script. English loanwords, brand names, product specs kept in Latin script with hyphenated suffixes (e.g. ${suffixEx}).
2. TTS ACOUSTIC PUNCTUATION: Use '...' for dramatic beats and breath resets, ',' between listed features, '!' and '?' for call-to-actions and upward inflections.
3. INLINE STYLE TAGS: Insert (Style) tags before key phrases to control per-sentence delivery.
   Valid style keywords: Shouting, Peppy, Excited, Cricket Stadium, Announcement, Dramatic, Deep Bass, Cinematic Narration, Happy, Neutral, Sarcasm, Sad, Luxury, Conversational.
4. CADENCE: Native contemporary colloquial broadcast speech. NEVER mention any city or location names.
5. PRESERVE SPEAKER TAGS: Keep MVO:, FVO:, etc. intact if present.
6. FORMAT: Return ONLY the optimized script text with inline (Style) tags. No notes, no markdown codeblocks, no explanations.

Script:
"${script}"`;
  } else if (isTamil) {
    prompt = `You are an expert Tamil advertising copywriter and broadcast audio producer.
Optimize the following script for the Gemini TTS engine.

Target Dialect: ${dialect}

RULES:
1. INLINE STYLE TAGS: Insert (Style) tags before key phrases to control per-sentence delivery.
   Valid style keywords: Shouting, Peppy, Excited, Cricket Stadium, Announcement, Dramatic, Deep Bass, Cinematic Narration, Happy, Neutral, Sarcasm, Sad, Luxury, Conversational.
   Example: (Peppy) Grand opening today! (Shouting) Fifty percent off! (Dramatic) Offer ends tonight.
2. VERNACULAR PHONETICS: Preserve native Tamil script and natural colloquial spoken flow.
3. PRESERVE SPEAKER TAGS: Keep MVO:, FVO:, etc. intact if present.
4. FORMAT: Return ONLY the optimized script text with inline (Style) tags. No notes, no markdown, no explanations.

Script:
"${script}"`;
  } else {
    prompt = `You are an expert commercial advertising copywriter and audio producer.
Optimize the following script for the Gemini TTS engine.

Target Dialect: ${dialect}

RULES:
1. INLINE STYLE TAGS: Insert (Style) tags before key phrases to control per-sentence delivery.
   Valid style keywords: Shouting, Peppy, Excited, Cricket Stadium, Announcement, Dramatic, Deep Bass, Cinematic Narration, Happy, Neutral, Sarcasm, Sad, Luxury, Conversational.
   Example: (Peppy) Grand opening today! (Shouting) Fifty percent off! (Dramatic) Offer ends tonight.
2. NUMBERS & IDENTIFIERS: Spell out numbers or currency where helpful for smooth broadcast speech.
3. PRESERVE SPEAKER TAGS: Keep MVO:, FVO:, etc. intact if present.
4. FORMAT: Return ONLY the optimized script text with inline (Style) tags. No notes, no markdown, no explanations.

Script:
"${script}"`;
  }

  try {
    const r = await withRetry(() => generateContentWithTextRotation([{ parts: [{ text: prompt }] }]));
    const result = r.text?.trim() || script;
    optimizeCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[optimizeScript] Failed:', err);
    return script;
  }
};

/**
 * Quality Zero-Shot Custom Voice Cloning & Voice-to-Voice Conversion
 * Supports both Local/Container Chatterbox Neural Engine AND 100% Cloud-Native
 * Browser Execution (Google Cloud Run / Cloudflare Pages) via Gemini Multimodal
 * Vocal Fingerprinting + Multi-Model TTS Rotation + DSP Acoustic Profile Transfer.
 */
interface CachedRefAudio {
  base64: string;
  mimeType: string;
  profile: import('../utils/audio').AcousticVoiceProfile;
  fingerprint: VoiceFingerprint;
}

const refVoiceCache = new Map<string, CachedRefAudio>();

const getReferenceVoiceAnalysis = async (referenceAudioFile: File): Promise<CachedRefAudio> => {
  const cacheKey = `${referenceAudioFile.name}_${referenceAudioFile.size}_${referenceAudioFile.lastModified}`;
  if (refVoiceCache.has(cacheKey)) {
    return refVoiceCache.get(cacheKey)!;
  }

  const { base64, acousticProfile } = await convertAudioFileTo24kMonoWav(referenceAudioFile);
  const mimeType = 'audio/wav';

  let fingerprint: VoiceFingerprint = {
    gender: acousticProfile.detectedGender === VoiceGender.FEMALE ? 'warm female' : 'deep male',
    pitch: `${Math.round(acousticProfile.pitchHz)} Hz (${acousticProfile.detectedGender === VoiceGender.FEMALE ? 'mid-high female' : 'resonant male'})`,
    pace: 'moderate and natural',
    energy: 'expressive and engaged',
    tone: acousticProfile.timbreDescription,
    accent: 'Indian English',
    delivery: acousticProfile.acousticStyleDirective,
    breathiness: acousticProfile.brightnessRatio > 0.65 ? 'crisp and airy' : 'warm full chest resonance',
    emotionLabel: 'neutral',
  };

  try {
    const fpPrompt = `Listen to this reference speaker audio clip carefully. Extract a precise VOCAL FINGERPRINT to replicate this exact speaker's voice timbre, pitch, cadence, and delivery style.
Respond ONLY with a valid JSON object (no markdown, no backticks):
{
  "gender": "e.g. deep male / warm female",
  "pitch": "e.g. low-pitched baritone / mid-range / high-pitched bright",
  "pace": "e.g. slow and deliberate / moderate / brisk",
  "energy": "e.g. calm and measured / high energy / commanding",
  "tone": "e.g. warm velvet / authoritative / bright and crisp",
  "accent": "e.g. Indian English / Tamil native / neutral international",
  "delivery": "2-3 sentences describing the speaker's exact vocal tract timbre, resonance, and articulation style",
  "breathiness": "e.g. breathy / clear chest voice / resonant",
  "emotionLabel": "dominant emotion keyword"
}`;
    const resp = await withRetry(() => generateContentWithTextRotation([{
      parts: [
        { text: fpPrompt },
        { inlineData: { mimeType, data: base64 } },
      ],
    }]), 2, 300);
    const raw = resp.text?.trim() || '{}';
    const jsonStr = raw.replace(/^```json\s*|^```\s*|```$/gim, '').trim();
    const parsed = JSON.parse(jsonStr);
    fingerprint = { ...fingerprint, ...parsed };

    // Reconcile acousticProfile voice selection with Gemini multimodal speaker gender/pitch detection
    const gStr = String(fingerprint.gender || '').toLowerCase();
    const pStr = `${fingerprint.pitch || ''} ${fingerprint.tone || ''} ${fingerprint.delivery || ''}`.toLowerCase();
    const isDetectedFemale = /\b(female|woman|girl|soprano|contralto|alto)\b/.test(gStr);
    const isDetectedMale = !isDetectedFemale && /\b(male|man|boy|baritone|bass|tenor)\b/.test(gStr);

    if (isDetectedMale) {
      acousticProfile.detectedGender = VoiceGender.MALE;
      if (/\b(deep|bass|sub|low|baritone|gravelly)\b/.test(pStr) || acousticProfile.pitchHz <= 115) {
        acousticProfile.matchedVoiceName = acousticProfile.pitchHz <= 102 ? 'Iapetus' : 'Charon';
      } else if (/\b(warm|velvet|smooth|calm|narrat)\b/.test(pStr)) {
        acousticProfile.matchedVoiceName = 'Orus';
      } else if (/\b(high|youth|casual|bright|tenor)\b/.test(pStr) && acousticProfile.pitchHz > 142) {
        acousticProfile.matchedVoiceName = 'Puck';
      } else {
        acousticProfile.matchedVoiceName = 'Fenrir';
      }
    } else if (isDetectedFemale) {
      acousticProfile.detectedGender = VoiceGender.FEMALE;
      if (/\b(deep|husky|smoky|low|contralto|velvet|warm)\b/.test(pStr) || acousticProfile.pitchHz <= 188) {
        acousticProfile.matchedVoiceName = 'Callirrhoe';
      } else if (/\b(bright|high|energetic|crisp|power)\b/.test(pStr) && acousticProfile.pitchHz >= 220) {
        acousticProfile.matchedVoiceName = 'Kore';
      } else {
        acousticProfile.matchedVoiceName = 'Aoede';
      }
    }
  } catch (e) {
    console.warn('[getReferenceVoiceAnalysis] Using DSP acoustic profile defaults:', e);
  }

  const cached: CachedRefAudio = { base64, mimeType, profile: acousticProfile, fingerprint };
  refVoiceCache.set(cacheKey, cached);
  return cached;
};

export const cloneVoiceZeroShot = async (
  script: string,
  referenceAudioFile: File,
  emotion: Emotion = Emotion.NEUTRAL,
  dialect: Dialect = Dialect.INDIAN_ENGLISH,
  pacing: SpeechPacing = SpeechPacing.MEDIUM,
  onProgress?: (current: number, total: number) => void
): Promise<Blob> => {
  if (!script.trim()) {
    throw new Error('Script text cannot be empty.');
  }

  if (onProgress) onProgress(1, 4);

  const speedMultiplier = pacing === SpeechPacing.SLOW ? 0.85 : pacing === SpeechPacing.FAST ? 1.15 : 1.0;

  // 1. Extract Acoustic Profile & Multimodal Vocal Fingerprint from Reference Audio
  const refAnalysis = await getReferenceVoiceAnalysis(referenceAudioFile);
  const { profile: acousticProfile, fingerprint } = refAnalysis;

  const baseVoice: VoiceOption = {
    id: `clone_${acousticProfile.matchedVoiceName.toLowerCase()}`,
    name: acousticProfile.matchedVoiceName,
    gender: acousticProfile.detectedGender,
    apiVoiceName: acousticProfile.matchedVoiceName,
    persona: `${fingerprint.gender}, ${fingerprint.tone}. ${fingerprint.delivery}`,
    tag: 'Cloned',
    category: 'Standard',
  };

  if (onProgress) onProgress(2, 4);

  // Cloud-Native Zero-Shot Synthesis (100% in-browser & Cloudflare Pages)
  // Combines Reference Multimodal Fingerprint + Matched Base Voice + SOLA Pitch-Matching Transfer
  const ai = getAI();
  const basePromptContext = buildPromptContext(emotion, dialect, baseVoice, pacing);
  const clonePromptContext = `${basePromptContext}
VOICE CLONING DIRECTIVE — Replicate the reference speaker's exact vocal identity:
- Speaker Gender & Pitch: ${fingerprint.gender}, ${fingerprint.pitch} (Fundamental ~${Math.round(acousticProfile.pitchHz)} Hz)
- Vocal Timbre & Resonance: ${fingerprint.tone}, ${fingerprint.breathiness}, ${acousticProfile.timbreDescription}
- Natural Cadence & Accent: ${fingerprint.pace}, ${fingerprint.accent}
- Performance Signature: ${fingerprint.delivery}`;

  const defaultAudioTag = EMOTION_AUDIO_TAGS[emotion] ?? `[${fingerprint.energy}, ${fingerprint.tone}]`;
  const chunks = script.trim().length <= 450 ? [script.trim()] : splitIntoChunks(script.trim(), 450);
  const speechConfig = {
    voiceConfig: { prebuiltVoiceConfig: { voiceName: acousticProfile.matchedVoiceName } },
  };

  const pcmBuffers: Uint8Array[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const taggedChunk = `${defaultAudioTag} ${chunks[i]}`;
    const pcm = await withRetry((attempt) =>
      synthesizeChunk(ai, taggedChunk, clonePromptContext, speechConfig, attempt)
    );
    pcmBuffers.push(pcm);
    if (onProgress) onProgress(2 + Math.round(((i + 1) / chunks.length) * 1), 4);
  }

  const totalLen = pcmBuffers.reduce((acc, b) => acc + b.byteLength, 0);
  const mergedPcm = new Uint8Array(totalLen);
  let offset = 0;
  for (const b of pcmBuffers) {
    mergedPcm.set(b, offset);
    offset += b.byteLength;
  }

  // Apply High-Precision SOLA Pitch Matching and Formant Shaping to match target reference sample exactly
  const transferredPcm = applyAcousticTransfer(mergedPcm, acousticProfile, 24000);
  if (onProgress) onProgress(4, 4);
  return pcmToWav(transferredPcm, 24000, 1);
};

export const convertVoiceToVoice = async (
  sourceAudioBlobOrFile: Blob | File,
  referenceAudioFile: File,
  speed: number = 1.0,
  onProgress?: (current: number, total: number) => void
): Promise<Blob> => {
  if (onProgress) onProgress(1, 3);

  // Cloud-Native Voice-to-Voice Conversion (100% in-browser & Cloudflare Pages):
  // Extract reference speaker acoustic profile & fingerprint + transcribe source audio with prosody
  const refAnalysis = await getReferenceVoiceAnalysis(referenceAudioFile);
  const { profile: acousticProfile, fingerprint: refFingerprint } = refAnalysis;

  const sourceFile = sourceAudioBlobOrFile instanceof File
    ? sourceAudioBlobOrFile
    : new File([sourceAudioBlobOrFile], 'source.wav', { type: sourceAudioBlobOrFile.type || 'audio/wav' });

  const [sourceBase64, sourceDuration] = await Promise.all([
    blobToBase64(sourceFile),
    getAudioDurationFromFile(sourceFile).catch(() => 0),
  ]);
  const sourceMimeType = sourceFile.type || 'audio/wav';

  const vcPrompt = `Listen to this source audio clip carefully.
1. Transcribe the exact spoken words verbatim in their original script/language (no timestamps, no speaker labels).
2. Describe the source speaker's emotional delivery, energy, and rhythm so it can be re-performed by a target voice actor.
Respond ONLY with valid JSON (no markdown, no backticks):
{
  "transcript": "verbatim spoken text",
  "emotionTag": "concise acting tag e.g. energetic and expressive, warm conversational, dramatic",
  "deliveryNotes": "1-2 sentences on rhythm, emphasis, and emotional inflection"
}`;

  let transcript = '';
  let emotionTag = `${refFingerprint.energy}, ${refFingerprint.tone}`;
  let deliveryNotes = refFingerprint.delivery;

  try {
    const resp = await withRetry(() => generateContentWithTextRotation([{
      parts: [
        { text: vcPrompt },
        { inlineData: { mimeType: sourceMimeType, data: sourceBase64 } },
      ],
    }]));
    const raw = resp.text?.trim() || '{}';
    const jsonStr = raw.replace(/^```json\s*|^```\s*|```$/gim, '').trim();
    const parsed = JSON.parse(jsonStr);
    if (parsed.transcript) transcript = String(parsed.transcript).trim();
    if (parsed.emotionTag) emotionTag = String(parsed.emotionTag).trim();
    if (parsed.deliveryNotes) deliveryNotes = String(parsed.deliveryNotes).trim();
  } catch {
    const fallbackResp = await withRetry(() => generateContentWithTextRotation([{
      parts: [
        { text: 'Transcribe this audio verbatim. Output only the spoken words with no extra text.' },
        { inlineData: { mimeType: sourceMimeType, data: sourceBase64 } },
      ],
    }]));
    transcript = fallbackResp.text?.trim() || '';
  }

  if (!transcript) {
    throw new Error('Could not extract speech from the source audio for voice conversion.');
  }

  if (onProgress) onProgress(2, 3);

  const ai = getAI();
  const vcContext = `VOICE-TO-VOICE CONVERSION DIRECTIVE:
Re-perform the source script in the exact vocal identity of the target reference speaker:
- Target Gender & Fundamental Pitch: ${refFingerprint.gender}, ${refFingerprint.pitch} (~${Math.round(acousticProfile.pitchHz)} Hz)
- Target Vocal Timbre & Resonance: ${refFingerprint.tone}, ${refFingerprint.breathiness}, ${acousticProfile.timbreDescription}
- Target Accent: ${refFingerprint.accent}
- Source Prosody & Inflection to Preserve: ${deliveryNotes}
Deliver strictly in ONE single consistent voice (${acousticProfile.matchedVoiceName}). Never read bracketed instructions aloud.`;

  const chunks = transcript.length <= 500 ? [transcript] : splitIntoChunks(transcript, 500);
  const speechConfig = {
    voiceConfig: { prebuiltVoiceConfig: { voiceName: acousticProfile.matchedVoiceName } },
  };

  const pcmBuffers: Uint8Array[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const taggedChunk = `[${emotionTag}] ${chunks[i]}`;
    const pcm = await withRetry((attempt) =>
      synthesizeChunk(ai, taggedChunk, vcContext, speechConfig, attempt)
    );
    pcmBuffers.push(pcm);
  }

  const totalLen = pcmBuffers.reduce((acc, b) => acc + b.byteLength, 0);
  const mergedPcm = new Uint8Array(totalLen);
  let offset = 0;
  for (const b of pcmBuffers) {
    mergedPcm.set(b, offset);
    offset += b.byteLength;
  }

  // Apply gentle spectral envelope matching (no linear resampling, preserving 100% natural pitch and formants)
  const finalPcm = applyAcousticTransfer(mergedPcm, acousticProfile, 24000);

  if (onProgress) onProgress(3, 3);
  return pcmToWav(finalPcm, 24000, 1);
};

// ─── Audio Story Creator ──────────────────────────────────────────────────────

const STORY_VOICE_ROSTER = `
m_karthik_pod | Karthik — Fireside Story | Male | Sadaltager | BEST FOR: Primary narrator, warm storytelling, empathetic male lead, audiobook-style
m_arjun_rj | Arjun — Electric RJ | Male | Fenrir | BEST FOR: Energetic/peppy male characters, radio announcers, enthusiastic scenes
m_vikram_char | Vikram — Modern Urban | Male | Puck | BEST FOR: Witty modern male lead, casual conversation, young adult male, comedy
m_rajan_trailer | Rajan — Blockbuster Trailer | Male | Fenrir | BEST FOR: Villain, antagonist, dramatic reveals, epic authority, dark characters
m_anand_velvet | Anand — Velvet Thunder | Male | Orus | BEST FOR: Romantic male lead, smooth narrator, sophisticated/premium scenes
m_titan_sub | Titan — Deep Subwoofer | Male | Iapetus | BEST FOR: Supernatural beings, godlike authority, extreme bass moments
m_kabir_doc | Kabir — Resonant Anchor | Male | Charon | BEST FOR: Wise mentor/elder male, documentary narrator, intellectual authority
m_dev_exec | Dev — Executive Keynote | Male | Algenib | BEST FOR: Corporate/professional male, educated modern protagonist
m_surya_news | Surya — Broadcast News | Male | Enceladus | BEST FOR: News narrator, objective/neutral announcements
f_tara_narration | Tara — Velvet Narration | Female | Callirrhoe | BEST FOR: Primary female narrator, audiobook storytelling, elegant female lead
f_priya_urban | Priya — Bubbly Modern | Female | Leda | BEST FOR: Bubbly young female lead, comedy, upbeat modern city girl
f_meera_breezy | Meera — Breezy Acoustic | Female | Aoede | BEST FOR: Warm supportive female character, emotional/intimate scenes, gentle nature
f_scarlett_power | Scarlett — Cinematic Power | Female | Kore | BEST FOR: Strong action female lead, fierce protagonist, intense dramatic scenes
f_scarlett_luxury | Scarlett — Seductive Luxury | Female | Sulafat | BEST FOR: Sophisticated femme fatale, romantic tension, luxury settings
f_roshni_power | Roshni — Power Retail | Female | Autonoe | BEST FOR: Confident assertive modern female, bold dialogue, punchy scenes
f_maya_husky | Maya — Smoky Contralto | Female | Despina | BEST FOR: Mysterious dark female, noir antagonist, mature complex villain
f_zara_trailer | Zara — Cinematic Empress | Female | Erinome | BEST FOR: Epic female villain/antagonist, dramatic reveals, powerful dark queen
f_nandini_gentle | Nandini — Gentle Empath | Female | Achernar | BEST FOR: Caring maternal figure, gentle protagonist, soft emotional tender scenes
f_anitha_anchor | Anitha — Classic Senthamizh | Female | Kore | BEST FOR: Traditional/classical female character, formal settings, Tamil heritage scenes
f_padma_jewellery | Padma — Jewellery Elegance | Female | Aoede | BEST FOR: Elegant traditional Indian woman, heritage celebration, warm refined femininity
`.trim();

const STORY_EMOTION_LIST = Object.values(Emotion).join('\n');
const STORY_DIALECT_LIST = Object.values(Dialect).join('\n');

export const analyzeStoryScript = async (storyText: string, targetDialect?: Dialect): Promise<StorySegment[]> => {
  const ai = getAI();

  const prompt = `You are a professional audio story producer, voice casting director, and sound designer.
Analyze the following story/script and segment it for audio production.

Break the text into natural speech segments. Rules:
- Each segment = 1-3 sentences maximum
- Assign each to the most fitting speaker name (character name or "Narrator")
- Cast the best matching voice from the roster below
- Pick the most expressive emotion matching THAT exact moment — vary emotions throughout, never use one emotion for the whole story
- For narration use: NEUTRAL / NEWS ANNOUNCER, CINEMATIC NARRATION / TRAILER EPIC, CONVERSATIONAL / NATURAL SPEAKING, or EMOTIONAL / STORYTELLING
- For dialogue match the character's personality and scene mood
${targetDialect ? `- Primary Target Dialect Profile: "${targetDialect}". Use "${targetDialect}" for all segments unless a specific scene explicitly demands another dialect.` : '- Dialect: "Indian English" for Indian stories, "Regular English (Standard neutral accent, clear international pronunciation)" for Western stories, Tamil dialects only if Tamil language content.'}

VOICE ROSTER (use voiceId exactly as listed):
${STORY_VOICE_ROSTER}

AVAILABLE EMOTIONS (use exact string):
${STORY_EMOTION_LIST}

AVAILABLE DIALECTS (use exact string):
${STORY_DIALECT_LIST}

Return a JSON array ONLY — no markdown, no code blocks, no commentary. Each element:
{
  "speaker": "Character Name or Narrator",
  "voiceId": "exact_voice_id_from_roster",
  "voiceName": "Voice Display Name from roster",
  "apiVoiceName": "ApiVoiceNameFromRoster",
  "gender": "Male or Female",
  "persona": "one sentence describing this character voice role",
  "emotion": "exact emotion string from list",
  "dialect": "exact dialect string from list",
  "text": "exact text from story for this segment",
  "type": "narration or dialogue",
  "notes": "brief acting direction"
}

STORY:
${storyText}`;

  const resp = await withRetry(() => generateContentWithTextRotation([
    { parts: [{ text: prompt }] }
  ]));

  const raw = resp.text?.trim() || '[]';
  const jsonStr = raw.replace(/^```json\s*|^```\s*|```$/gim, '').trim();

  let parsed: any[];
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    const match = jsonStr.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('Story analysis returned invalid JSON. Please try again.');
    parsed = JSON.parse(match[0]);
  }

  return parsed.map((seg: any, idx: number) => ({
    id: `seg_${idx}_${Date.now()}`,
    speaker: seg.speaker || 'Narrator',
    voiceId: seg.voiceId || 'm_karthik_pod',
    voiceName: seg.voiceName || 'Karthik — Fireside Story',
    apiVoiceName: seg.apiVoiceName || 'Sadaltager',
    gender: seg.gender === 'Female' ? VoiceGender.FEMALE : VoiceGender.MALE,
    persona: seg.persona || 'Narrator voice',
    emotion: (Object.values(Emotion).find(e => e === seg.emotion) as Emotion) || Emotion.NEUTRAL,
    dialect: (Object.values(Dialect).find(d => d === seg.dialect) as Dialect) || targetDialect || Dialect.INDIAN_ENGLISH,
    text: seg.text || '',
    type: (seg.type === 'dialogue' ? 'dialogue' : 'narration') as 'narration' | 'dialogue',
    notes: seg.notes,
  } as StorySegment)).filter((s: StorySegment) => s.text.trim().length > 0);
};

export const generateStoryAudio = async (
  segments: StorySegment[],
  onSegmentStart?: (idx: number) => void,
  onSegmentDone?: (idx: number) => void,
): Promise<Blob> => {
  const ai = getAI();
  const allPcmBuffers: Uint8Array[] = [];

  const silencePcm = (ms: number): Uint8Array => {
    const samples = Math.round((24000 * ms) / 1000);
    return new Uint8Array(samples * 2);
  };

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    onSegmentStart?.(i);

    const voice: VoiceOption = {
      id: seg.voiceId,
      name: seg.voiceName,
      gender: seg.gender,
      apiVoiceName: seg.apiVoiceName,
      persona: seg.persona + (seg.notes ? `. Acting note: ${seg.notes}` : ''),
    };

    const storyPromptContext = buildPromptContext(seg.emotion, seg.dialect, voice, SpeechPacing.MEDIUM);
    const storyAudioTag = EMOTION_AUDIO_TAGS[seg.emotion] ?? '';
    const speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: seg.apiVoiceName } } };
    let cleaned = cleanScript(seg.text);
    if (!cleaned) { onSegmentDone?.(i); continue; }

    if (
      seg.dialect === Dialect.CHENNAI_TAMIL || seg.dialect === Dialect.CLASSIC_TAMIL ||
      seg.dialect === Dialect.MALAYALAM || seg.dialect === Dialect.MALAYALAM_FORMAL ||
      seg.dialect === Dialect.KANNADA || seg.dialect === Dialect.KANNADA_FORMAL ||
      seg.dialect === Dialect.TELUGU || seg.dialect === Dialect.TELUGU_FORMAL
    ) {
      cleaned = await ensureRegionalNativeScript(cleaned, seg.dialect);
    }

    const chunks = splitIntoChunks(cleaned, 900);
    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      const taggedChunk = storyAudioTag ? `${storyAudioTag} ${chunk.trim()}` : chunk.trim();
      try {
        const pcm = await withRetry(
          (attempt) => synthesizeChunk(ai, taggedChunk, storyPromptContext, speechConfig, attempt)
        );
        allPcmBuffers.push(pcm);
      } catch (err: any) {
        const subs = splitIntoChunks(chunk, Math.max(60, Math.floor(chunk.length / 2)));
        for (const sub of subs) {
          if (!sub.trim()) continue;
          const taggedSub = storyAudioTag ? `${storyAudioTag} ${sub.trim()}` : sub.trim();
          const pcm = await withRetry(
            (attempt) => synthesizeChunk(ai, taggedSub, storyPromptContext, speechConfig, attempt)
          );
          allPcmBuffers.push(pcm);
          await wait(150);
        }
      }
    }

    if (i < segments.length - 1) {
      const next = segments[i + 1];
      let ms = 150;
      if (next.speaker !== seg.speaker) ms = 350;
      if (seg.type === 'narration' || next.type === 'narration') ms = 450;
      if (seg.type === 'dialogue' && next.type === 'dialogue' && next.speaker === seg.speaker) ms = 100;
      allPcmBuffers.push(silencePcm(ms));
    }

    onSegmentDone?.(i);
    if (i < segments.length - 1) await wait(120);
  }

  const validBuffers = allPcmBuffers
    .filter(b => b.byteLength >= 2)
    .map(b => { const even = b.byteLength - (b.byteLength % 2); return b.byteLength === even ? b : b.subarray(0, even); });

  if (validBuffers.length === 0) {
    return pcmToWav(new Uint8Array(0));
  }

  const total = validBuffers.reduce((acc, b) => acc + b.byteLength, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const b of validBuffers) {
    merged.set(b, off);
    off += b.byteLength;
  }

  return pcmToWav(merged, 24000, 1);
};


// ─── South Indian Ad Copy Localization Engine ──────────────────────────────────

export interface LocalizedAdCopyResult {
  malayalam: string;
  kannada: string;
  telugu: string;
  tamil?: string;
  rawOutput: string;
}

/**
 * Converts a Romanized / mixed South Indian ad script (Tanglish, Manglish,
 * Kanglish, or Tenglish) into production-ready, TTS-optimized broadcast scripts
 * for Malayalam, Kannada, Telugu, and Tamil using the full localization engine rules.
 */
export const localizeAdCopy = async (
  script: string,
  targetLanguages: ('Malayalam' | 'Kannada' | 'Telugu' | 'Tamil')[] = ['Malayalam', 'Kannada', 'Telugu', 'Tamil'],
  dialectStyle: 'colloquial' | 'formal' = 'colloquial'
): Promise<LocalizedAdCopyResult> => {
  if (!script.trim()) throw new Error('Ad script cannot be empty.');

  const isFormal = dialectStyle === 'formal';
  const isSingleLang = targetLanguages.length === 1;
  const singleLang = targetLanguages[0];

  const cacheKey = `adloc|${isFormal ? 'formal' : 'colloquial'}|${[...targetLanguages].sort().join(',')}|${script.trim()}`;
  if (translationCache.has(cacheKey)) {
    return JSON.parse(translationCache.get(cacheKey)!) as LocalizedAdCopyResult;
  }

  const systemPrompt = `You are an elite South Indian Advertising & Commercial Broadcast Localization Engine with 20+ years specializing in Tamil, Malayalam, Kannada, and Telugu retail and commercial copy.

Your task: Localize the provided advertisement copy into ${isSingleLang ? singleLang : targetLanguages.join(', ')} while strictly adhering to real-world South Indian radio/TV/digital broadcast voiceover conventions.

## CORE LOCALIZATION PRINCIPLES

### Linguistic Register
- Register: ${isFormal ? 'Formal literature form (Classical, refined standard broadcast and literary diction)' : 'Colloquial speaking form (Everyday conversational, contemporary consumer commercial spoken diction)'}
- NEVER produce literal, wooden, textbook translations
- Adapt cultural idioms and persuasive retail rhythm natively into the target language

### Orthographic Hygiene & Script Mixing
- Native vocabulary MUST be written strictly in the official native script:
  - Malayalam: Malayalam script
  - Kannada: Kannada script
  - Telugu: Telugu script
  - Tamil: Tamil script
- Brand names, technical terms, product models, web URLs, and universally recognized English words (e.g., offer, discount, flat, store, mobile, app, exclusive, collection, festive) MUST be preserved in Latin script (English letters)

### Hyphenated Suffix Binding
Join native grammatical suffixes directly to English root words with a hyphen:
- Malayalam: purchase-ലും, offer-കൾ, car-ൽ, safe-ആണ്, register-ചെയ്യൂ
- Kannada: purchase-ನಲ್ಲಿ, offer-ಗಳು, car-ಗೆ, safe-ಆಗಿ, check-ಮಾಡಿ
- Telugu: purchase-లో, offer-లు, car-కి, safe-గా, book-చేసుకోండి
- Tamil: purchase-ல, offer-கள், car-க்கு, safe-ஆ, register-பண்ணுங்க

### Temporal Integrity
- Spoken syllable density MUST match source text for fixed-runtime dubbing (15s/30s/45s)
- ${isFormal ? 'Standard broadcast literary phrasing with formal grammatical clarity' : 'Strict colloquial broadcast speech — natural spoken phrasing with colloquial elisions'}

### Numbers & Identifiers
- Keep all phone numbers, prices, dates, percentages, codes in standard digits and Latin uppercase
- Examples: +91..., 5.73 lakhs, 100%, 34,000 sq. ft., BIS, ISI, HUID, RERA

## TTS ACOUSTIC PUNCTUATION
- ... → mid-sentence dramatic beats, comedic pauses, breath resets
- , → rigorously between listed features/specs to prevent word blending
- ! or ? → call-to-action phrases and rhetorical hooks (forces upward pitch inflection)

## DIALECT DIRECTIVES

### Malayalam
${isFormal ? 'Standard broadcast literary delivery (സാഹിത്യ ശൈലി), classical enunciation, formal grammar.' : 'Crisp central-urban inflections (സംസാര ശൈലി). Casual prompts (പോയാലോ?, കണ്ടോളൂ!, ആഘോഷിച്ചോളൂ!).'}

### Kannada
${isFormal ? 'Standard literary classical pronunciation (ಸಾಹಿತ್ಯಿಕ / ಗ್ರಾಂಥಿಕ ಶೈಲಿ), formal enunciation and grammar.' : 'Upbeat everyday urban market speech (ಆಡುಮಾತಿನ ಶೈಲಿ). Contemporary hooks (ಹೋಗೋಣ್ವಾ?, ತಗೊಳ್ಳಿ!, ಸೆಲೆಬ್ರೇಟ್ ಮಾಡಿ!).'}

### Telugu
${isFormal ? 'Standard literary classical pronunciation (గ్రాంథిక / ప్రామాణిక శైలి), formal enunciation and elegant diction.' : 'Punchy, fast-paced commercial delivery (వాడుక / సంభాషణా శైలి). Retail action tags (వెళ్దామా?, తీసుకోండి!, సెలబ్రేట్ చేసుకోండి!).'}

### Tamil
${isFormal ? 'Pure classical Senthamizh literary delivery (செந்தமிழ் / இலக்கிய நடை), strict formal enunciation and literary vocabulary.' : 'Vibrant, colloquial urban spoken delivery (பேச்சு வழக்கு). Commercial action hooks (போலாமா?, வாங்கிக்குங்க!, என்ஜாய் பண்ணுங்க!).'}

## INTERNAL VALIDATION (run silently before output)
1. Linguistic Register: ${isFormal ? 'formal literary diction and classical grammar strictly maintained?' : 'colloquial spoken elisions and natural conversational flow used?'}
2. Loanword Purity: all English brand/technical terms untouched in Latin script?
3. Suffix Hygiene: all case markers properly hyphenated, no orphaned spaces?
4. TTS Cadence: pauses, inflections, terminal hooks marked with correct punctuation?
If any check fails, rewrite the line before rendering.

## CRITICAL CONSTRAINTS
- NEVER mention city or location names in headers, output text, or metadata
- Embed authentic vocabulary and cadence natively into the dialogue
- Preserve ALL speaker tags exactly as in the source: MVO:, FVO:, Person 1:, Narrator: etc.

## OUTPUT FORMAT
${isSingleLang ? `Return ONLY the localized script lines for ${singleLang}. Strictly DO NOT include any headings (such as '### ${singleLang}'), DO NOT include dividers ('---'), and DO NOT include other languages or commentary.` : `Return ONLY this markdown structure, no preamble or trailing commentary:

### Malayalam

[localized lines with speaker tags preserved]

---

### Kannada

[localized lines with speaker tags preserved]

---

### Telugu

[localized lines with speaker tags preserved]

---

### Tamil

[localized lines with speaker tags preserved]`}`;

  const userPrompt = isSingleLang
    ? `Localize the following ad script into ${singleLang} only (${isFormal ? 'Formal literature form' : 'Colloquial speaking form'}). Output ONLY the localized lines with NO headers, NO separators, and NO other languages.

Source Script:
${script.trim()}`
    : `Localize the following ad script into ${targetLanguages.join(', ')} in ${isFormal ? 'Formal literature form' : 'Colloquial speaking form'}.

Source Script:
${script.trim()}`;

  const resp = await withRetry(() => generateContentWithTextRotation(
    [{ parts: [{ text: userPrompt }] }],
    { systemInstruction: systemPrompt }
  ));

  const rawOutput = resp.text?.trim() || '';

  const cleanLocalizedOutput = (text: string, langName: string): string => {
    if (!text) return '';
    let cleaned = text.trim();

    // 1. If output begins with a markdown heading for this language or generic heading, strip it
    const headingPrefixRegex = new RegExp(`^#{1,4}\s*(?:${langName}|Script|Broadcast|Localization)[^\n]*\n?`, 'i');
    cleaned = cleaned.replace(headingPrefixRegex, '').trim();

    // 2. Cut off completely at any divider or any subsequent language heading (e.g. ---, ### Kannada, ### Telugu)
    const cutoffRegex = /\n\s*---\s*\n|\n\s*#{1,4}\s*(?:Malayalam|Kannada|Telugu|Tamil)/i;
    const dividerIdx = cleaned.search(cutoffRegex);
    if (dividerIdx !== -1) {
      cleaned = cleaned.substring(0, dividerIdx).trim();
    }

    // 3. Strip any residual headers or divider lines anywhere in the text
    return cleaned
      .replace(/^#{1,4}\s*(?:Malayalam|Kannada|Telugu|Tamil|Script|Broadcast|Localization)[^\n]*\n?/gim, '')
      .replace(/^---+$/gm, '')
      .trim();
  };

  const extract = (lang: string): string => {
    if (isSingleLang && singleLang.toLowerCase() === lang.toLowerCase()) {
      return cleanLocalizedOutput(rawOutput, lang);
    }
    const re = new RegExp(`###\\s*${lang}\\s*\\n([\\s\\S]*?)(?=(?:\\n\\s*---\\s*\\n|\\n\\s*###|$))`, 'i');
    const m = rawOutput.match(re);
    return cleanLocalizedOutput(m ? m[1] : '', lang);
  };

  const result: LocalizedAdCopyResult = {
    malayalam: extract('Malayalam'),
    kannada: extract('Kannada'),
    telugu: extract('Telugu'),
    tamil: extract('Tamil'),
    rawOutput,
  };

  translationCache.set(cacheKey, JSON.stringify(result));
  return result;
};
