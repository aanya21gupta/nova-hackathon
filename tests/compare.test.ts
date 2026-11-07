import { describe, expect, it } from "vitest";
import { getData } from "@/data";
import { compareDays, withSuggestedPlan } from "@/lib/compare";
import { measureKitchen } from "@/lib/kitchenRun";
import { dayOutcome } from "@/lib/outcomes";
import { templateRecap } from "@/lib/recap";
import { closeBooks } from "@/lib/books";
import { hasInventedNumbers } from "@/lib/numbers";
import { DEFAULT_CONTROL, getSimStateAt, makeRushTrigger } from "@/lib/simulator";
import { applyToolCall } from "@/lib/tools";
import type { Order, RestaurantData, SimControl, SimState } from "@/lib/types";

const CLOSE = 21 * 60;

// A tiny restaurant whose every number can be checked by hand:
// one dish at $10, using 1 lb of a $2 ingredient, with 3 lb on hand.
function order(id: string, placedAt: number, channel: Order["channel"] = "direct"): Order {
  const ready = placedAt + 30;
  return {
    id,
    channel,
    placedAt,
    items: [{ menuItemId: "dish", qty: 1 }],
    targetReadyAt: ready,
    driverEtaAt: channel === "direct" ? undefined : ready,
    status: "queued",
  };
}

const tiny: RestaurantData = {
  id: "test",
  name: "Test Kitchen",
  timezone: "America/New_York",
  channels: [],
  suppliers: [],
  date: "2026-11-07",
  weekday: 6,
  openHour: 11,
  closeHour: 21,
  menu: [{ id: "dish", name: "Dish", price: 10, prepMinutes: 5, station: "wok", recipe: [{ ingredientId: "meat", qty: 1, unit: "lb" }] }],
  ingredients: [{ id: "meat", name: "Meat", unit: "lb", onHand: 3, parLevel: 0, packSize: 10, supplierId: "butcher", lastUnitPrice: 2 }],
  staff: [
    { id: "a", name: "A", skills: ["packing"], hourlyRate: 10, availability: [{ start: 660, end: 1260 }] },
    { id: "b", name: "B", skills: ["wok"], hourlyRate: 10, availability: [] },
  ],
  history: [],
  modifiers: [],
  prepped: {},
  orders: [order("o1", 700), order("o2", 710), order("o3", 720), order("o4", 730), order("o5", 740)],
  rushOrders: [],
  payouts: [
    { channel: "doordash", date: "2026-11-07", grossSales: 100, fees: 20, expectedNet: 80, actualNet: 80 },
    { channel: "appB", date: "2026-11-07", grossSales: 100, fees: 20, expectedNet: 80, actualNet: 80 },
    { channel: "direct", date: "2026-11-07", grossSales: 100, fees: 0, expectedNet: 100, actualNet: 100 },
  ],
  payoutGapOrderIds: [],
  invoices: [],
};

