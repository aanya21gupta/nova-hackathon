// Track A. See CLAUDE.md 4.4.
import type { Forecast, RestaurantData, StaffingPlan } from "./types";

/** Orders per labor hour, per station, for each forecast hour. Flags gaps and risks. */
export function buildStaffingPlan(forecast: Forecast, data: RestaurantData): StaffingPlan {
  throw new Error("Not implemented (Track A): buildStaffingPlan");
}
