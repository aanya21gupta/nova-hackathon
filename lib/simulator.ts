// Track B. Pure: the same inputs always give the same state, on every tab.
import type { RestaurantData, SimControl, SimState } from "./types";

export const SIM_STORAGE_KEY = "spine.sim.control";

export const DEFAULT_CONTROL: SimControl = {
  startedAtMs: null,
  startMinute: 16 * 60,
  speed: 1,
  paused: true,
  triggers: [],
};

/** nowMs is passed in rather than read from the clock so this stays testable. */
export function getSimState(control: SimControl, data: RestaurantData, nowMs: number): SimState {
  throw new Error("Not implemented (Track B): getSimState");
}