describe("the savings math, on a tiny day", () => {
  // 5 walk-in orders, but only 3 lb of meat. Wages are 10 hours × $10 = $100.
  const without = dayOutcome(DEFAULT_CONTROL, tiny);

  it("loses the two orders it can't make", () => {
    expect(without.netSales).toBe(30);
    expect(without.foodCost).toBe(6);
    expect(without.lostSales).toBe(20);
    expect(without.ordersLost).toBe(2);
    expect(without.ranOut).toEqual(["Meat"]);
  });

  it("works out money kept with the documented formula", () => {
    // 30 sales − 0 fees − 6 food − 100 wages.
    expect(without.moneyKept).toBe(-76);
  });

  it("saves the extra margin when an order fixes the shortage", () => {
    const fixed = applyToolCall(DEFAULT_CONTROL, { tool: "draftSupplierOrder", supplierId: "butcher", lines: [{ ingredientId: "meat", qty: 10 }] }, "agent", 1020, tiny);
    if (!fixed.ok) throw new Error(fixed.error);
    const comparison = compareDays(fixed.control, tiny);
    // 5 × $10 − 5 × $2 − $100 = −$60, against −$76: $16 better.
    expect(comparison.with.moneyKept).toBe(-60);
    expect(comparison.saved).toBe(16);
    expect(comparison.with.lostSales).toBe(0);
    expect(comparison.without.lostSales).toBe(20);
    expect(comparison.breakdown).toEqual([
      { label: "Sales after delivery fees", amount: 20 },
      { label: "Food cost", amount: -4 },
    ]);
  });

  it("charges for anyone called in, so the comparison is honest", () => {
    const called = applyToolCall(DEFAULT_CONTROL, { tool: "requestStaff", staffId: "b", startTime: 1200, station: "wok", reason: "Busy" }, "agent", 1020, tiny);
    if (!called.ok) throw new Error(called.error);
    const comparison = compareDays(called.control, tiny);
    // One hour at $10.
    expect(comparison.rows.find((r) => r.label === "Extra labor")?.with).toBe(10);
    expect(comparison.saved).toBe(-10);
  });

  it("the breakdown adds up to the total", () => {
    const fixed = applyToolCall(DEFAULT_CONTROL, { tool: "draftSupplierOrder", supplierId: "butcher", lines: [{ ingredientId: "meat", qty: 10 }] }, "agent", 1020, tiny);
    if (!fixed.ok) throw new Error(fixed.error);
    const comparison = compareDays(fixed.control, tiny);
    expect(comparison.breakdown.reduce((sum, row) => sum + row.amount, 0)).toBeCloseTo(comparison.saved);
  });
});

describe("kitchen metrics, by hand", () => {
  function stateWith(orders: Order[]): SimState {
    return { ...getSimStateAt(DEFAULT_CONTROL, tiny, CLOSE), orders };
  }

  it("counts food left waiting when an order starts on arrival", () => {
    // Placed at 700, cooked by 705, packed in 2.4 minutes, picked up at 730: 22.6 minutes waiting.
    const metrics = measureKitchen(stateWith([order("o1", 700)]), tiny, { firstComeFirstServed: true });
    expect(metrics.foodWaitMinutes).toBe(23);
    expect(metrics.qualityRiskOrders).toBe(1);
    expect(metrics.lateOrders).toBe(0);
  });

  it("waits less when the queue times the start", () => {
    // Starts at 730 − 5 − 5 = 720, cooked by 725, packed by 727.4, picked up at 730.
    const metrics = measureKitchen(stateWith([order("o1", 700)]), tiny);
    expect(metrics.foodWaitMinutes).toBe(3);
    expect(metrics.qualityRiskOrders).toBe(0);
  });

  it("counts late orders and driver wait when packing falls behind", () => {
    // Ten delivery orders all due at the same moment, with one packer at 2.4 minutes each.
    const rush = Array.from({ length: 10 }, (_, i) => order(`d${i}`, 700, "doordash"));
    const metrics = measureKitchen(stateWith(rush), tiny);
    expect(metrics.lateOrders).toBeGreaterThan(0);
    expect(metrics.driverWaitMinutes).toBe(metrics.lateMinutes);
  });

  it("a walk-in being late isn't driver wait", () => {
    const rush = Array.from({ length: 10 }, (_, i) => order(`w${i}`, 700));
    const metrics = measureKitchen(stateWith(rush), tiny);
    expect(metrics.lateOrders).toBeGreaterThan(0);
    expect(metrics.driverWaitMinutes).toBe(0);
  });
});

