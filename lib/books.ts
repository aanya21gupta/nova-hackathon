// Track C. See CLAUDE.md 4.6.
import type { DaySummary, Invoice, RestaurantData, SimState } from "./types";

/** `invoices` are the ones scanned today, on top of data.invoices. Returns the recap JSON. */
export function closeBooks(state: SimState, data: RestaurantData, invoices: Invoice[]): DaySummary {
  throw new Error("Not implemented (Track C): closeBooks");
}
