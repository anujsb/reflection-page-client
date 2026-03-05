"use client";

import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import Image from "next/image";

function formatTime(secs: number) {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function Waveform() {
  return (
    <div className="flex items-center gap-[3px] h-6">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="waveform-bar" style={{ animationDelay: `${i * 0.08}s` }} />
      ))}
    </div>
  );
}

export default function ReflectionPage() {
  const { state, elapsed, remaining, progress, audioURL, error, start, stop, reset, download } =
    useVoiceRecorder();

  const circumference = 2 * Math.PI * 44;
  const dashOffset = circumference * (1 - progress);

  return (
    <main className="flex flex-col justify-start items-center px-4 py-12 md:py-20 min-h-screen"
      style={{ background: "var(--paper)" }}>

      {/* Header */}
      <div className="mb-10 w-full max-w-2xl animate-fade-up animate-fade-up-delay-1">
        <div className="flex items-center gap-3 mb-1">
          <div className="flex-1 h-px" style={{ background: "var(--warm)" }} />
          <span className="font-medium text-xs uppercase tracking-[0.2em]" style={{ color: "var(--muted)" }}>
            Curriculum Reflection
          </span>
          <div className="flex-1 h-px" style={{ background: "var(--warm)" }} />
        </div>
        <h1 className="mt-4 text-center" style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: "clamp(1.6rem, 4vw, 2.4rem)",
          fontWeight: 600,
          color: "var(--ink)",
          lineHeight: 1.2,
        }}>
          What did this spark in you?
        </h1>
      </div>

      {/* Image Card */}
      <div className="mb-8 w-full max-w-2xl animate-fade-up animate-fade-up-delay-2">
        <div className="relative shadow-lg rounded-2xl overflow-hidden"
          style={{ aspectRatio: "16/9", background: "var(--warm)" }}>
          {/* Replace src with your curriculum image */}
          <Image
            src="/favicon.ico"
            alt="Curriculum material"
            fill
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: "linear-gradient(to top, rgba(26,20,16,0.18) 0%, transparent 50%)" }} />
        </div>
        <p className="mt-3 text-sm text-center" style={{ color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>
          Module 4 · Curriculum Image
        </p>
      </div>

      {/* Instructions */}
      <div className="mb-10 w-full max-w-xl animate-fade-up animate-fade-up-delay-3">
        <div className="px-6 py-5 rounded-xl text-center"
          style={{ background: "var(--cream)", border: "1px solid var(--warm)" }}>
          <p className="text-base leading-relaxed" style={{ color: "var(--ink)", fontFamily: "'DM Sans', sans-serif", fontWeight: 300 }}>
            Take a moment to study the image above. When you&apos;re ready, press <strong style={{ fontWeight: 500 }}>Record</strong> and share your thoughts — what stood out, what it means to you, or any questions it raised.
          </p>
          <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
            Up to 1 minute · Your browser handles everything
          </p>
        </div>
      </div>

      {/* Recorder */}
      <div className="w-full max-w-sm animate-fade-up animate-fade-up-delay-4">
        <div className="flex flex-col items-center gap-6">

          {/* Timer Ring + Button */}
          <div className="relative flex justify-center items-center" style={{ width: 120, height: 120 }}>
            {/* SVG ring */}
            <svg width="120" height="120" className="absolute" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="60" cy="60" r="44" fill="none" stroke="var(--warm)" strokeWidth="4" />
              <circle
                cx="60" cy="60" r="44" fill="none"
                stroke="var(--accent)" strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                style={{ transition: "stroke-dashoffset 1s linear" }}
              />
            </svg>

            {/* Center button */}
            <button
              onClick={state === "idle" ? start : state === "recording" ? stop : reset}
              className={`relative z-10 flex flex-col items-center justify-center rounded-full transition-all duration-200 ${state === "recording" ? "pulse-ring" : ""}`}
              style={{
                width: 80, height: 80,
                background: state === "recording" ? "var(--accent)" : state === "done" ? "var(--ink)" : "var(--cream)",
                border: `2px solid ${state === "recording" ? "var(--accent)" : "var(--warm)"}`,
                boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
                cursor: "pointer",
              }}
              aria-label={state === "idle" ? "Start recording" : state === "recording" ? "Stop recording" : "Record again"}
            >
              {state === "recording" ? (
                <>
                  <Waveform />
                  <span className="mt-1 font-medium text-[10px]" style={{ color: "#fff" }}>
                    {formatTime(elapsed)}
                  </span>
                </>
              ) : state === "done" ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f5f0e8" strokeWidth="2.5" strokeLinecap="round">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 .49-3.5" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="var(--accent)" stroke="none">
                  <circle cx="12" cy="12" r="6" />
                  <circle cx="12" cy="12" r="10" fill="none" stroke="var(--accent)" strokeWidth="2" />
                </svg>
              )}
            </button>
          </div>

          {/* Status text */}
          <div className="text-center" style={{ minHeight: 40 }}>
            {state === "idle" && (
              <p className="text-sm" style={{ color: "var(--muted)" }}>Tap the button to begin</p>
            )}
            {state === "recording" && (
              <p className="font-medium text-sm" style={{ color: "var(--accent)" }}>
                Recording · {remaining}s left
              </p>
            )}
            {state === "done" && (
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                Recorded {formatTime(elapsed)} · Tap to record again
              </p>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="px-4 py-3 rounded-lg w-full text-sm text-center"
              style={{ background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca" }}>
              {error}
            </div>
          )}

          {/* Playback + Download */}
          {audioURL && state === "done" && (
            <div className="flex flex-col gap-3 w-full">
              <audio
                src={audioURL}
                controls
                className="w-full"
                style={{ borderRadius: 12, outline: "none" }}
              />
              <button
                onClick={download}
                className="flex justify-center items-center gap-2 hover:opacity-80 py-3 rounded-xl w-full font-medium text-sm active:scale-[0.98] transition-all duration-150"
                style={{
                  background: "var(--ink)",
                  color: "var(--cream)",
                  fontFamily: "'DM Sans', sans-serif",
                  letterSpacing: "0.04em",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download Recording
              </button>
            </div>
          )}

        </div>
      </div>

      {/* Footer note */}
      <p className="mt-16 text-xs text-center" style={{ color: "var(--muted)" }}>
        Audio is processed locally in your browser — nothing is uploaded automatically.
      </p>
    </main>
  );
}