describe("the replay of the demo Saturday", () => {
  const data = getData();
  const rush: SimControl = { ...DEFAULT_CONTROL, triggers: [makeRushTrigger(1020)] };

  it("is deterministic", () => {
    expect(compareDays(rush, data)).toEqual(compareDays(rush, data));
    const plan = withSuggestedPlan(rush, data);
    expect(compareDays(plan, data)).toEqual(compareDays(plan, data));
  });

  it("uses the suggested plan when nothing was approved, and says so", () => {
    const comparison = compareDays(rush, data);
    expect(comparison.usedSuggestedPlan).toBe(true);
    expect(comparison.decisions.length).toBeGreaterThanOrEqual(2);
  });

  it("suggests each step only once", () => {
    const { decisions } = compareDays(rush, data);
    expect(new Set(decisions).size).toBe(decisions.length);
    expect(decisions.filter((d) => d.startsWith("Add 10 minutes"))).toHaveLength(1);
  });

  it("uses what was approved when something was", () => {
    const approved = applyToolCall(rush, { tool: "requestStaff", staffId: "priya", startTime: 1140, station: "packing", reason: "Short" }, "agent", 1110, data);
    if (!approved.ok) throw new Error(approved.error);
    const comparison = compareDays(approved.control, data);
    expect(comparison.usedSuggestedPlan).toBe(false);
    expect(comparison.decisions).toHaveLength(1);
  });

  it("doesn't change what's on screen for the day itself", () => {
    const before = JSON.stringify(rush);
    compareDays(rush, data);
    expect(JSON.stringify(rush)).toBe(before);
  });

  it("the suggested plan beats doing nothing on a rush, and less food sits", () => {
    const comparison = compareDays(rush, data);
    expect(comparison.saved).toBeGreaterThan(0);
    expect(comparison.with.lostSales).toBeLessThan(comparison.without.lostSales);
    expect(comparison.with.foodWaitMinutes).toBeLessThan(comparison.without.foodWaitMinutes);
    expect(comparison.with.qualityRiskOrders).toBeLessThan(comparison.without.qualityRiskOrders);
  });

  it("a dispute only counts as recovered once it's filed", () => {
    const gap: SimControl = { ...DEFAULT_CONTROL, triggers: [{ type: "payoutGap" }] };
    const unfiled = dayOutcome(gap, data);
    expect(unfiled.payoutMissing).toBeGreaterThan(0);
    const state = getSimStateAt(gap, data, CLOSE);
    const orderIds = state.orders.filter((o) => data.payoutGapOrderIds.includes(o.id)).map((o) => o.id);
    const filed = applyToolCall(gap, { tool: "disputePayout", channel: "doordash", orderIds }, "agent", CLOSE, data);
    if (!filed.ok) throw new Error(filed.error);
    expect(dayOutcome(filed.control, data).payoutMissing).toBe(0);
  });

  it("the recap doesn't recommend what's already been done", () => {
    const gap: SimControl = { ...DEFAULT_CONTROL, triggers: [{ type: "payoutGap" }] };
    const state = getSimStateAt(gap, data, CLOSE);
    expect(templateRecap(closeBooks(state, data)).recommendations.join(" ")).toContain("Ask DoorDash");
    const orderIds = state.orders.filter((o) => data.payoutGapOrderIds.includes(o.id)).map((o) => o.id);
    const filed = applyToolCall(gap, { tool: "disputePayout", channel: "doordash", orderIds }, "agent", CLOSE, data);
    if (!filed.ok) throw new Error(filed.error);
    const after = templateRecap(closeBooks(getSimStateAt(filed.control, data, CLOSE), data));
    expect(after.recommendations.join(" ")).not.toContain("Ask DoorDash");
  });

  it("the recap can mention it without inventing a number", () => {
    const comparison = compareDays(rush, data);
    const summary = {
      ...closeBooks(getSimStateAt(rush, data, CLOSE), data),
      spine: {
        saved: comparison.saved,
        usedSuggestedPlan: comparison.usedSuggestedPlan,
        lostSalesWithout: comparison.without.lostSales,
        lostSalesWith: comparison.with.lostSales,
        foodWaitWithout: comparison.without.foodWaitMinutes,
        foodWaitWith: comparison.with.foodWaitMinutes,
        lateOrdersWith: comparison.with.lateOrders,
        lateOrdersWithout: comparison.without.lateOrders,
      },
    };
    const recap = templateRecap(summary);
    expect(recap.text).toContain("Spine's plan could have kept about");
    expect(hasInventedNumbers(`${recap.text} ${recap.recommendations.join(" ")}`, summary)).toBe(false);
  });
});
