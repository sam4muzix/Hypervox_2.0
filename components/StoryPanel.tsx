import React, { useState, useRef, useCallback } from 'react';
import { StorySegment, Emotion, Dialect, VoiceGender, VoiceOption } from '../types';
import { analyzeStoryScript, generateStoryAudio } from '../services/geminiService';

// Roster of voices for manual adjustment dropdown
const ALL_STORY_VOICES: VoiceOption[] = [
  { id: 'm_karthik_pod', name: 'Karthik — Fireside Story', gender: VoiceGender.MALE, apiVoiceName: 'Sadaltager', persona: 'Warm, empathetic bedside storyteller & podcaster' },
  { id: 'm_arjun_rj', name: 'Arjun — Electric RJ', gender: VoiceGender.MALE, apiVoiceName: 'Fenrir', persona: 'High-energy FM radio jockey & peppy speaker' },
  { id: 'm_vikram_char', name: 'Vikram — Modern Urban', gender: VoiceGender.MALE, apiVoiceName: 'Puck', persona: 'Charismatic, witty, natural conversationalist' },
  { id: 'm_rajan_trailer', name: 'Rajan — Blockbuster Trailer', gender: VoiceGender.MALE, apiVoiceName: 'Fenrir', persona: 'Epic trailer narrator with deep theatrical gravitas' },
  { id: 'm_anand_velvet', name: 'Anand — Velvet Thunder', gender: VoiceGender.MALE, apiVoiceName: 'Orus', persona: 'Ultra-smooth resonant baritone with warm velvet depth' },
  { id: 'm_titan_sub', name: 'Titan — Deep Subwoofer', gender: VoiceGender.MALE, apiVoiceName: 'Iapetus', persona: 'Ultra-low frequency subwoofer bass voice' },
  { id: 'm_kabir_doc', name: 'Kabir — Resonant Anchor', gender: VoiceGender.MALE, apiVoiceName: 'Charon', persona: 'Authoritative intellectual documentary host' },
  { id: 'm_dev_exec', name: 'Dev — Executive Keynote', gender: VoiceGender.MALE, apiVoiceName: 'Algenib', persona: 'Polished tech visionary keynote presenter' },
  { id: 'm_surya_news', name: 'Surya — Broadcast News', gender: VoiceGender.MALE, apiVoiceName: 'Enceladus', persona: 'Razor-sharp broadcast journalist' },
  { id: 'f_tara_narration', name: 'Tara — Velvet Narration', gender: VoiceGender.FEMALE, apiVoiceName: 'Callirrhoe', persona: 'Velvety smooth narrative artist for audiobooks' },
  { id: 'f_priya_urban', name: 'Priya — Bubbly Modern', gender: VoiceGender.FEMALE, apiVoiceName: 'Leda', persona: 'Vibrant, trendy city girl with sparkling youthful energy' },
  { id: 'f_meera_breezy', name: 'Meera — Breezy Acoustic', gender: VoiceGender.FEMALE, apiVoiceName: 'Aoede', persona: 'Soothing lyrical acoustic voice with warm natural presence' },
  { id: 'f_scarlett_power', name: 'Scarlett — Cinematic Power', gender: VoiceGender.FEMALE, apiVoiceName: 'Kore', persona: 'Commanding husky cinematic voice with dynamic projection' },
  { id: 'f_scarlett_luxury', name: 'Scarlett — Seductive Luxury', gender: VoiceGender.FEMALE, apiVoiceName: 'Sulafat', persona: 'Silky, intimate, breathy luxury brand ambassador' },
  { id: 'f_padma_jewellery', name: 'Padma — Jewellery Elegance', gender: VoiceGender.FEMALE, apiVoiceName: 'Aoede', persona: 'Soft, grounded, richly elegant traditional Indian voice' },
  { id: 'f_roshni_power', name: 'Roshni — Power Retail', gender: VoiceGender.FEMALE, apiVoiceName: 'Autonoe', persona: 'Bold, punchy, commanding commercial Diva' },
  { id: 'f_maya_husky', name: 'Maya — Smoky Contralto', gender: VoiceGender.FEMALE, apiVoiceName: 'Despina', persona: 'Deep smoky sultry noir voice' },
  { id: 'f_zara_trailer', name: 'Zara — Cinematic Empress', gender: VoiceGender.FEMALE, apiVoiceName: 'Erinome', persona: 'Commanding theatrical queen with thrilling gravitas' },
  { id: 'f_nandini_gentle', name: 'Nandini — Gentle Empath', gender: VoiceGender.FEMALE, apiVoiceName: 'Achernar', persona: 'Soft, tender, heartfelt storyteller with emotional sincerity' },
  { id: 'f_anitha_anchor', name: 'Anitha — Classic Senthamizh', gender: VoiceGender.FEMALE, apiVoiceName: 'Kore', persona: 'Refined melodic classical Tamil anchor' },
];

