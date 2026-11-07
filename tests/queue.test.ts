import { describe, expect, it } from "vitest";
import { buildQueue, PACKING_BUFFER_MINUTES, startTime } from "@/lib/queue";
import type { MenuItem, Order } from "@/lib/types";

const menu: MenuItem[] = [
  { id: "curry", name: "Curry", price: 16, prepMinutes: 10, station: "wok", recipe: [] },
  { id: "rolls", name: "Rolls", price: 8, prepMinutes: 5, station: "fryer", recipe: [] },
];

function order(id: string, targetReadyAt: number, driverEtaAt?: number, status: Order["status"] = "queued"): Order {
  return { id, channel: "doordash", placedAt: 0, items: [{ menuItemId: "curry", qty: 1 }, { menuItemId: "rolls", qty: 1 }], targetReadyAt, driverEtaAt, status };
}

describe("startTime", () => {
  it("is ready time minus the longest prep minus the packing buffer", () => {
    expect(startTime(order("a", 100), menu)).toBe(100 - 10 - PACKING_BUFFER_MINUTES);
  });

  it("uses the driver's ETA when there is one", () => {
    expect(startTime(order("a", 100, 120), menu)).toBe(120 - 10 - PACKING_BUFFER_MINUTES);
  });
});

describe("buildQueue", () => {
  it("labels by start time", () => {
    const now = 100 - 10 - PACKING_BUFFER_MINUTES;
    const queue = buildQueue([order("fire", 100), order("next", 105), order("hold", 106)], menu, now);
    expect(queue.map((e) => [e.orderId, e.label])).toEqual([
      ["fire", "FIRE NOW"],
      ["next", "UP NEXT"],
      ["hold", "HOLD"],
    ]);
  });

  it("sorts by start time, whatever order they arrive in", () => {
    const queue = buildQueue([order("late", 200), order("early", 100), order("middle", 150)], menu, 0);
    expect(queue.map((e) => e.orderId)).toEqual(["early", "middle", "late"]);
  });

  it("leaves out orders that are already cooking", () => {
    const queue = buildQueue([order("a", 100, undefined, "cooking"), order("b", 100)], menu, 0);
    expect(queue.map((e) => e.orderId)).toEqual(["b"]);
  });

  it("moves an order from FIRE NOW to HOLD when the driver is 12 minutes late", () => {
    const now = 100 - 10 - PACKING_BUFFER_MINUTES;
    expect(buildQueue([order("a", 100, 100)], menu, now)[0].label).toBe("FIRE NOW");
    expect(buildQueue([order("a", 100, 112)], menu, now)[0].label).toBe("HOLD");
  });
});
