"use client";
// Track B. Reads SimControl from localStorage, listens for the `storage` event
// so tabs stay in sync, and re-renders on a timer. Must render safely if
// localStorage is unavailable.
import type { SimControl, SimState, Trigger } from "./types";

export interface UseSim {
  control: SimControl;
  state: SimState;
  start: () => void;
  pause: () => void;
  setSpeed: (speed: number) => void;
  fire: (trigger: Trigger) => void;
  reset: () => void;
}

export function useSim(): UseSim {
  throw new Error("Not implemented (Track B): useSim");
}
