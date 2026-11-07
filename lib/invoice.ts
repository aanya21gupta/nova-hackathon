// Track C. See CLAUDE.md 4.6. Validation is code, so bad scans get flagged even with no LLM.
import type { Invoice, PriceChange, RestaurantData } from "./types";

/** Returns the invoice with flags added when lines or the total don't add up. Never throws them away. */
export function validateInvoice(invoice: Invoice): Invoice {
  throw new Error("Not implemented (Track C): validateInvoice");
}

/** Compares unit prices with the last invoice and works out margin impact per dish. */
export function comparePrices(invoice: Invoice, data: RestaurantData): PriceChange[] {
  throw new Error("Not implemented (Track C): comparePrices");
}
