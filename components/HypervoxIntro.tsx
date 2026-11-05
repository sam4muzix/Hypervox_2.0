import React, { useEffect, useRef } from 'react';

interface HypervoxIntroProps {
  onEnter: () => void;
  isMusicPlaying?: boolean;
  onToggleMusic?: () => void;
}

const HypervoxIntro: React.FC<HypervoxIntroProps> = ({ onEnter, isMusicPlaying = false, onToggleMusic }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let W = window.innerWidth;
    let H = window.innerHeight;
    canvas.width = W;
    canvas.height = H;

    const resize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W;
      canvas.height = H;
    };
    window.addEventListener('resize', resize);

    // ── Warp stars ──────────────────────────────────────────────
    const STAR_COUNT = 380;
    interface Star { x: number; y: number; z: number; pz: number; size: number; speed: number; }
    const stars: Star[] = Array.from({ length: STAR_COUNT }, () => ({
      x: (Math.random() - 0.5) * W * 2,
      y: (Math.random() - 0.5) * H * 2,
      z: Math.random() * W,
      pz: 0,
      size: Math.random() * 1.4 + 0.3,
      speed: Math.random() * 5 + 2.5,
    }));

    const resetStar = (s: Star) => {
      s.x = (Math.random() - 0.5) * W * 2;
      s.y = (Math.random() - 0.5) * H * 2;
      s.z = W;
      s.pz = W;
    };

    // ── Accretion disk particles ─────────────────────────────────
    interface Particle { angle: number; radius: number; speed: number; size: number; alpha: number; hue: number; }
    const DISK_COUNT = 200;
    const disk: Particle[] = Array.from({ length: DISK_COUNT }, (_, i) => ({
      angle: Math.random() * Math.PI * 2,
      radius: 80 + Math.random() * 160,
      speed: (0.003 + Math.random() * 0.007) * (i % 2 === 0 ? 1 : -1),
      size: Math.random() * 2.4 + 0.4,
      alpha: Math.random() * 0.75 + 0.25,
      hue: 140 + Math.random() * 60, // green spectrum
    }));

    const EVENT_RADIUS = 62;
    let t = 0;

    const draw = () => {
      t += 0.01;
      // Trail fade
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2;

      // ── Warp tunnel stars ────────────────────────────────────
      ctx.save();
      for (const s of stars) {
        s.pz = s.z;
        s.z -= s.speed;
        if (s.z <= 0) { resetStar(s); continue; }

        const sx = (s.x / s.z) * W * 0.5 + cx;
        const sy = (s.y / s.z) * H * 0.5 + cy;
        const px = (s.x / s.pz) * W * 0.5 + cx;
        const py = (s.y / s.pz) * H * 0.5 + cy;
        const r = Math.max(0.3, s.size * (1 - s.z / W) * 2.8);
        const a = Math.min(1, (1 - s.z / W) * 1.6);

        ctx.globalAlpha = a;
        ctx.strokeStyle = `rgba(200,240,220,${a})`;
        ctx.lineWidth = r;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      }
      ctx.restore();

      // ── Outer ambient glow ───────────────────────────────────
      const outerG = ctx.createRadialGradient(cx, cy, 0, cx, cy, 350);
      outerG.addColorStop(0, 'rgba(16,185,129,0.09)');
      outerG.addColorStop(0.5, 'rgba(16,185,129,0.03)');
      outerG.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = outerG;
      ctx.beginPath();
      ctx.arc(cx, cy, 350, 0, Math.PI * 2);
      ctx.fill();

      // ── Accretion disk ───────────────────────────────────────
      const TILT = 0.20;
      for (const p of disk) {
        p.angle += p.speed;
        const dx = Math.cos(p.angle) * p.radius;
        const dy = Math.sin(p.angle) * p.radius * TILT;
        const behind = Math.sin(p.angle) < 0;
        const depthA = behind ? 0.15 : 1;
        const brightness = Math.abs(Math.sin(p.angle * 0.5 + t)) * 0.5 + 0.5;

        ctx.globalAlpha = p.alpha * depthA * brightness;
        ctx.shadowBlur = behind ? 0 : 18;
        ctx.shadowColor = `hsl(${p.hue},90%,70%)`;
        ctx.fillStyle = `hsl(${p.hue},80%,65%)`;
        ctx.beginPath();
        ctx.arc(cx + dx, cy + dy, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      // ── Black void ───────────────────────────────────────────
      ctx.beginPath();
      ctx.arc(cx, cy, EVENT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = '#000';
      ctx.fill();

      // ── Photon ring ──────────────────────────────────────────
      const ring = ctx.createRadialGradient(cx, cy, EVENT_RADIUS - 3, cx, cy, EVENT_RADIUS + 14);
      ring.addColorStop(0, 'rgba(255,255,255,0)');
      ring.addColorStop(0.35, 'rgba(160,255,200,0.6)');
      ring.addColorStop(0.65, 'rgba(52,211,153,0.22)');
      ring.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = ring;
      ctx.beginPath();
      ctx.arc(cx, cy, EVENT_RADIUS + 14, 0, Math.PI * 2);
      ctx.fill();

      // ── Re-draw core void ────────────────────────────────────
      ctx.beginPath();
      ctx.arc(cx, cy, EVENT_RADIUS - 1, 0, Math.PI * 2);
      ctx.fillStyle = '#000';
      ctx.fill();

      animRef.current = requestAnimationFrame(draw);
    };

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div className="relative min-h-screen w-full bg-black overflow-hidden flex flex-col items-center justify-center">

      {/* Cosmic canvas background */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ zIndex: 0 }} />

      {/* Top Right Music Toggle */}
      {onToggleMusic && (
        <div className="absolute top-6 right-8 z-30">
          <button
            onClick={onToggleMusic}
            title={isMusicPlaying ? 'Turn Music Off' : 'Turn Music On'}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-emerald-500/40 bg-black/60 backdrop-blur-md font-mono text-[11px] tracking-wider transition-all hover:border-emerald-400 cursor-pointer"
            style={{
              color: isMusicPlaying ? '#34d399' : '#9ca3af',
              boxShadow: isMusicPlaying ? '0 0 15px rgba(16,185,129,0.3)' : 'none',
            }}
          >
            {isMusicPlaying ? (
              <>
                <span className="flex items-end gap-0.5 h-3">
                  <span className="w-0.5 bg-emerald-400 h-3 animate-pulse" />
                  <span className="w-0.5 bg-emerald-400 h-1.5 animate-pulse" />
                  <span className="w-0.5 bg-emerald-400 h-2.5 animate-pulse" />
                </span>
                <span>MUSIC ON</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.757 3.63 8.25 4.51 8.25H6.75z" />
                </svg>
                <span>MUSIC OFF</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Centered content */}
      <div className="relative z-10 flex flex-col items-center text-center px-6">

        {/* Wordmark */}
        <h1
          className="intro-title text-white leading-none select-none mb-4"
          style={{
            fontFamily: "'Rajdhani', sans-serif",
            fontWeight: 900,
            fontSize: 'clamp(4rem, 13vw, 9rem)',
            letterSpacing: '-0.03em',
            textShadow: '0 0 100px rgba(52,211,153,0.4), 0 0 240px rgba(16,185,129,0.18)',
          }}
        >
          HyperVox
        </h1>

        {/* Studio byline with Official Brand Logo */}
        <div className="intro-sub flex items-center justify-center gap-2 mb-4 select-none">
          <img
            src="/brand-logo.png"
            alt="Greenmix Labs"
            className="h-7 sm:h-9 w-auto object-contain drop-shadow-[0_0_15px_rgba(16,185,129,0.4)]"
          />
        </div>

        {/* Tagline */}
        <p
          className="intro-tagline text-white/40 font-light leading-relaxed mb-16"
          style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: 'clamp(0.85rem, 2vw, 1.1rem)',
            maxWidth: '460px',
          }}
        >
          AI voice synthesis.<br />Every dialect. Every emotion.
        </p>

        {/* Enter CTA */}
        <button onClick={onEnter} className="intro-cta group relative cursor-pointer select-none">
          <span className="absolute inset-0 rounded-full bg-emerald-500/15 blur-2xl scale-125 group-hover:bg-emerald-400/25 transition-all duration-500" />
          <span
            className="relative flex items-center gap-3 px-10 py-4 rounded-full border border-emerald-500/40 bg-black/50 backdrop-blur-lg text-white/90 hover:text-white hover:border-emerald-400/70 hover:bg-emerald-500/8 transition-all duration-300"
            style={{
              fontFamily: "'Rajdhani', sans-serif",
              fontWeight: 700,
              fontSize: '0.85rem',
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
            }}
          >
            Enter Studio
            <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-300" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </span>
        </button>
      </div>

      {/* Bottom domain — barely visible */}
      <p
        className="absolute bottom-7 z-10 intro-credit text-white/18 uppercase"
        style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', letterSpacing: '0.38em' }}
      >
        greenmixlabs.com
      </p>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@700;900&family=Outfit:wght@300;400&family=JetBrains+Mono:wght@600&display=swap');

        @keyframes introUp {
          from { opacity: 0; transform: translateY(28px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .intro-title  { animation: introUp 1.0s cubic-bezier(0.22,1,0.36,1) 0.1s both; }
        .intro-sub    { animation: introUp 1.0s cubic-bezier(0.22,1,0.36,1) 0.25s both; }
        .intro-tagline{ animation: introUp 1.0s cubic-bezier(0.22,1,0.36,1) 0.4s both; }
        .intro-cta    { animation: introUp 1.0s cubic-bezier(0.22,1,0.36,1) 0.6s both; }
        .intro-credit { animation: introUp 1.0s cubic-bezier(0.22,1,0.36,1) 0.9s both; }
      `}</style>
    </div>
  );
};

export default HypervoxIntro;