const SAMPLE_STORIES = [
  {
    title: 'The Temple of the Golden Sun',
    desc: 'Cinematic mystery with ancient suspense & dual dialogue',
    text: `The dusk settled over the old stone ruins of Thanjavur. A quiet wind whispered through the ancient corridors, carrying the scent of wild jasmine and cold granite.

Archaeologist Vikram ran his fingertips over the carved inscriptions on the sanctum wall.

Vikram: "Tara, look at this. These markings aren't from the Chola period. They're much older. Almost forgotten."

Tara stepped forward, her torchlight cutting sharply through the shadows. Her eyes widened as she deciphered the central glyph.

Tara: "Be careful what you touch, Vikram. The legends say this chamber wasn't built to preserve gold. It was built to seal something away."

A deep, low rumble resonated from underneath the flagstones. The dust on the floor began to tremble.

Vikram: "I don't think we have time to debate folklore anymore. Run!"`,
  },
  {
    title: 'A Mother\'s Heirloom',
    desc: 'Warm emotional drama with family nostalgia & tenderness',
    text: `The monsoon rain tapped rhythmically against the French windows of the ancestral home in Mysore. Steam rose gently from a copper pot of spiced cardamom tea.

Meera sat beside her grandmother, watching her delicate hands open an antique velvet jewel box.

Grandmother: "My child, this necklace has traveled through four generations. Your great-grandmother wore it on the day she crossed the Kaveri river."

Meera held the ornate gold pendant up to the afternoon light, her voice trembling slightly.

Meera: "It feels so heavy, Dadi. Not just the gold, but the memories it carries. Will I ever be strong enough to wear this?"

Grandmother smiled softly, placing a reassuring hand over Meera's.

Grandmother: "Grace isn't something you inherit in a box, Meera. It's something that awakens inside you the moment you choose to love without fear."`,
  },
  {
    title: 'Cyberpunk Radio Midnight',
    desc: 'High-octane sci-fi broadcast & rogue hacker scene',
    text: `Neon rain soaked the towering billboards of Sector 9. The frequency crackled to life across illegal receiver arrays.

RJ Arjun: "Good evening, nightcrawlers! This is DJ Arjun broadcastin' live from the subterranean frequency 99.4! If you're dodging surveillance drones or just chasing the neon high, stay tuned because midnight has just arrived!"

A sharp burst of static sliced into the broadcast. A distorted female voice seized the transmission.

Hacker Maya: "Cut the music, Arjun. Aegis Corp just deployed the delta hunters across the bridge. Tell everyone to evacuate Sector 4 immediately!"

RJ Arjun: "Whoa, whoa, hold on! Listen up citizens, this is not a drill. Kill your digital signatures and disperse now!"`,
  },
];

