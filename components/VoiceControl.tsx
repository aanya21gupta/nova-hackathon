"use client";
// M4: "Hold to talk" on the kitchen screen. Keyword rules first (they work offline),
// then the LLM via /api/voice. Every call is validated before it touches anything.
// Pausing and busy mode wait 5 seconds with an Undo button before they're applied.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatTime } from "@/lib/format";
import { useSim } from "@/lib/useSim";
import {
  buildVoiceContext, confirmationFor, describeVoiceCall, isCustomerFacing, parseVoiceCommand, validateVoiceCall, type VoiceToolCall,
} from "@/lib/voice";
import { runVoiceCall, voiceActions } from "@/lib/voiceActions";

const UNDO_MS = 5000;
const EXAMPLES = ['"86 pad thai"', '"add 10 minutes"', '"order 12 ready"', '"what\'s next"'];
const SORRY = "Sorry, I didn't catch that. Try \"86 pad thai\".";

// The Web Speech API isn't in TypeScript's DOM types everywhere, so describe the bit we use.
interface RecognitionResultList {
  length: number;
  [index: number]: { 0: { transcript: string } };
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: RecognitionResultList }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function speak(text: string) {
  try {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1.05;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Speaking is a nice-to-have; the screen already shows the confirmation.
  }
}

interface Feedback {
  tone: "ok" | "info" | "error";
  text: string;
  heard?: string;
}

interface Pending {
  call: VoiceToolCall;
  transcript: string;
  deadline: number;
  viaAI: boolean;
}

const TONE_CLASS: Record<Feedback["tone"], string> = {
  ok: "text-emerald-300",
  info: "text-amber-300",
  error: "text-red-300",
};

