// Track A. See CLAUDE.md 4.1.
import type { ActualHour, Forecast, ForecastModifier, HistoricalOrder, Minutes, RestaurantData } from "./types";

/** Re-forecast fires when the last 60 minutes differ from forecast by more than this. */
export const REFORECAST_THRESHOLD = 0.2;

/** Same-weekday, same-hour average across history, times modifiers, split by mix. */
export function buildForecast(
  history: HistoricalOrder[],
  modifiers: ForecastModifier[],
  context: Pick<RestaurantData, "date" | "weekday" | "openHour" | "closeHour">,
): Forecast {
  throw new Error("Not implemented (Track A): buildForecast");
}

/** Returns the forecast unchanged unless drift exceeds REFORECAST_THRESHOLD. */
export function reforecast(forecast: Forecast, actuals: ActualHour[], now: Minutes): Forecast {
  throw new Error("Not implemented (Track A): reforecast");
}
