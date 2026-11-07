// Track B. See CLAUDE.md 4.5.
import type { MenuItem, Minutes, Order, QueueEntry } from "./types";

export const PACKING_BUFFER_MINUTES = 3;
/** An order is UP NEXT when its start time is within this many minutes. */
export const UP_NEXT_WINDOW_MINUTES = 5;

/** Start = ready - prep - packing buffer. Sorted by start. FIRE NOW / UP NEXT / HOLD. */
export function buildQueue(orders: Order[], menu: MenuItem[], now: Minutes): QueueEntry[] {
  throw new Error("Not implemented (Track B): buildQueue");
}