const SPEAKER_COLORS = [
  'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  'bg-amber-500/20 text-amber-300 border-amber-500/40',
  'bg-purple-500/20 text-purple-300 border-purple-500/40',
  'bg-sky-500/20 text-sky-300 border-sky-500/40',
  'bg-rose-500/20 text-rose-300 border-rose-500/40',
  'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
  'bg-teal-500/20 text-teal-300 border-teal-500/40',
  'bg-orange-500/20 text-orange-300 border-orange-500/40',
];

export const StoryPanel: React.FC = () => {
  const [scriptInput, setScriptInput] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const [segments, setSegments] = useState<StorySegment[]>([]);
  const [dialect, setDialect] = useState<Dialect>(Dialect.CHENNAI_TAMIL);
  const [activeStep, setActiveStep] = useState<'input' | 'casting' | 'result'>('input');

  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationProgress, setGenerationProgress] = useState<{ current: number; total: number; speaker: string }>({
    current: 0,
    total: 0,
    speaker: '',
  });
  const [generationError, setGenerationError] = useState<string | null>(null);

  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);

  // Assign consistent colors to unique speakers
  const speakerColorMap = useRef<Map<string, string>>(new Map());
  const getSpeakerColor = useCallback((speaker: string) => {
    if (!speakerColorMap.current.has(speaker)) {
      const idx = speakerColorMap.current.size % SPEAKER_COLORS.length;
      speakerColorMap.current.set(speaker, SPEAKER_COLORS[idx]);
    }
    return speakerColorMap.current.get(speaker)!;
  }, []);

  const handleAnalyze = async () => {
    if (!scriptInput.trim()) {
      setAnalysisError('Please paste or write your story script first.');
      return;
    }
    setAnalysisError(null);
    setIsAnalyzing(true);

    try {
      speakerColorMap.current.clear();
      const result = await analyzeStoryScript(scriptInput.trim(), dialect);
      if (!result || result.length === 0) {
        throw new Error('No spoken segments could be parsed from the script.');
      }
      setSegments(result);
      setActiveStep('casting');
    } catch (err: any) {
      setAnalysisError(err?.message || 'Failed to analyze script. Please verify your story text and try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleUpdateSegment = (idx: number, updates: Partial<StorySegment>) => {
    setSegments(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], ...updates };
      return copy;
    });
  };

  const handleVoiceChange = (idx: number, voiceId: string) => {
    const selected = ALL_STORY_VOICES.find(v => v.id === voiceId);
    if (!selected) return;
    handleUpdateSegment(idx, {
      voiceId: selected.id,
      voiceName: selected.name,
      apiVoiceName: selected.apiVoiceName,
      gender: selected.gender,
      persona: selected.persona,
    });
  };

  const handleDeleteSegment = (idx: number) => {
    setSegments(prev => prev.filter((_, i) => i !== idx));
  };

  const handleAddSegment = (afterIdx?: number) => {
    const newSeg: StorySegment = {
      id: `seg_custom_${Date.now()}`,
      speaker: 'Narrator',
      voiceId: 'm_karthik_pod',
      voiceName: 'Karthik — Fireside Story',
      apiVoiceName: 'Sadaltager',
      gender: VoiceGender.MALE,
      persona: 'Warm narrator',
      emotion: Emotion.CONVERSATIONAL,
      dialect: dialect,
      text: '',
      type: 'narration',
      notes: '',
    };
    if (afterIdx === undefined) {
      setSegments(prev => [...prev, newSeg]);
    } else {
      setSegments(prev => {
        const copy = [...prev];
        copy.splice(afterIdx + 1, 0, newSeg);
        return copy;
      });
    }
  };

  const handleGenerateStory = async () => {
    if (segments.length === 0) return;
    setIsGenerating(true);
    setGenerationError(null);
    setGenerationProgress({ current: 0, total: segments.length, speaker: segments[0]?.speaker || '' });

    try {
      const blob = await generateStoryAudio(
        segments,
        (currentIdx) => {
          setGenerationProgress({
            current: currentIdx + 1,
            total: segments.length,
            speaker: segments[currentIdx]?.speaker || '',
          });
        },
        () => {}
      );

      const url = URL.createObjectURL(blob);
      setAudioBlob(blob);
      setAudioUrl(url);
      setActiveStep('result');
    } catch (err: any) {
      setGenerationError(err?.message || 'Synthesis failed. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const uniqueSpeakers = Array.from(new Set(segments.map(s => s.speaker)));

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-emerald-950/80 via-emerald-900/30 to-black/80 border border-emerald-500/30 p-6 md:p-8 backdrop-blur-2xl shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold uppercase tracking-wider">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Autonomous Multi-Voice Director
            </div>
            <h2 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              Audio Story Creator
            </h2>
            <p className="text-sm text-gray-300 max-w-2xl leading-relaxed">
              Paste your entire script, story, dialogue, or audio drama. The AI director automatically detects characters, assigns dedicated matching voices, scripts emotions for every sentence, and stitches a full master audio track.
            </p>
          </div>

          {/* Stepper Navigation */}
          <div className="flex items-center gap-2 self-start md:self-auto bg-black/40 border border-emerald-500/20 p-1.5 rounded-2xl">
            <button
              onClick={() => setActiveStep('input')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                activeStep === 'input'
                  ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/30 font-bold'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              1. Script Input
            </button>
            <button
              onClick={() => segments.length > 0 && setActiveStep('casting')}
              disabled={segments.length === 0}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                activeStep === 'casting'
                  ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/30 font-bold'
                  : segments.length > 0
                  ? 'text-gray-300 hover:text-white'
                  : 'text-gray-600 cursor-not-allowed'
              }`}
            >
              2. Casting & Review {segments.length > 0 && `(${segments.length})`}
            </button>
            <button
              onClick={() => audioUrl && setActiveStep('result')}
              disabled={!audioUrl}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                activeStep === 'result'
                  ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/30 font-bold'
                  : audioUrl
                  ? 'text-gray-300 hover:text-white'
                  : 'text-gray-600 cursor-not-allowed'
              }`}
            >
              3. Master Audio
            </button>
          </div>
        </div>
      </div>

      {/* STEP 1: SCRIPT INPUT */}
      {activeStep === 'input' && (
        <div className="space-y-6">
          {/* Quick Presets */}
          <div className="bg-black/40 backdrop-blur-xl border border-emerald-500/20 rounded-2xl p-4">
            <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Quick Demo Templates (Click to load)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {SAMPLE_STORIES.map((sample, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setScriptInput(sample.text);
                    setAnalysisError(null);
                  }}
                  className="text-left p-3.5 rounded-xl bg-white/[0.03] hover:bg-emerald-500/10 border border-white/5 hover:border-emerald-500/40 transition-all group"
                >
                  <div className="text-sm font-bold text-white group-hover:text-emerald-300 transition-colors">
                    {sample.title}
                  </div>
                  <div className="text-xs text-gray-400 mt-1 line-clamp-1">{sample.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Dialect Profile / Language Selection */}
          <div className="bg-black/60 backdrop-blur-2xl border border-emerald-500/25 rounded-2xl p-5">
            <label className="block text-gray-400 text-xs font-semibold uppercase mb-1.5 tracking-wider">
              Dialect Profile
            </label>
            <div className="relative">
              <select
                value={dialect}
                onChange={(e) => setDialect(e.target.value as Dialect)}
                className="w-full bg-black/40 border border-white/10 hover:border-white/20 text-white rounded-xl p-2.5 text-xs appearance-none focus:border-emerald-500 focus:outline-none cursor-pointer transition-all font-medium"
              >
                <optgroup label="Tamil">
                  <option value={Dialect.CHENNAI_TAMIL}>Colloquial (Speaking Form)</option>
                  <option value={Dialect.CLASSIC_TAMIL}>Formal (Literature Form)</option>
                </optgroup>
                <optgroup label="Malayalam">
                  <option value={Dialect.MALAYALAM}>Colloquial (Speaking Form)</option>
                  <option value={Dialect.MALAYALAM_FORMAL}>Formal (Literature Form)</option>
                </optgroup>
                <optgroup label="Kannada">
                  <option value={Dialect.KANNADA}>Colloquial (Speaking Form)</option>
                  <option value={Dialect.KANNADA_FORMAL}>Formal (Literature Form)</option>
                </optgroup>
                <optgroup label="Telugu">
                  <option value={Dialect.TELUGU}>Colloquial (Speaking Form)</option>
                  <option value={Dialect.TELUGU_FORMAL}>Formal (Literature Form)</option>
                </optgroup>
                <optgroup label="English">
                  <option value={Dialect.INDIAN_ENGLISH}>Indian English</option>
                  <option value={Dialect.REGULAR_ENGLISH}>Regular English</option>
                </optgroup>
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 text-xs">
                ▼
              </div>
            </div>
          </div>

          {/* Main Input Textarea */}
          <div className="bg-black/60 backdrop-blur-2xl border border-emerald-500/25 rounded-3xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-bold text-white flex items-center gap-2">
                  <span>Paste Story, Dialogue, or Audio Drama Script</span>
                </label>
                <p className="text-xs text-gray-400 mt-0.5">
                  Include character names (e.g. &quot;Vikram:&quot;, &quot;Tara:&quot;) or narration blocks. The AI parses all roles automatically.
                </p>
              </div>
              <div className="text-xs text-gray-400 font-mono">
                {scriptInput.trim().split(/\s+/).filter(Boolean).length} words &bull; {scriptInput.length} chars
              </div>
            </div>

            <textarea
              rows={12}
              value={scriptInput}
              onChange={(e) => setScriptInput(e.target.value)}
              placeholder="Paste your story here...&#10;&#10;Example:&#10;The midnight breeze was cold across the balcony.&#10;&#10;Rajan: 'Did you think I wouldn't find out?'&#10;&#10;Tara: 'You were never meant to understand this.'&#10;&#10;He stepped forward into the shadows with a cold smile."
              className="w-full bg-[#030905]/80 border border-emerald-500/25 rounded-2xl p-4 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20 font-sans leading-relaxed transition-all resize-y"
            />

            {analysisError && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2.5">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <span>{analysisError}</span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
              <button
                type="button"
                onClick={() => setScriptInput('')}
                disabled={!scriptInput}
                className="text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-30"
              >
                Clear Script
              </button>

              <button
                type="button"
                onClick={handleAnalyze}
                disabled={isAnalyzing || !scriptInput.trim()}
                className="w-full sm:w-auto px-8 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-400 text-black font-extrabold text-sm shadow-xl shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
              >
                {isAnalyzing ? (
                  <>
                    <svg className="animate-spin w-4 h-4 text-black" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                    </svg>
                    <span>Analyzing Characters & Emotions...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5 text-black" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                    </svg>
                    <span>Cast & Segment Story</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: CASTING & REVIEW */}
      {activeStep === 'casting' && (
        <div className="space-y-6">
          {/* Casting Summary Header */}
          <div className="bg-black/50 backdrop-blur-xl border border-emerald-500/25 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Cast Roster:</span>
              {uniqueSpeakers.map((spk, idx) => {
                const segCount = segments.filter(s => s.speaker === spk).length;
                const voice = segments.find(s => s.speaker === spk)?.voiceName;
                return (
                  <div
                    key={idx}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${getSpeakerColor(spk)}`}
                  >
                    <span>{spk}</span>
                    <span className="opacity-70 text-[10px]">({segCount} cues)</span>
                    <span className="text-[10px] opacity-60 font-mono">&bull; {voice?.split('—')[0]}</span>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 bg-[#040f09] border border-emerald-500/30 rounded-xl px-2.5 py-1">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Dialect:</span>
                <select
                  value={dialect}
                  onChange={(e) => setDialect(e.target.value as Dialect)}
                  className="bg-transparent text-xs text-emerald-300 font-semibold focus:outline-none cursor-pointer"
                >
                  <optgroup label="Tamil" className="bg-black text-white">
                    <option value={Dialect.CHENNAI_TAMIL}>Colloquial (Speaking Form)</option>
                    <option value={Dialect.CLASSIC_TAMIL}>Formal (Literature Form)</option>
                  </optgroup>
                  <optgroup label="Malayalam" className="bg-black text-white">
                    <option value={Dialect.MALAYALAM}>Colloquial (Speaking Form)</option>
                    <option value={Dialect.MALAYALAM_FORMAL}>Formal (Literature Form)</option>
                  </optgroup>
                  <optgroup label="Kannada" className="bg-black text-white">
                    <option value={Dialect.KANNADA}>Colloquial (Speaking Form)</option>
                    <option value={Dialect.KANNADA_FORMAL}>Formal (Literature Form)</option>
                  </optgroup>
                  <optgroup label="Telugu" className="bg-black text-white">
                    <option value={Dialect.TELUGU}>Colloquial (Speaking Form)</option>
                    <option value={Dialect.TELUGU_FORMAL}>Formal (Literature Form)</option>
                  </optgroup>
                  <optgroup label="English" className="bg-black text-white">
                    <option value={Dialect.INDIAN_ENGLISH}>Indian English</option>
                    <option value={Dialect.REGULAR_ENGLISH}>Regular English</option>
                  </optgroup>
                </select>
                <button
                  type="button"
                  onClick={() => setSegments(prev => prev.map(s => ({ ...s, dialect })))}
                  title="Apply this dialect to all segments"
                  className="px-2 py-0.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/40 text-[10px] font-bold text-emerald-300 transition-colors"
                >
                  Apply All
                </button>
              </div>

              <button
                type="button"
                onClick={() => handleAddSegment()}
                className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-emerald-500/20 border border-white/10 hover:border-emerald-500/40 text-xs font-semibold text-gray-200 transition-all flex items-center gap-1.5"
              >
                <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add Segment
              </button>

              <button
                type="button"
                onClick={handleGenerateStory}
                disabled={isGenerating || segments.length === 0}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 text-black font-extrabold text-xs shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:scale-[1.02] transition-all flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                </svg>
                Synthesize Story Audio ({segments.length} Segments)
              </button>
            </div>
          </div>

          {/* Progress Modal/Bar when generating */}
          {isGenerating && (
            <div className="p-6 rounded-3xl bg-emerald-950/70 border border-emerald-500/40 backdrop-blur-2xl space-y-4 shadow-2xl">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2.5 text-emerald-300 font-bold">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                  </svg>
                  <span>Synthesizing Segment {generationProgress.current} of {generationProgress.total}...</span>
                </div>
                <div className="font-mono text-gray-300">
                  Speaker: <span className="text-white font-bold">{generationProgress.speaker}</span>
                </div>
              </div>

              {/* Progress track */}
              <div className="w-full h-3 rounded-full bg-black/60 overflow-hidden border border-emerald-500/20">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300"
                  style={{
                    width: `${Math.round((generationProgress.current / Math.max(1, generationProgress.total)) * 100)}%`,
                  }}
                />
              </div>
              <p className="text-[11px] text-gray-400 text-center">
                Applying dynamic vocal inflection, natural actor breathing pauses, and studio-grade audio mastering...
              </p>
            </div>
          )}

          {generationError && (
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2.5">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <span>{generationError}</span>
            </div>
          )}

          {/* Segment Cards List */}
          <div className="space-y-4">
            {segments.map((seg, idx) => (
              <div
                key={seg.id || idx}
                className="bg-black/55 backdrop-blur-2xl border border-emerald-500/20 hover:border-emerald-500/40 rounded-2xl p-5 transition-all shadow-md space-y-3 group"
              >
                {/* Header row: Speaker, Type, Voice, Emotion */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-gray-500 font-bold">#{idx + 1}</span>

                    {/* Speaker name */}
                    <input
                      type="text"
                      value={seg.speaker}
                      onChange={(e) => handleUpdateSegment(idx, { speaker: e.target.value })}
                      className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-xs font-bold text-white focus:outline-none focus:border-emerald-400 w-32"
                    />

                    {/* Segment type badge */}
                    <button
                      type="button"
                      onClick={() => handleUpdateSegment(idx, { type: seg.type === 'dialogue' ? 'narration' : 'dialogue' })}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border transition-colors ${
                        seg.type === 'dialogue'
                          ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                          : 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                      }`}
                    >
                      {seg.type}
                    </button>
                  </div>

                  {/* Controls: Voice, Emotion, Dialect */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Voice selector */}
                    <select
                      value={seg.voiceId}
                      onChange={(e) => handleVoiceChange(idx, e.target.value)}
                      className="bg-[#040f09] border border-emerald-500/30 rounded-lg px-2.5 py-1 text-xs text-emerald-300 focus:outline-none focus:border-emerald-400"
                    >
                      {ALL_STORY_VOICES.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name} ({v.gender})
                        </option>
                      ))}
                    </select>

                    {/* Emotion selector */}
                    <select
                      value={seg.emotion}
                      onChange={(e) => handleUpdateSegment(idx, { emotion: e.target.value as Emotion })}
                      className="bg-[#040f09] border border-emerald-500/30 rounded-lg px-2.5 py-1 text-xs text-amber-300 focus:outline-none focus:border-emerald-400"
                    >
                      {Object.values(Emotion).map((emo) => (
                        <option key={emo} value={emo}>
                          {emo}
                        </option>
                      ))}
                    </select>

                    {/* Dialect selector */}
                    <select
                      value={seg.dialect}
                      onChange={(e) => handleUpdateSegment(idx, { dialect: e.target.value as Dialect })}
                      className="bg-[#040f09] border border-emerald-500/30 rounded-lg px-2.5 py-1 text-xs text-gray-300 focus:outline-none focus:border-emerald-400 max-w-[150px] truncate"
                    >
                      <optgroup label="Tamil">
                        <option value={Dialect.CHENNAI_TAMIL}>Colloquial</option>
                        <option value={Dialect.CLASSIC_TAMIL}>Formal</option>
                      </optgroup>
                      <optgroup label="Malayalam">
                        <option value={Dialect.MALAYALAM}>Colloquial</option>
                        <option value={Dialect.MALAYALAM_FORMAL}>Formal</option>
                      </optgroup>
                      <optgroup label="Kannada">
                        <option value={Dialect.KANNADA}>Colloquial</option>
                        <option value={Dialect.KANNADA_FORMAL}>Formal</option>
                      </optgroup>
                      <optgroup label="Telugu">
                        <option value={Dialect.TELUGU}>Colloquial</option>
                        <option value={Dialect.TELUGU_FORMAL}>Formal</option>
                      </optgroup>
                      <optgroup label="English">
                        <option value={Dialect.INDIAN_ENGLISH}>Indian English</option>
                        <option value={Dialect.REGULAR_ENGLISH}>Regular English</option>
                      </optgroup>
                    </select>

                    {/* Delete button */}
                    <button
                      type="button"
                      onClick={() => handleDeleteSegment(idx)}
                      title="Delete segment"
                      className="p-1 rounded text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Text Content */}
                <textarea
                  rows={2}
                  value={seg.text}
                  onChange={(e) => handleUpdateSegment(idx, { text: e.target.value })}
                  placeholder="Segment dialogue or narration text..."
                  className="w-full bg-[#020604]/70 border border-white/5 rounded-xl p-3 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:border-emerald-500/50 leading-relaxed resize-y"
                />

                {/* Acting note / nuance */}
                {seg.notes && (
                  <div className="text-[11px] text-gray-400 italic flex items-center gap-1.5">
                    <span className="text-emerald-400">Direction note:</span> {seg.notes}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Bottom Action Footer */}
          <div className="flex items-center justify-between pt-4 border-t border-emerald-500/20">
            <button
              type="button"
              onClick={() => setActiveStep('input')}
              className="text-xs text-gray-400 hover:text-white transition-colors"
            >
              &larr; Back to Script Input
            </button>

            <button
              type="button"
              onClick={handleGenerateStory}
              disabled={isGenerating || segments.length === 0}
              className="px-8 py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-400 text-black font-extrabold text-sm shadow-xl shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:scale-[1.01] transition-all flex items-center gap-2"
            >
              <svg className="w-5 h-5 text-black" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
              </svg>
              <span>Generate Audio Story</span>
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: RESULT & AUDIO MASTER */}
      {activeStep === 'result' && audioUrl && (
        <div className="space-y-6">
          <div className="bg-black/60 backdrop-blur-2xl border border-emerald-500/30 rounded-3xl p-6 md:p-8 shadow-2xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-emerald-500/20 pb-5">
              <div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold uppercase mb-1">
                  Master Track Ready
                </div>
                <h3 className="text-xl font-extrabold text-white">Full Multi-Cast Audio Story</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Seamlessly stitched with intelligent silence pauses between character dialogues and narration transitions.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setActiveStep('casting')}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-gray-300 transition-colors"
                >
                  Edit Casting
                </button>

                <a
                  href={audioUrl}
                  download={`HyperVox_Story_${Date.now()}.wav`}
                  className="px-5 py-2 rounded-xl bg-emerald-500 text-black font-extrabold text-xs shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40 flex items-center gap-2 transition-all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Download WAV
                </a>
              </div>
            </div>

            {/* Hidden Native Audio Element */}
            <audio
              ref={audioRef}
              src={audioUrl}
              onTimeUpdate={() => {
                if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
              }}
              onLoadedMetadata={() => {
                if (audioRef.current) setDuration(audioRef.current.duration);
              }}
              onEnded={() => setIsPlaying(false)}
            />

            {/* Custom Luxury Audio Player */}
            <div className="bg-[#030d07] border border-emerald-500/30 rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={handlePlayPause}
                  className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-black shadow-lg shadow-emerald-500/30 hover:scale-105 active:scale-95 transition-all flex-shrink-0"
                >
                  {isPlaying ? (
                    <svg className="w-6 h-6 fill-black" viewBox="0 0 24 24">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                    </svg>
                  ) : (
                    <svg className="w-6 h-6 fill-black ml-1" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>

                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono text-gray-400">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>

                  {/* Custom Seek Bar */}
                  <input
                    type="range"
                    min={0}
                    max={duration || 100}
                    value={currentTime}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setCurrentTime(val);
                      if (audioRef.current) audioRef.current.currentTime = val;
                    }}
                    className="w-full h-2 rounded-lg bg-emerald-950 accent-emerald-400 cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Script Transcript Review */}
            <div className="space-y-3 pt-2">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Story Transcript</h4>
              <div className="space-y-2 max-h-80 overflow-y-auto pr-2 custom-scrollbar">
                {segments.map((seg, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-xl bg-white/[0.02] border border-white/5 flex items-start gap-3 text-xs"
                  >
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border flex-shrink-0 ${getSpeakerColor(seg.speaker)}`}>
                      {seg.speaker}
                    </span>
                    <div className="flex-1">
                      <span className="text-gray-200">{seg.text}</span>
                      <div className="text-[10px] text-gray-500 mt-1 font-mono">
                        Voice: {seg.voiceName.split('—')[0]} &bull; {seg.emotion}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StoryPanel;
