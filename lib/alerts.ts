// Track A, used from milestone 4. Code builds the message and facts; the LLM may only explain them.
import type { Alert, Forecast, Minutes, Order, RestaurantData } from "./types";

/** Run-out, pause-item, understaffed and re-forecast alerts for the current moment. */
export function buildAlerts(forecast: Forecast, orders: Order[], data: RestaurantData, now: Minutes): Alert[] {
  throw new Error("Not implemented (Track A): buildAlerts");
}
