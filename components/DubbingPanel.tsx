import React, { useState, useRef } from 'react';
import { ProcessingFile, DubbingStyle, DubbingGender, Emotion } from '../types';
import { dubAudio } from '../services/geminiService';
import JSZip from 'jszip';

const LANGUAGES = [
  'Tamil', 'Hindi', 'Telugu', 'Malayalam', 'Kannada', 'Marathi', 'Bengali', 'Gujarati', 
  'Punjabi', 'Odia', 'Assamese', 'Urdu', 'Bhojpuri', 'Konkani', 'Sanskrit', 'Maithili', 
  'Santali', 'Kashmiri', 'Dogri', 'Manipuri', 'English'
];

const DubbingPanel: React.FC = () => {
  const [files, setFiles] = useState<ProcessingFile[]>([]);
  const [targetLanguages, setTargetLanguages] = useState<string[]>(['Tamil']);
  const [style, setStyle] = useState<DubbingStyle>('Local Speaking Form');
  const [targetGender, setTargetGender] = useState<DubbingGender>('Auto (Match Source)');
  const [targetEmotion, setTargetEmotion] = useState<Emotion>(Emotion.NEUTRAL);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toggleLanguage = (lang: string) => {
    setTargetLanguages(prev => 
      prev.includes(lang) 
        ? prev.filter(l => l !== lang)
        : [...prev, lang]
    );
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      if (targetLanguages.length === 0) {
        alert("Select at least one target language first.");
        return;
      }

      const rawFiles: File[] = Array.from(e.target.files);
      const newQueueItems: ProcessingFile[] = [];

      rawFiles.forEach((file) => {
        targetLanguages.forEach((lang) => {
          newQueueItems.push({
            id: Math.random().toString(36).substring(7),
            file: file,
            language: lang,
            status: 'pending'
          });
        });
      });

      setFiles(prev => [...prev, ...newQueueItems]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const processQueue = async () => {
    setIsProcessing(true);
    const pendingFiles = files.filter(f => f.status === 'pending');

    for (let i = 0; i < pendingFiles.length; i++) {
      const currentId = pendingFiles[i].id;
      setFiles(prev => prev.map(f => f.id === currentId ? { ...f, status: 'processing', error: undefined } : f));
      const currentItem = pendingFiles[i];

      try {
        const blob = await dubAudio(currentItem.file, currentItem.language, style, targetGender, targetEmotion);
        const url = URL.createObjectURL(blob);
        
        setFiles(prev => prev.map(f => f.id === currentId ? { 
          ...f, 
          status: 'completed', 
          outputUrl: url,
          outputBlob: blob
        } : f));
      } catch (err: any) {
        console.error(`Error processing ${currentItem.file.name} (${currentItem.language}):`, err);
        setFiles(prev => prev.map(f => f.id === currentId ? { 
          ...f, 
          status: 'failed', 
          error: err.message || 'Processing failed' 
        } : f));
      }

      if (i < pendingFiles.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    setIsProcessing(false);
  };

  const retryFile = (id: string) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'pending', error: undefined, outputUrl: undefined } : f));
  };

  const removeFile = (id: string) => {
    setFiles(prev => {
      const fileToRemove = prev.find(f => f.id === id);
      if (fileToRemove && fileToRemove.outputUrl) {
        URL.revokeObjectURL(fileToRemove.outputUrl);
      }
      return prev.filter(f => f.id !== id);
    });
  };

  const downloadZip = async () => {
    const zip = new JSZip();
    const completedFiles = files.filter(f => f.status === 'completed' && f.outputBlob);
    if (completedFiles.length === 0) return;

    completedFiles.forEach(f => {
      const fileName = f.file.name.replace(/\.[^/.]+$/, "");
      const ext = 'wav';
      const zipFileName = `${fileName}_${f.language}.${ext}`;
      if (f.outputBlob) {
        zip.file(zipFileName, f.outputBlob);
      }
    });

    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hypervox_dubbed_package.zip";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="liquid-glass p-8 space-y-8 animate-fade-in">
      {/* Header & Global Audio Parameters */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between pb-6 border-b border-emerald-500/20 gap-6">
        <div>
          <h2 className="text-base font-bold text-white uppercase tracking-wider">
            AI Regional Dubbing Studio
          </h2>
          <p className="text-xs text-gray-400 font-medium mt-0.5">Multi-Market Voice Localizer & Accent Synthesizer</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          {/* Global Vibe */}
          <div className="px-3.5 py-2 bg-black/40 rounded-xl border border-emerald-500/30 flex flex-col min-w-[160px]">
            <span className="text-[10px] text-emerald-400 uppercase font-semibold tracking-wider">Global Vibe</span>
            <select
              value={targetEmotion}
              onChange={(e) => setTargetEmotion(e.target.value as Emotion)}
              className="bg-transparent text-white font-medium focus:outline-none text-xs cursor-pointer mt-0.5"
            >
              {Object.values(Emotion).map(e => (
                <option key={e} value={e} className="bg-[#081810]">{e}</option>
              ))}
            </select>
          </div>

          {/* Style */}
          <div className="px-3.5 py-2 bg-black/40 rounded-xl border border-white/10 flex flex-col min-w-[140px]">
            <span className="text-[10px] text-gray-400 uppercase font-semibold tracking-wider">Style</span>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value as DubbingStyle)}
              className="bg-transparent text-white font-medium focus:outline-none text-xs cursor-pointer mt-0.5"
            >
              <option value="Local Speaking Form" className="bg-[#081810]">Colloquial Slang</option>
              <option value="Classical" className="bg-[#081810]">Formal / Classical</option>
            </select>
          </div>

          {/* Gender */}
          <div className="px-3.5 py-2 bg-black/40 rounded-xl border border-white/10 flex flex-col min-w-[130px]">
            <span className="text-[10px] text-gray-400 uppercase font-semibold tracking-wider">Vocal Profile</span>
            <select
              value={targetGender}
              onChange={(e) => setTargetGender(e.target.value as DubbingGender)}
              className="bg-transparent text-white font-medium focus:outline-none text-xs cursor-pointer mt-0.5"
            >
              <option value="Auto (Match Source)" className="bg-[#081810]">Auto Match</option>
              <option value="Male" className="bg-[#081810]">Male Artist</option>
              <option value="Female" className="bg-[#081810]">Female Artist</option>
            </select>
          </div>
        </div>
      </div>

      {/* Target Language Selection Grid */}
      <div>
        <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-3 block">
          Target Language Matrix ({targetLanguages.length} Selected)
        </span>
        <div className="flex flex-wrap gap-2 max-h-[160px] overflow-y-auto pr-1 custom-scrollbar">
          {LANGUAGES.map(lang => {
            const isSelected = targetLanguages.includes(lang);
            return (
              <button
                key={lang}
                onClick={() => toggleLanguage(lang)}
                className={`
                  px-4 py-2 rounded-xl text-xs font-semibold border transition-all uppercase tracking-wider select-none
                  ${isSelected
                    ? 'bg-emerald-500 text-black border-emerald-400 font-bold shadow-md shadow-emerald-500/20'
                    : 'bg-black/30 text-gray-400 border-white/5 hover:border-emerald-500/30 hover:text-white'
                  }
                `}
              >
                {lang}
              </button>
            );
          })}
        </div>
      </div>

      {/* Upload Bay & Queue Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Upload Dropzone */}
        <div className="lg:col-span-1 space-y-4">
          <input 
            type="file" 
            multiple 
            accept="audio/*" 
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
          />
          <div 
            onClick={() => fileInputRef.current?.click()}
            className="h-60 rounded-3xl border-2 border-dashed border-emerald-500/20 bg-black/20 flex flex-col items-center justify-center cursor-pointer hover:border-emerald-400 transition-all group"
          >
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-3 group-hover:scale-110 transition-all text-emerald-400">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
              </svg>
            </div>
            <span className="text-gray-200 font-semibold uppercase tracking-wider text-xs">Drop Audio Files</span>
            <span className="text-[10px] text-gray-400 mt-1">MP3, WAV, M4A, FLAC</span>
          </div>

          <button
            onClick={processQueue}
            disabled={isProcessing || files.filter(f => f.status === 'pending').length === 0}
            className={`w-full py-3.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all ${
              isProcessing || files.filter(f => f.status === 'pending').length === 0
                ? 'bg-white/5 text-gray-600 border border-white/5 cursor-not-allowed'
                : 'liquid-btn-primary'
            }`}
          >
            {isProcessing ? 'PROCESSING BATCH...' : `START DUBBING (${files.filter(f => f.status === 'pending').length})`}
          </button>
        </div>

        {/* Channel Strip Queue */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between px-2">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Production Queue ({files.length} Jobs)
            </span>
            
            {files.some(f => f.status === 'completed') && (
              <button 
                onClick={downloadZip}
                className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5 border border-emerald-500/30 px-3 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 transition-all uppercase"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Export ZIP Package
              </button>
            )}
          </div>
          
          <div className="h-[440px] overflow-y-auto pr-2 space-y-3 custom-scrollbar">
            {files.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center border border-white/5 rounded-3xl bg-black/20 p-8">
                <svg className="w-10 h-10 text-gray-600 mb-2" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-gray-400 text-xs font-semibold uppercase">No Active Jobs</p>
                <p className="text-gray-500 text-[11px] mt-1">Select target languages and upload audio files to begin.</p>
              </div>
            )}
            
            {files.map(file => (
              <div 
                key={file.id} 
                className="bg-black/30 p-4 rounded-2xl border border-white/10 hover:border-emerald-500/30 transition-all flex flex-col sm:flex-row items-center gap-4 relative"
              >
                <div className={`w-1.5 h-full absolute left-0 top-0 bottom-0 rounded-l-2xl ${
                  file.status === 'completed' ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 
                  file.status === 'processing' ? 'bg-emerald-500 animate-pulse' : 
                  file.status === 'failed' ? 'bg-red-500' : 'bg-gray-700'
                }`} />
                
                <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center flex-shrink-0 border border-white/10 text-gray-300">
                  <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.125 3.375c2.25 0 3.375 1.125 3.375 3.375v10.5c0 2.25-1.125 3.375-3.375 3.375H4.875C2.625 20.625 1.5 19.5 1.5 17.25V6.75c0-2.25 1.125-3.375 3.375-3.375h14.25z" />
                  </svg>
                </div>
                
                <div className="flex-1 min-w-0 text-center sm:text-left">
                  <div className="flex items-center justify-center sm:justify-start gap-2">
                    <p className="text-white font-semibold truncate text-xs">{file.file.name}</p>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">
                      {file.language}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">
                    {(file.file.size / 1024 / 1024).toFixed(2)} MB • {targetEmotion}
                  </p>
                  {file.error && <p className="text-[10px] text-red-400 mt-1">{file.error}</p>}
                </div>
                
                <div className="flex items-center gap-3">
                  {file.status === 'processing' && (
                    <span className="text-[11px] font-semibold text-emerald-400 animate-pulse">
                      Synthesizing...
                    </span>
                  )}
                  
                  {file.status === 'completed' && file.outputUrl && (
                    <div className="flex items-center gap-2">
                      <audio src={file.outputUrl} className="hidden" id={`audio-dub-${file.id}`} />
                      <button 
                        onClick={() => {
                          const audio = document.getElementById(`audio-dub-${file.id}`) as HTMLAudioElement;
                          audio.paused ? audio.play() : audio.pause();
                        }}
                        className="p-2 bg-white/5 border border-white/10 text-gray-300 rounded-lg hover:text-white transition-all"
                      >
                        ▶
                      </button>
                      <a 
                        href={file.outputUrl} 
                        download={`${file.file.name.replace(/\.[^/.]+$/, "")}_${file.language}_dub.wav`}
                        className="px-3 py-1.5 bg-emerald-500 text-black text-[10px] font-bold rounded-lg hover:bg-emerald-400 transition-all uppercase"
                      >
                        Save
                      </a>
                    </div>
                  )}

                  {file.status === 'failed' && (
                    <button 
                      onClick={() => retryFile(file.id)}
                      className="px-3 py-1.5 bg-red-950 text-red-400 border border-red-500/30 hover:bg-red-900 rounded-lg text-[10px] font-semibold uppercase"
                    >
                      Retry
                    </button>
                  )}
                  
                  <button 
                    onClick={() => removeFile(file.id)}
                    className="p-1.5 text-gray-500 hover:text-white transition-colors"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};

export default DubbingPanel;
