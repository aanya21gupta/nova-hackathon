// Track A. See CLAUDE.md 4.2.
import type { Forecast, PrepTask, RestaurantData } from "./types";

/** Forecast x recipes, minus what's prepped, ordered by when it's needed. */
export function buildPrepList(forecast: Forecast, data: RestaurantData): PrepTask[] {
  throw new Error("Not implemented (Track A): buildPrepList");
}
