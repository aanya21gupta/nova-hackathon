// Track A. See CLAUDE.md 4.3.
import type { Forecast, Minutes, RestaurantData, RunOut, SupplierOrderLine } from "./types";

/** Usage for the next N days + par buffer - on hand, rounded up to pack sizes. */
export function buildSupplierOrder(forecast: Forecast, data: RestaurantData, days: number): SupplierOrderLine[] {
  throw new Error("Not implemented (Track A): buildSupplierOrder");
}

/** When each ingredient runs out at forecast pace, starting from `from`. */
export function findRunOuts(forecast: Forecast, data: RestaurantData, from: Minutes): RunOut[] {
  throw new Error("Not implemented (Track A): findRunOuts");
}
