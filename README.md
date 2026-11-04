# HyperVox — Powered by SAM
### *Next-Generation AI Neural Voice Synthesis, Voice-Cloning Dubbing & Speech Matrix*
**Developed by Greenmix Labs**

[![Vite](https://img.shields.io/badge/Vite-6.2.0-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![React](https://img.shields.io/badge/React-19.2.3-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Google Gemini API](https://img.shields.io/badge/Google_Gemini-2.5_TTS_%26_3_Flash-8E75B2?logo=google&logoColor=white)](https://ai.google.dev/)
[![Cloud Run Ready](https://img.shields.io/badge/Google_Cloud_Run-Ready-4285F4?logo=googlecloud&logoColor=white)](https://cloud.google.com/run)

---

## 🌟 Overview

**HyperVox** by **Greenmix Labs** is an enterprise-grade AI audio production workstation built for high-impact commercial voice synthesis, localized multi-language dubbing, and multi-dialect speech processing.

Powered by Google's **Gemini 2.5 Flash TTS** (`gemini-2.5-flash-preview-tts`) and **Gemini 3 Flash** (`gemini-3-flash-preview`), HyperVox combines fine-grained emotional control, instant voice-fingerprint cloning, and time-synchronized audio dubbing into a sleek, dark emerald fluid-glass web workstation.

---

## 🎛️ Studio Modules & Key Features

### 1. 🎙️ Neural Text-to-Speech (TTS) Engine
- **16 Curated Voice Personas**: From *Arjun (Chennai Gethu)*, *Anitha (Formal Tamil)*, and *Vikram (Energetic RJ)* to *Titan (Deep Bass Commander)*, *Zara (Epic Narration Queen)*, and *Koko (Cute Parrot)*.
- **14 Emotion & Delivery Vibes**:
  - **High Energy**: *Ultra-High Energy / Maximum Shout*, *Peppy / Radio Promo*, *Excited*, *Cricket Stadium Roar*, *Authoritative Corporate Announcement*.
  - **Cinematic & Deep**: *Dramatic / Cinematic Trailer*, *Deep Bass / Rumbling Authority*, *Cinematic Narration / Trailer Epic*.
  - **Stylized & Mood**: *Luxury / Whisper-Soft*, *Cheerful / Retail Ad*, *Emotional / Storytelling*, *Neutral / News Announcer*, *Sarcasm / Witty*, *Conversational / Natural Speaking*.
- **Per-Sentence `(Style Tag)` Emotion Switching**: Dynamically shift emotion mid-script using inline markers:
  ```text
  (Peppy) Grand opening today! (Shouting) Fifty percent off! (Dramatic) Offer ends tonight.
  ```
- **AI Script Optimizer**: One-click AI script enhancement that automatically inserts `(Style Tag)` markers, fixes regional pronunciation (e.g. "Vango" → "Vaangaw"), and expands numbers/abbreviations for flawless TTS delivery.
- **Dialect Controls**: Support for *Chennai Tamil (Colloquial Madras Bashai)*, *Classic Tamil (Senthamizh)*, *Indian English*, and *Regular English*.
- **Pacing & Pronunciation**: Speech speed controls (*Slow*, *Medium*, *Fast*) and custom phonetic pronunciation override guides.
- **Parallel Synthesis & Smart Caching**: Concurrent multi-chunk synthesis with LRU audio caching and automatic fallback chunk-splitting.

---

### 2. 🎬 AI Voice Dubbing Workstation
- **9-Point Voice Fingerprint Analysis**: Automatically analyzes source audio clips to extract voice gender, pitch, pace, energy, tone, accent, delivery style, breathiness, and dominant emotion label.
- **Multi-Language Dubbing**: Translates and dubs source audio into target languages while replicating the original speaker's vocal personality and delivery style.
- **Duration-Locking & Time-Stretching**: Calculates source audio duration down to the millisecond and applies dynamic PCM algorithm time-stretching (`stretchPcmToTargetDuration`) to snap the dubbed audio precisely to the original timing.
- **Gender Matching & Batch Queue**: Supports auto-matching source gender or explicit male/female selection, with batch file processing.

---

### 3. 🌐 Speech & Translation Matrix
- **Audio Transcription & Decoding**: Multimodal audio transcription using Gemini 3 Flash.
- **Translation Styles**: Choose between *Straight Translation*, *Colloquial (Local Slang)*, or *Classical (Formal)*.
- **Multi-Dialect Translation Matrix**: Convert spoken or written content into native regional dialects instantly.

---

## 🏗️ Architecture & Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Framework** | React 19 + TypeScript + Vite 6 |
| **Styling** | TailwindCSS + Custom Emerald Fluid Glass CSS Design System |
| **AI Audio Models** | Google Gemini 2.5 Flash TTS & Gemini 3 Flash |
| **Database & Cloud** | Google Cloud Firestore (Real-time voice presets & generation analytics) |
| **Audio Processing** | Custom PCM Decoder, LameJS MP3 Encoder, Time-Stretching Engine |
| **Containerization** | Multi-Stage Dockerfile (Node 20 Alpine + Nginx Alpine) |
| **Deployment Target** | Google Cloud Run & Firebase Hosting (Automatic `$PORT` binding & SPA routing) |

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v18.x or higher
- **npm**: v9.x or higher
- **Google Gemini API Key**: Obtainable from [Google AI Studio](https://aistudio.google.com/)

---

### Local Installation & Setup

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/sam4muzix/Hypervox_2.0.git
   cd Hypervox_2.0
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Create a `.env.local` file in the root directory:
   ```env
   GEMINI_API_KEY=your_google_gemini_api_key_here
   ```

4. **Launch Development Server**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

5. **Build for Production**:
   ```bash
   npm run build
   ```

---

## ☁️ Google Cloud Run Deployment

HyperVox includes a production-grade multi-stage `Dockerfile` and `nginx.conf` designed for **Google Cloud Run**.

### Deployment Steps:
1. Connect your GitHub repository (`sam4muzix/Hypervox_2.0`) to **Google Cloud Run** via **Cloud Build** or **Developer Connect**.
2. Set **Build Type** to **`Dockerfile`** (Source location: `/Dockerfile`).
3. Under **Labels**, add the mandatory verification label:
   - **Key**: `dev-tutorial`
   - **Value**: `cloud-run-ai-challenge`
4. Set authentication to **Allow unauthenticated invocations** so judges and public users can test the live application.
5. Deploy the service. Nginx will automatically bind to the dynamic `$PORT` provided by Cloud Run and handle client-side SPA routing.

---

## 🗄️ Google Cloud Firestore Setup

HyperVox integrates with **Cloud Firestore** for voice presets and generation telemetry.
- **Rules File**: [`firestore.rules`](file:///e:/hypervox---powered-by-sam%202/hypervox---powered-by-sam%202/firestore.rules)
- Deployed via Firebase CLI / Google Cloud Console with security rules enabled.

---

## 📁 Directory Structure

```
Hypervox_2.0/
├── components/                  # React UI Workstation Modules
│   ├── TtsPanel.tsx             # Neural TTS Generation Panel (Gemini 2.5 / 3.1 TTS)
│   ├── DubbingPanel.tsx         # AI Voice Dubbing & Sync Workstation
│   └── TranscribeTranslatePanel.tsx # Speech Decoding & Translation Matrix
├── services/
│   └── geminiService.ts         # Gemini TTS & Flash SDK Integration
├── utils/
│   └── audio.ts                 # WSOLA Time-Stretching & Audio Processing
├── public/                      # Static Assets & Redirect Rules
├── App.tsx                      # Main Application Shell & Drawer Navigation
├── Dockerfile                   # Multi-Stage Production Build Dockerfile
├── nginx.conf                   # Nginx Template with $PORT Substitution & SPA Fallback
├── firestore.rules              # Cloud Firestore Security Rules
├── firebase.json                # Firebase Deployment Configuration
├── package.json                 # Project Dependencies & Scripts
├── tsconfig.json                # TypeScript Configuration
└── vite.config.ts               # Vite Build Configuration
```

---

## 📄 License

Developed by **Greenmix Labs**. All rights reserved.
