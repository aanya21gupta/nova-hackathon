"use client";
// Reads SimControl from localStorage, stays in sync across tabs through the
// `storage` event, and ticks on a timer. Still works if localStorage is blocked.
// One provider in the layout, so the header and the page always agree within a tab.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getData } from "@/data";
import { currentMinute, dayPhase, DEFAULT_CONTROL, getSimStateAt, SIM_STORAGE_KEY, type DayPhase } from "./simulator";
import type { Minutes, RestaurantData, SimControl, SimState, Trigger } from "./types";

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
  reset: () => void;
}

function readControl(): SimControl {
  try {
    const stored = window.localStorage.getItem(SIM_STORAGE_KEY);
    return stored ? (JSON.parse(stored) as SimControl) : DEFAULT_CONTROL;
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
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    setControl(readControl());
    setNowMs(Date.now());
    const onStorage = (event: StorageEvent) => {
      if (event.key === SIM_STORAGE_KEY || event.key === null) setControl(readControl());
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

  const update = useCallback(
    (change: (current: SimControl, now: number) => SimControl) => {
      setControl((current) => {
        const next = change(current, Date.now());
        writeControl(next);
        return next;
      });
    },
    [],
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
    () => ({ control, state, data, running, phase, start, pause, setSpeed, jumpTo, fire, reset }),
    [control, state, data, running, phase, start, pause, setSpeed, jumpTo, fire, reset],
  );

  return <SimContext.Provider value={value}>{children}</SimContext.Provider>;
}