export function VoiceControl() {
  const sim = useSim();
  const { state, data } = sim;
  const ctx = useMemo(() => buildVoiceContext(state, data), [state, data]);

  const [supported, setSupported] = useState(false);
  const [typeMode, setTypeMode] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [typed, setTyped] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [leftMs, setLeftMs] = useState(UNDO_MS);

  // Latest values for callbacks that outlive a render (speech events, timers, key handlers).
  const latest = useRef({ sim, ctx, pending });
  useEffect(() => {
    latest.current = { sim, ctx, pending };
  });

  useEffect(() => setSupported(recognitionCtor() !== null), []);

  const commit = useCallback(
    (p: Pending) => {
      const { sim: s, ctx: c } = latest.current;
      // Re-check: the kitchen may have moved on during the 5 seconds.
      const checked = validateVoiceCall(p.call, c);
      if (!checked.ok) {
        setFeedback({ tone: "error", text: checked.error, heard: p.transcript });
        speak(checked.error);
        return;
      }
      const result = runVoiceCall(checked.call, s, p.transcript, p.viaAI);
      if (!result.ok) {
        setFeedback({ tone: "error", text: result.error, heard: p.transcript });
        speak(result.error);
        return;
      }
      setFeedback({ tone: "ok", text: `Done: ${result.action.result}.`, heard: p.transcript });
    },
    [],
  );

  // The Undo countdown. When it runs out, the action is applied.
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => {
      const left = pending.deadline - Date.now();
      if (left <= 0) {
        window.clearInterval(timer);
        setPending(null);
        commit(pending);
      } else setLeftMs(left);
    }, 100);
    return () => window.clearInterval(timer);
  }, [pending, commit]);

  const act = useCallback(
    (call: VoiceToolCall, transcript: string, viaAI: boolean) => {
      const { sim: s, ctx: c, pending: waiting } = latest.current;
      let say = confirmationFor(call, c.menu);
      if (isCustomerFacing(call)) {
        if (waiting) commit(waiting); // A new command confirms the one still waiting.
        setLeftMs(UNDO_MS);
        setPending({ call, transcript, deadline: Date.now() + UNDO_MS, viaAI });
        setFeedback({ tone: "info", text: say, heard: transcript });
      } else {
        const result = runVoiceCall(call, s, transcript, viaAI);
        if (!result.ok) say = result.error;
        setFeedback({ tone: result.ok ? "ok" : "error", text: say, heard: transcript });
      }
      speak(say);
    },
    [commit],
  );

  const undo = useCallback(() => {
    if (latest.current.pending) {
      setPending(null);
      setFeedback({ tone: "ok", text: "Undone. Nothing was changed." });
      speak("Undone.");
    } else {
      setFeedback({ tone: "info", text: "There's nothing waiting to undo." });
      speak("Nothing to undo.");
    }
  }, []);

  const handleTranscript = useCallback(
    async (raw: string) => {
      const transcript = raw.trim();
      if (!transcript) return;
      const c = latest.current.ctx;
      const intent = parseVoiceCommand(transcript, c);

      if (intent.kind === "undo") return undo();
      if (intent.kind === "answer" || intent.kind === "error") {
        setFeedback({ tone: intent.kind === "answer" ? "ok" : "error", text: intent.say, heard: transcript });
        speak(intent.say);
        return;
      }
      if (intent.kind === "action") return act(intent.call, transcript, false);

      // No rule matched: ask the LLM to choose a tool (offline mode answers {call: null}).
      setFeedback({ tone: "info", text: "Thinking…", heard: transcript });
      try {
        const response = await fetch("/api/voice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript, now: c.now, orders: c.orders.map(({ id, status }) => ({ id, status })) }),
        });
        const body = (await response.json()) as { call?: unknown };
        if (body.call) {
          const checked = validateVoiceCall(body.call, latest.current.ctx);
          if (checked.ok) return act(checked.call, transcript, true);
        }
      } catch {
        // Fall through to the friendly message.
      }
      const text = intent.say ? `${intent.say} Try "86 pad thai".` : SORRY;
      setFeedback({ tone: "error", text, heard: transcript });
      speak(intent.say ?? "Sorry, I didn't catch that.");
    },
    [act, undo],
  );

  // ---------- Speech recognition (hold to talk) ----------
  const recognition = useRef<Recognition | null>(null);
  const heard = useRef("");
  const handleRef = useRef(handleTranscript);
  useEffect(() => {
    handleRef.current = handleTranscript;
  }, [handleTranscript]);

  const startListening = useCallback(() => {
    if (recognition.current) return;
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setTypeMode(true);
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    heard.current = "";
    setInterim("");
    rec.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
      heard.current = text;
      setInterim(text);
    };
    rec.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed" || event.error === "audio-capture") {
        setTypeMode(true);
        setFeedback({ tone: "error", text: "The microphone isn't available, so type the command instead." });
      } else if (event.error !== "no-speech" && event.error !== "aborted") {
        setFeedback({ tone: "error", text: `Couldn't listen (${event.error}). Try again or type it.` });
      }
    };
    rec.onend = () => {
      recognition.current = null;
      setListening(false);
      const said = heard.current;
      heard.current = "";
      setInterim("");
      if (said.trim()) void handleRef.current(said);
    };
    try {
      rec.start();
      recognition.current = rec;
      setListening(true);
    } catch {
      setFeedback({ tone: "error", text: "Couldn't start the microphone. Type the command instead." });
      setTypeMode(true);
    }
  }, []);

  const stopListening = useCallback(() => {
    recognition.current?.stop();
  }, []);

  // Hold the spacebar to talk (not while typing in a box).
  useEffect(() => {
    const typing = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || typing(event.target)) return;
      event.preventDefault();
      if (!event.repeat) startListening();
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== "Space" || typing(event.target)) return;
      event.preventDefault();
      stopListening();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [startListening, stopListening]);

  const showMic = supported && !typeMode;
  // The panel stays pinned on screen, so it shows only the latest two. The Action log has the rest.
  const recent = [...voiceActions(state)].reverse().slice(0, 2);

  return (
    <section aria-label="Voice commands" className="sticky bottom-0 z-10 mt-4 grid grid-cols-1 gap-3 rounded-2xl border-2 border-neutral-700 bg-neutral-900 p-3 shadow-[0_-12px_32px_rgba(0,0,0,0.7)] lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)_minmax(0,22rem)]">
      <div>
        {showMic ? (
          <>
            <button
              type="button"
              onPointerDown={(event) => {
                event.preventDefault();
                startListening();
              }}
              onPointerUp={stopListening}
              onPointerLeave={stopListening}
              onPointerCancel={stopListening}
              onContextMenu={(event) => event.preventDefault()}
              className={`w-full touch-none rounded-2xl px-5 py-3 text-3xl font-bold select-none ${
                listening ? "bg-red-600 text-white ring-4 ring-red-300" : "bg-white text-black hover:bg-neutral-200"
              }`}
            >
              {listening ? "● Listening…" : "🎙 Hold to talk"}
            </button>
            <p className="mt-1 text-lg text-neutral-400">
              or hold <kbd className="rounded bg-neutral-700 px-2 text-neutral-100">Space</kbd> ·{" "}
              <button type="button" onClick={() => setTypeMode(true)} className="underline underline-offset-4 hover:text-white">
                Type instead
              </button>
            </p>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const text = typed;
              setTyped("");
              void handleTranscript(text);
            }}
          >
            <label htmlFor="voice-text" className="text-lg text-neutral-400">
              {supported ? "Type a command" : "This browser can't listen, so type a command"}
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="voice-text"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="86 pad thai"
                autoComplete="off"
                className="min-w-0 flex-1 rounded-xl border-2 border-neutral-600 bg-neutral-950 px-4 py-2 text-2xl text-white placeholder:text-neutral-500"
              />
              <button type="submit" className="rounded-xl bg-white px-5 text-2xl font-bold text-black hover:bg-neutral-200">
                Send
              </button>
            </div>
            {supported && (
              <button type="button" onClick={() => setTypeMode(false)} className="mt-1 text-lg text-neutral-400 underline underline-offset-4 hover:text-white">
                Use the mic
              </button>
            )}
          </form>
        )}
        <p className="mt-1 text-base text-neutral-500">Try {EXAMPLES.join(" · ")}</p>
      </div>

      <div aria-live="polite" className="min-w-0">
        <div className="text-lg text-neutral-400">{listening ? "Hearing" : "Heard"}</div>
        <div className="truncate text-3xl font-semibold">{interim || feedback?.heard ? `“${interim || feedback?.heard}”` : "…"}</div>
        {feedback && <div className={`mt-1 text-2xl leading-tight font-bold ${TONE_CLASS[feedback.tone]}`}>{feedback.text}</div>}
        {pending && (
          <div role="alert" className="mt-2 flex flex-wrap items-center gap-4 rounded-xl bg-amber-400 px-4 py-2 text-black">
            <span className="text-2xl font-bold">
              {describeVoiceCall(pending.call, data.menu).replace(/^Paused/, "Pausing")} · in {Math.max(1, Math.ceil(leftMs / 1000))}s
            </span>
            <button type="button" onClick={undo} className="ml-auto rounded-lg bg-black px-5 py-2 text-2xl font-bold text-white hover:bg-neutral-800">
              Undo
            </button>
          </div>
        )}
      </div>

      <div className="min-w-0">
        <div className="text-lg text-neutral-400">Done by voice</div>
        {recent.length === 0 && <p className="mt-1 text-lg text-neutral-500">Nothing yet.</p>}
        <ul>
          {recent.map((entry) => (
            <li key={entry.id} className="border-t border-neutral-800 py-1.5">
              <div className="text-xl font-semibold">
                <span className="text-neutral-400 tabular-nums">{formatTime(entry.atMinute)}</span> {entry.result}
                {entry.viaAI && <span className="text-lg text-neutral-400"> · via AI</span>}
              </div>
              {entry.mockCalls.slice(0, 1).map((line) => (
                <div key={line} className="truncate text-base text-neutral-400">↳ {line}</div>
              ))}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
