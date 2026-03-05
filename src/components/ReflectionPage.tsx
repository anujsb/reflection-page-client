"use client";

import { useState, useRef, useCallback, useEffect, ChangeEvent } from "react";

/* ─────────────────────────── types ─────────────────────────── */
type Stage = "idle" | "countdown" | "recording" | "done";

/* ─────────────────────────── constants ─────────────────────── */
const MAX_SEC = 60;
const COUNTDOWN = 3;

/* ─────────────────────────── helpers ──────────────────────── */
function fmt(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/* ──────────────────── waveform canvas hook ─────────────────── */
function useWaveform(canvasRef: React.RefObject<HTMLCanvasElement | null>, stream: MediaStream | null, active: boolean) {
  const animRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!active || !stream || !canvasRef.current) return;

    const audioCtx = new AudioContext();
    ctxRef.current = audioCtx;
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    analyserRef.current = analyser;
    audioCtx.createMediaStreamSource(stream).connect(analyser);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const data = new Uint8Array(analyser.frequencyBinCount);

    function draw() {
      animRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(data);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barW = canvas.width / data.length * 2.5;
      let x = 0;
      data.forEach((v) => {
        const h = (v / 255) * canvas.height;
        const alpha = 0.5 + (v / 255) * 0.5;
        ctx.fillStyle = `rgba(220, 120, 60, ${alpha})`;
        ctx.beginPath();
        ctx.roundRect(x, canvas.height - h, barW - 1, h, 2);
        ctx.fill();
        x += barW + 1;
      });
    }
    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
      audioCtx.close();
    };
  }, [active, stream, canvasRef]);
}

/* ──────────────────── mic permission hook ───────────────────── */
type MicPerm = "unknown" | "checking" | "granted" | "denied" | "prompted";

function useMicPermission() {
  const [perm, setPerm] = useState<MicPerm>("unknown");

  // On mount: check via Permissions API if available, then proactively prompt
  useEffect(() => {
    let permStatus: PermissionStatus | null = null;

    async function check() {
      // 1. Try Permissions API first (non-intrusive check)
      if (navigator.permissions) {
        try {
          permStatus = await navigator.permissions.query({ name: "microphone" as PermissionName });
          if (permStatus.state === "granted") { setPerm("granted"); return; }
          if (permStatus.state === "denied")  { setPerm("denied");  return; }
          // "prompt" state — fall through to proactive request
          permStatus.onchange = () => {
            if (permStatus!.state === "granted") setPerm("granted");
            if (permStatus!.state === "denied")  setPerm("denied");
          };
        } catch { /* Permissions API not supported, proceed */ }
      }

      // 2. Proactively fire getUserMedia so the browser popup appears immediately
      setPerm("prompted");
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop()); // release immediately — just wanted the grant
        setPerm("granted");
      } catch {
        setPerm("denied");
      }
    }

    check();
    return () => { if (permStatus) permStatus.onchange = null; };
  }, []);

  const requestAgain = useCallback(async () => {
    setPerm("prompted");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      setPerm("granted");
    } catch {
      setPerm("denied");
    }
  }, []);

  return { perm, requestAgain };
}

