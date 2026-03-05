"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export type RecorderState = "idle" | "recording" | "paused" | "done";

const MAX_SECONDS = 60;

export function useVoiceRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [audioURL, setAudioURL] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const stop = useCallback(() => {
    clearTimer();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setState("done");
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setAudioURL(null);
    setAudioBlob(null);
    setElapsed(0);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setAudioURL(url);
      };

      mr.start(100);
      setState("recording");

      timerRef.current = setInterval(() => {
        setElapsed((prev) => {
          if (prev + 1 >= MAX_SECONDS) {
            stop();
            return MAX_SECONDS;
          }
          return prev + 1;
        });
      }, 1000);
    } catch {
      setError("Microphone access was denied. Please allow access and try again.");
    }
  }, [stop]);

  const reset = useCallback(() => {
    clearTimer();
    mediaRecorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (audioURL) URL.revokeObjectURL(audioURL);
    setAudioURL(null);
    setAudioBlob(null);
    setElapsed(0);
    setState("idle");
    setError(null);
  }, [audioURL]);

  useEffect(() => () => { clearTimer(); streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  const download = useCallback(() => {
    if (!audioBlob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(audioBlob);
    a.download = `reflection-${Date.now()}.webm`;
    a.click();
  }, [audioBlob]);

  const progress = Math.min(elapsed / MAX_SECONDS, 1);
  const remaining = MAX_SECONDS - elapsed;

  return { state, elapsed, remaining, progress, audioURL, error, start, stop, reset, download };
}