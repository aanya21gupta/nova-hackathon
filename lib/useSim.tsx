"use client";
// Reads SimControl from localStorage, stays in sync across tabs through the
// `storage` event, and ticks on a timer. Still works if localStorage is blocked.
// One provider in the layout, so the header and the page always agree within a tab.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getData } from "@/data";
import { currentMinute, dayPhase, DEFAULT_CONTROL, getSimStateAt, SIM_STORAGE_KEY, type DayPhase } from "./simulator";
import { applyToolCall, type ApplyResult } from "./tools";
import type { ActionSource, AppliedAction, Minutes, RestaurantData, SimControl, SimState, ToolCall, Trigger } from "./types";

export interface UseSim {
  control: SimControl;
  state: SimState;
  data: RestaurantData;
  running: boolean;
  /** Which part of the day it is by the clock, whichever page you're looking at. */
  phase: DayPhase;
  start: () => void;
  pause: () => void;
  setSpeed: (speed: number) => void;
  jumpTo: (minute: Minutes) => void;
  fire: (trigger: Trigger) => void;
  /** Runs a tool now. It's validated first, and the result says if it was rejected. */
  runTool: (call: ToolCall, by: ActionSource, details?: Pick<AppliedAction, "transcript" | "viaAI">) => ApplyResult;
  skipAction: (id: string) => void;
  reset: () => void;
}

function readControl(): SimControl {
  try {
    const stored = window.localStorage.getItem(SIM_STORAGE_KEY);
    return stored ? { ...DEFAULT_CONTROL, ...(JSON.parse(stored) as Partial<SimControl>) } : DEFAULT_CONTROL;
  } catch {
    return DEFAULT_CONTROL;
  }
}

function writeControl(control: SimControl) {
  try {
    window.localStorage.setItem(SIM_STORAGE_KEY, JSON.stringify(control));
  } catch {
    // This tab still works; other tabs just won't follow it.
  }
}

const SimContext = createContext<UseSim | null>(null);

export function useSim(): UseSim {
  const sim = useContext(SimContext);
  if (!sim) throw new Error("useSim must be used inside SimProvider");
  return sim;
}

export function SimProvider({ children }: { children: ReactNode }) {
  const data = getData();
  const [control, setControl] = useState<SimControl>(DEFAULT_CONTROL);
  const controlRef = useRef<SimControl>(DEFAULT_CONTROL);
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    controlRef.current = readControl();
    setControl(controlRef.current);
    setNowMs(Date.now());
    const onStorage = (event: StorageEvent) => {
      if (event.key === SIM_STORAGE_KEY || event.key === null) {
        controlRef.current = readControl();
        setControl(controlRef.current);
      }
    };
    window.addEventListener("storage", onStorage);
    const timer = window.setInterval(() => setNowMs(Date.now()), 200);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(timer);
    };
  }, []);

  const minute = currentMinute(control, data, nowMs);
  const state = useMemo(() => getSimStateAt(control, data, minute), [control, data, minute]);

  const update = useCallback((change: (current: SimControl, now: number) => SimControl) => {
    const next = change(controlRef.current, Date.now());
    controlRef.current = next;
    setControl(next);
    writeControl(next);
  }, []);

  const runTool = useCallback(
    (call: ToolCall, by: ActionSource, details?: Pick<AppliedAction, "transcript" | "viaAI">): ApplyResult => {
      const current = controlRef.current;
      const result = applyToolCall(current, call, by, currentMinute(current, data, Date.now()), data, details);
      if (result.ok) update(() => result.control);
      return result;
    },
    [update, data],
  );

  const skipAction = useCallback(
    (id: string) => {
      update((c) => ({ ...c, skipped: [...c.skipped, id] }));
    },
    [update],
  );

  const start = useCallback(() => {
    update((c, now) => ({ ...c, paused: false, startedAtMs: now, startMinute: currentMinute(c, data, now) }));
  }, [update, data]);

  const pause = useCallback(() => {
    update((c, now) => ({ ...c, paused: true, startedAtMs: null, startMinute: currentMinute(c, data, now) }));
  }, [update, data]);

  const setSpeed = useCallback(
    (speed: number) => {
      update((c, now) => ({ ...c, speed, startedAtMs: c.paused ? null : now, startMinute: currentMinute(c, data, now) }));
    },
    [update, data],
  );

  const jumpTo = useCallback(
    (target: Minutes) => {
      update((c, now) => ({ ...c, startedAtMs: c.paused ? null : now, startMinute: target }));
    },
    [update],
  );

  const fire = useCallback(
    (trigger: Trigger) => {
      update((c) => {
        // Re-scanning an invoice replaces the earlier result rather than adding a copy.
        const others =
          trigger.type === "invoice"
            ? c.triggers.filter((t) => !(t.type === "invoice" && t.invoice.id === trigger.invoice.id))
            : c.triggers;
        return { ...c, triggers: [...others, trigger] };
      });
    },
    [update],
  );

  const reset = useCallback(() => {
    update(() => DEFAULT_CONTROL);
  }, [update]);

  const running = !control.paused && minute < data.closeHour * 60;
  const phase = dayPhase(control, state);
  const value = useMemo<UseSim>(
    () => ({ control, state, data, running, phase, start, pause, setSpeed, jumpTo, fire, runTool, skipAction, reset }),
    [control, state, data, running, phase, start, pause, setSpeed, jumpTo, fire, runTool, skipAction, reset],
  );

  return <SimContext.Provider value={value}>{children}</SimContext.Provider>;
}