/* ══════════════════════════ MAIN PAGE ══════════════════════════ */
export default function ReflectionPage() {
  const [stage, setStage] = useState<Stage>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState(COUNTDOWN);
  const [audioURL, setAudioURL] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [image, setImage] = useState<string>("/placeholder-curriculum.jpg");
  const [imageName, setImageName] = useState<string>("Default curriculum image");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permDenied, setPermDenied] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const { perm, requestAgain } = useMicPermission();

  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useWaveform(canvasRef, stream, stage === "recording");

  /* ── stop recording ── */
  const stopRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (mediaRecRef.current?.state !== "inactive") mediaRecRef.current?.stop();
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
    setStage("done");
  }, [stream]);

  /* ── start sequence ── */
  const handleRecord = useCallback(async () => {
    if (stage === "recording") { stopRecording(); return; }
    if (stage === "done") {
      setStage("idle"); setElapsed(0); setAudioURL(null); setAudioBlob(null);
      setSubmitted(false); return;
    }

    setError(null);
    setPermDenied(false);

    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setPermDenied(true);
      setError("Microphone access denied. Please allow microphone access in your browser settings and try again.");
      return;
    }

    /* countdown */
    setStage("countdown");
    setCountdown(COUNTDOWN);
    let cd = COUNTDOWN;
    const cdInterval = setInterval(() => {
      cd--;
      setCountdown(cd);
      if (cd <= 0) {
        clearInterval(cdInterval);

        /* start recording */
        chunksRef.current = [];
        setStream(mic);
        const mr = new MediaRecorder(mic);
        mediaRecRef.current = mr;

        mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        mr.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          setAudioBlob(blob);
          setAudioURL(URL.createObjectURL(blob));
        };
        mr.start(100);
        setElapsed(0);
        setStage("recording");

        let sec = 0;
        timerRef.current = setInterval(() => {
          sec++;
          setElapsed(sec);
          if (sec >= MAX_SEC) {
            clearInterval(timerRef.current!);
            mr.stop();
            mic.getTracks().forEach((t) => t.stop());
            setStream(null);
            setStage("done");
          }
        }, 1000);
      }
    }, 1000);
  }, [stage, stopRecording]);

  /* ── image upload ── */
  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setImage(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  /* ── download ── */
  const download = () => {
    if (!audioBlob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(audioBlob);
    a.download = `reflection-${Date.now()}.webm`;
    a.click();
  };

  /* ── fake submit ── */
  const handleSubmit = () => setSubmitted(true);

  /* ring math */
  const r = 52;
  const circ = 2 * Math.PI * r;
  const recProgress = stage === "recording" ? elapsed / MAX_SEC : stage === "done" ? 1 : 0;
  const dashOffset = circ * (1 - recProgress);
  const remaining = MAX_SEC - elapsed;

  /* ═══════════════════════ RENDER ═══════════════════════ */
  return (
    <div style={{ minHeight: "100vh", background: "#0f1117", color: "#f0ede6", fontFamily: "'DM Sans', sans-serif" }}
      className="flex flex-col">

      {/* ── TOP BAR ── */}
      <header style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(15,17,23,0.95)" }}
        className="top-0 z-50 sticky flex justify-between items-center backdrop-blur-sm px-6 py-4">
        <div className="flex items-center gap-3">
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#dc783c,#e8a870)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="white" strokeWidth="2" strokeLinecap="round"/><line x1="8" y1="23" x2="16" y2="23" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>
          </div>
          <span style={{ fontWeight: 600, fontSize: 16, letterSpacing: "-0.01em" }}>ReflectAI</span>
        </div>
        <span style={{ fontSize: 12, color: "rgba(240,237,230,0.4)", letterSpacing: "0.08em" }} className="hidden sm:block">
          PROTOTYPE · CURRICULUM REFLECTION
        </span>
        <div style={{ fontSize: 12, color: "rgba(240,237,230,0.5)", background: "rgba(255,255,255,0.06)", borderRadius: 20, padding: "4px 12px" }}>
          Module 4
        </div>
      </header>

      <main className="flex flex-col flex-1 gap-8 mx-auto px-4 sm:px-6 py-8 sm:py-12 w-full max-w-5xl">

        {/* ── HERO TITLE ── */}
        <div className="text-center">
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: "clamp(1.8rem,5vw,3rem)", fontWeight: 700, lineHeight: 1.15, letterSpacing: "-0.02em", background: "linear-gradient(135deg,#f0ede6 30%,#dc783c)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            What did this spark in you?
          </h1>
          <p style={{ color: "rgba(240,237,230,0.5)", marginTop: 10, fontSize: "clamp(0.9rem,2vw,1.05rem)" }}>
            Study the image below, then record your spoken reflection — up to 1 minute.
          </p>
        </div>

        {/* ── TWO-COLUMN LAYOUT ── */}
        <div className="gap-6 grid grid-cols-1 lg:grid-cols-2">

          {/* LEFT — IMAGE CARD */}
          <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 20, border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
            {/* Image area */}
            <div style={{ position: "relative", aspectRatio: "4/3", background: "#1a1d27", overflow: "hidden" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image}
                alt="Curriculum"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                onError={(e) => {
                  (e.target as HTMLImageElement).src = "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=800&q=80";
                }}
              />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(15,17,23,0.6) 0%, transparent 50%)" }} />
              <div style={{ position: "absolute", bottom: 14, left: 16, right: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  {imageName}
                </span>
              </div>
            </div>

            {/* Upload strip */}
            <div style={{ padding: "14px 18px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 12 }}>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "1px dashed rgba(220,120,60,0.5)", background: "rgba(220,120,60,0.06)", color: "#dc783c", fontSize: 13, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "all 0.15s" }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(220,120,60,0.12)")}
                onMouseLeave={e => (e.currentTarget.style.background = "rgba(220,120,60,0.06)")}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Upload Your Image
              </button>
            </div>

            {/* Prompt box */}
            <div style={{ padding: "0 18px 18px" }}>
              <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: "14px 16px", borderLeft: "3px solid #dc783c" }}>
                <p style={{ fontSize: 13, color: "rgba(240,237,230,0.7)", lineHeight: 1.65, margin: 0 }}>
                  Take a moment to look at this image. Notice what stands out — shapes, colours, emotions, questions. When you&apos;re ready, record your honest reflection in your own words.
                </p>
              </div>
            </div>
          </div>

          {/* RIGHT — RECORDER CARD */}
          <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 20, border: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", gap: 0, overflow: "hidden" }}>

            {/* ── MIC PERMISSION BANNER ── */}
            {(perm === "checking" || perm === "prompted") && (
              <div style={{ margin: "14px 14px 0", padding: "10px 14px", borderRadius: 10, background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)", display: "flex", alignItems: "center", gap: 10 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}><path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                <span style={{ fontSize: 12, color: "#fde68a", lineHeight: 1.4 }}>Requesting microphone access — please allow the popup in your browser…</span>
              </div>
            )}
            {perm === "denied" && (
              <div style={{ margin: "14px 14px 0", padding: "12px 14px", borderRadius: 10, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 12, color: "#fca5a5", fontWeight: 600, marginBottom: 4 }}>Microphone access blocked</p>
                    <p style={{ fontSize: 11, color: "rgba(252,165,165,0.8)", lineHeight: 1.55, marginBottom: 8 }}>
                      Click the <strong>🔒 lock icon</strong> in your browser address bar → <strong>Site settings</strong> → set Microphone to <strong>Allow</strong>, then reload. Or tap below to try again.
                    </p>
                    <button onClick={requestAgain} style={{ fontSize: 11, padding: "5px 12px", borderRadius: 6, background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)", color: "#fca5a5", cursor: "pointer", fontWeight: 500 }}>
                      Try requesting again
                    </button>
                  </div>
                </div>
              </div>
            )}
            {perm === "granted" && (
              <div style={{ margin: "14px 14px 0", padding: "8px 14px", borderRadius: 10, background: "rgba(34,197,94,0.07)", border: "1px solid rgba(34,197,94,0.2)", display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                <span style={{ fontSize: 12, color: "#86efac" }}>Microphone access granted — ready to record</span>
              </div>
            )}

            {/* Card header */}
            <div style={{ padding: "14px 20px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", marginTop: 14 }}>
              <div className="flex items-center gap-2">
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: stage === "recording" ? "#ef4444" : stage === "done" ? "#22c55e" : "rgba(255,255,255,0.2)", boxShadow: stage === "recording" ? "0 0 0 3px rgba(239,68,68,0.2)" : "none", transition: "all 0.3s" }} />
                <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: stage === "recording" ? "#ef4444" : stage === "done" ? "#22c55e" : "rgba(240,237,230,0.5)" }}>
                  {stage === "idle" ? "Ready to record" : stage === "countdown" ? "Starting…" : stage === "recording" ? "Recording live" : "Recording complete"}
                </span>
              </div>
            </div>

            {/* Main recorder area */}
            <div className="flex flex-col justify-center items-center" style={{ flex: 1, padding: "32px 20px", gap: 28 }}>

              {/* ── COUNTDOWN overlay ── */}
              {stage === "countdown" && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                  <div style={{ fontSize: 80, fontWeight: 700, color: "#dc783c", lineHeight: 1, fontFamily: "'Playfair Display', serif" }}>
                    {countdown}
                  </div>
                  <p style={{ color: "rgba(240,237,230,0.5)", fontSize: 14 }}>Get ready to speak…</p>
                </div>
              )}

              {/* ── RING BUTTON ── */}
              {stage !== "countdown" && (
                <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {/* Outer glow */}
                  {stage === "recording" && (
                    <div style={{ position: "absolute", width: 140, height: 140, borderRadius: "50%", background: "radial-gradient(circle, rgba(220,120,60,0.2) 0%, transparent 70%)", animation: "pulse 2s ease-in-out infinite" }} />
                  )}
                  {/* SVG ring */}
                  <svg width="130" height="130" style={{ position: "absolute", transform: "rotate(-90deg)" }}>
                    <circle cx="65" cy="65" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
                    <circle
                      cx="65" cy="65" r={r} fill="none"
                      stroke={stage === "done" ? "#22c55e" : "#dc783c"}
                      strokeWidth="5"
                      strokeLinecap="round"
                      strokeDasharray={circ}
                      strokeDashoffset={dashOffset}
                      style={{ transition: "stroke-dashoffset 1s linear, stroke 0.5s" }}
                    />
                  </svg>

                  {/* Button */}
                  <button
                    onClick={handleRecord}
                    style={{
                      width: 100, height: 100, borderRadius: "50%",
                      background: stage === "recording" ? "linear-gradient(135deg,#ef4444,#dc2626)" : stage === "done" ? "linear-gradient(135deg,#22c55e,#16a34a)" : "linear-gradient(135deg,#dc783c,#c05a28)",
                      border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
                      boxShadow: stage === "recording" ? "0 0 30px rgba(239,68,68,0.35)" : "0 0 30px rgba(220,120,60,0.35)",
                      transition: "all 0.2s", zIndex: 2,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.04)")}
                    onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
                    aria-label={stage === "idle" ? "Start recording" : stage === "recording" ? "Stop recording" : "Record again"}
                  >
                    {stage === "idle" && (
                      <>
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="white"><path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.9)", fontWeight: 600, letterSpacing: "0.06em" }}>RECORD</span>
                      </>
                    )}
                    {stage === "recording" && (
                      <>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.9)", fontWeight: 600 }}>STOP</span>
                      </>
                    )}
                    {stage === "done" && (
                      <>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/></svg>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.9)", fontWeight: 600 }}>AGAIN</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Timer display */}
              {stage !== "countdown" && (
                <div className="text-center">
                  <div style={{ fontSize: 42, fontWeight: 700, fontFamily: "monospace", letterSpacing: "0.04em", color: stage === "recording" ? "#f0ede6" : "rgba(240,237,230,0.3)", lineHeight: 1 }}>
                    {stage === "recording" ? fmt(elapsed) : stage === "done" ? fmt(elapsed) : "00:00"}
                  </div>
                  <div style={{ fontSize: 12, color: "rgba(240,237,230,0.35)", marginTop: 6 }}>
                    {stage === "idle" && "Max 1 minute"}
                    {stage === "recording" && `${remaining}s remaining`}
                    {stage === "done" && "Recording saved"}
                  </div>
                </div>
              )}

              {/* ── LIVE WAVEFORM ── */}
              <div style={{ width: "100%", height: 56, borderRadius: 12, background: "rgba(255,255,255,0.03)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {stage === "recording" ? (
                  <canvas ref={canvasRef} width={400} height={56} style={{ width: "100%", height: "100%" }} />
                ) : (
                  <div className="flex items-end gap-[3px] px-4" style={{ height: 56 }}>
                    {Array.from({ length: 28 }).map((_, i) => (
                      <div key={i} style={{ flex: 1, borderRadius: 2, background: stage === "done" ? "#22c55e" : "rgba(255,255,255,0.08)", height: `${15 + Math.sin(i * 0.7) * 12 + Math.cos(i * 1.3) * 8}px`, transition: "height 0.3s, background 0.3s" }} />
                    ))}
                  </div>
                )}
              </div>

            </div>

            {/* ── ERROR ── */}
            {error && (
              <div style={{ margin: "0 16px 16px", padding: "12px 16px", borderRadius: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>
                {error}
                {permDenied && <span style={{ display: "block", marginTop: 6, opacity: 0.7 }}>Tip: Click the 🔒 icon in your browser address bar to manage permissions.</span>}
              </div>
            )}

            {/* ── PLAYBACK + ACTIONS ── */}
            {audioURL && stage === "done" && !submitted && (
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                <audio ref={audioRef} src={audioURL} controls style={{ width: "100%", borderRadius: 8 }} />
                <div className="gap-3 grid grid-cols-2">
                  <button onClick={download} style={{ padding: "11px 0", borderRadius: 10, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", color: "#f0ede6", fontSize: 13, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "background 0.15s" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.12)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Download
                  </button>
                  <button onClick={handleSubmit} style={{ padding: "11px 0", borderRadius: 10, background: "linear-gradient(135deg,#dc783c,#c05a28)", border: "none", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "opacity 0.15s" }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
                    onMouseLeave={e => (e.currentTarget.style.opacity = "1")}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    Submit
                  </button>
                </div>
              </div>
            )}

            {/* ── SUCCESS STATE ── */}
            {submitted && (
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "24px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <p style={{ fontSize: 14, fontWeight: 600, color: "#22c55e" }}>Reflection submitted!</p>
                <p style={{ fontSize: 12, color: "rgba(240,237,230,0.4)", textAlign: "center" }}>Your audio has been recorded and saved successfully.</p>
                <button onClick={() => { setSubmitted(false); handleRecord(); }} style={{ marginTop: 4, fontSize: 13, color: "rgba(240,237,230,0.5)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                  Record another
                </button>
              </div>
            )}

          </div>
        </div>

        {/* ── STEP GUIDE ── */}
        <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 16, border: "1px solid rgba(255,255,255,0.06)", padding: "20px 24px" }}>
          <p style={{ fontSize: 11, color: "rgba(240,237,230,0.35)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 16 }}>How it works</p>
          <div className="gap-4 grid grid-cols-2 sm:grid-cols-4">
            {[
              { n: "01", t: "Look", d: "Study the curriculum image carefully" },
              { n: "02", t: "Upload", d: "Optionally replace with your own image" },
              { n: "03", t: "Record", d: "Hit record and speak for up to 60 seconds" },
              { n: "04", t: "Submit", d: "Download or submit your reflection" },
            ].map((s) => (
              <div key={s.n} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 11, color: "#dc783c", fontWeight: 700, fontFamily: "monospace" }}>{s.n}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#f0ede6" }}>{s.t}</span>
                <span style={{ fontSize: 12, color: "rgba(240,237,230,0.4)", lineHeight: 1.5 }}>{s.d}</span>
              </div>
            ))}
          </div>
        </div>

      </main>

      {/* ── FOOTER ── */}
      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ fontSize: 12, color: "rgba(240,237,230,0.25)", textAlign: "center" }}>
          Audio is processed locally in your browser — nothing is uploaded without your consent.
        </p>
      </footer>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=DM+Sans:wght@300;400;500;600&display=swap');
        @keyframes pulse { 0%,100%{opacity:0.6;transform:scale(1)} 50%{opacity:1;transform:scale(1.08)} }
      `}</style>
    </div>
  );
}