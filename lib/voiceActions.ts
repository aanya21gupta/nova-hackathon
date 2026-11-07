// M4 adapter: the ONLY place a voice command changes anything.
//
// Swap these bodies for M1's tool functions when M1 lands (pauseItem, setBusyMode,
// markOrderReady, and M1's shared Action log). Until then:
//   - pauseItem uses the existing record-only "pauseItem" trigger, so every tab sees it;
//   - setBusyMode and markOrderReady have no simulator effect yet. They are recorded in
//     the voice log, and the kitchen board reflects them (ready orders leave the board,
//     busy mode shows as a banner).
import { useCallback, useEffect, useState } from "react";
import { describeVoiceCall, mockCallsFor, type MockCall, type VoiceToolCall, type VoiceValidationContext } from "./voice";
import type { Minutes } from "./types";
import type { UseSim } from "./useSim";

export const VOICE_LOG_KEY = "spine.voice.log";
const MAX_ENTRIES = 50;

export interface VoiceLogEntry {
  id: string;
  atMinute: Minutes;
  source: "voice";
  transcript: string;
  call: VoiceToolCall;
  summary: string;
  mockCalls: MockCall[];
  /** True if the LLM chose the call (the keyword rules didn't match). */
  viaAI?: boolean;
  undone?: boolean;
}

function readLog(): VoiceLogEntry[] {
  try {
    const raw = window.localStorage.getItem(VOICE_LOG_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as VoiceLogEntry[]) : [];
  } catch {
    return [];
  }
}

function writeLog(entries: VoiceLogEntry[]) {
  try {
    window.localStorage.setItem(VOICE_LOG_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // This tab still works; other tabs just won't see it.
  }
}

/** The voice log, kept in sync across tabs (kitchen screen, owner view). */
export function useVoiceLog() {
  const [log, setLog] = useState<VoiceLogEntry[]>([]);

  useEffect(() => {
    setLog(readLog());
    const onStorage = (event: StorageEvent) => {
      if (event.key === VOICE_LOG_KEY || event.key === null) setLog(readLog());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const add = useCallback((entry: VoiceLogEntry) => {
    setLog((current) => {
      const next = [...current, entry].slice(-MAX_ENTRIES);
      writeLog(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    writeLog([]);
    setLog([]);
  }, []);

  return { log, add, clear };
}

/** Runs an already-validated call and returns its log entry. */
export function runVoiceCall(
  call: VoiceToolCall,
  sim: Pick<UseSim, "fire" | "state">,
  ctx: Pick<VoiceValidationContext, "menu" | "orders">,
  transcript: string,
  viaAI = false,
): VoiceLogEntry {
  if (call.tool === "pauseItem") sim.fire({ type: "pauseItem", menuItemId: call.args.itemId });
  // setBusyMode / markOrderReady: recorded only, until M1's tools exist (see header).
  return {
    id: `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    atMinute: sim.state.now,
    source: "voice",
    transcript,
    call,
    summary: describeVoiceCall(call, ctx.menu),
    mockCalls: mockCallsFor(call, ctx),
    ...(viaAI ? { viaAI } : {}),
  };
}

/** Orders the kitchen said were ready, by the current sim time (jumping back hides later ones). */
export function readyByVoice(log: VoiceLogEntry[], now: Minutes): Set<string> {
  return new Set(
    log.filter((e) => !e.undone && e.call.tool === "markOrderReady" && e.atMinute <= now).map((e) => (e.call as Extract<VoiceToolCall, { tool: "markOrderReady" }>).args.orderId),
  );
}

/** Busy mode windows that are on right now. */
export function activeBusyModes(log: VoiceLogEntry[], now: Minutes) {
  return log.flatMap((e) =>
    !e.undone && e.call.tool === "setBusyMode" && e.atMinute <= now && now < e.call.args.untilTime ? [e.call.args] : [],
  );
}
