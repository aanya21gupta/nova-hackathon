// See CLAUDE.md 4.5.
import type { MenuItem, Minutes, Order, QueueEntry, QueueLabel } from "./types";

export const PACKING_BUFFER_MINUTES = 3;
/** An order is UP NEXT when its start time is within this many minutes. */
export const UP_NEXT_WINDOW_MINUTES = 5;

/** Driver ETA if there is one, otherwise the quoted time. */
export function readyTime(order: Order): Minutes {
  return order.driverEtaAt ?? order.targetReadyAt;
}

/** Start = ready - longest item's prep time - packing buffer. */
export function startTime(order: Order, menu: MenuItem[]): Minutes {
  const longestPrep = order.items.reduce((longest, line) => {
    const item = menu.find((m) => m.id === line.menuItemId);
    return Math.max(longest, item?.prepMinutes ?? 0);
  }, 0);
  return readyTime(order) - longestPrep - PACKING_BUFFER_MINUTES;
}

function labelFor(startAt: Minutes, now: Minutes): QueueLabel {
  if (startAt <= now) return "FIRE NOW";
  if (startAt - now <= UP_NEXT_WINDOW_MINUTES) return "UP NEXT";
  return "HOLD";
}

/** Only orders that aren't cooking yet. Sorted by start time, earliest first. */
export function buildQueue(orders: Order[], menu: MenuItem[], now: Minutes): QueueEntry[] {
  return orders
    .filter((o) => o.status === "queued")
    .map((order) => {
      const startAt = startTime(order, menu);
      return { orderId: order.id, order, readyAt: readyTime(order), startAt, label: labelFor(startAt, now) };
    })
    .sort((a, b) => a.startAt - b.startAt || a.orderId.localeCompare(b.orderId));
}
