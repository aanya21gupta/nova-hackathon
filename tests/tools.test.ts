import { describe, expect, it } from "vitest";
import { getData } from "@/data";
import { BAD_SUGGESTION, buildAgentContext, findSituations, rulePlan, validatePlan, type Situation } from "@/lib/agent";
import { hasInventedNumbers } from "@/lib/numbers";
import { findRunOuts } from "@/lib/ordering";
import { predictAction } from "@/lib/outcomes";
import { buildPrepList } from "@/lib/prep";
import { DEFAULT_CONTROL, getSimStateAt, makeRushTrigger } from "@/lib/simulator";
import { buildStaffingPlan } from "@/lib/staffing";
import { applyToolCall } from "@/lib/tools";
import type { SimControl, ToolCall } from "@/lib/types";

const data = getData();
const at630 = 18 * 60 + 30;
const CLOSE = 21 * 60;
const started: SimControl = { ...DEFAULT_CONTROL, startMinute: at630 };
const rush: SimControl = { ...started, triggers: [makeRushTrigger(1020)] };

function apply(control: SimControl, call: ToolCall, now = at630): SimControl {
  const result = applyToolCall(control, call, "agent", now, data);
  if (!result.ok) throw new Error(result.error);
  return result.control;
}

function firstQueued(control: SimControl, label: string, now = at630) {
  return getSimStateAt(control, data, now).queue.find((e) => e.label === label);
}

describe("pauseItem and resumeItem", () => {
  const call: ToolCall = { tool: "pauseItem", itemId: "pad-thai", channels: ["doordash", "appB"] };

  it("stops delivery orders for the item but not walk-ins", () => {
    const state = getSimStateAt(apply(rush, call), data, CLOSE);
    const padThaiAfter = state.orders.filter((o) => o.placedAt >= at630 && o.items.some((l) => l.menuItemId === "pad-thai"));
    expect(padThaiAfter.length).toBeGreaterThan(0);
    expect(padThaiAfter.every((o) => o.channel === "direct")).toBe(true);
  });

  it("zeroes the forecast on those channels, so run-out and prep recompute", () => {
    const before = getSimStateAt(rush, data, at630);
    const after = getSimStateAt(apply(rush, call), data, at630);
    const hour = (f: typeof before.forecast) => f.hourly.find((h) => h.hour === 19) as (typeof f.hourly)[number];
    expect(hour(after.forecast).byItem["pad-thai"]).toBeLessThan(hour(before.forecast).byItem["pad-thai"]);
    const noodles = (s: typeof before) => findRunOuts(s.forecast, s.effectiveData, s.now, s.orders).find((r) => r.ingredientId === "noodles");
    expect(noodles(before)?.runsOutAt).not.toBeNull();
    expect(noodles(after)?.runsOutAt).toBeNull();
    expect(buildPrepList(after.forecast, data)).not.toEqual(buildPrepList(before.forecast, data));
  });

  it("records the before and after", () => {
    const result = applyToolCall(rush, call, "agent", at630, data);
    expect(result.ok && result.action.beforeAfter).toBe("Pad Thai noodles run-out: 8:15pm → no run-out today");
  });

  it("writes labeled mock calls", () => {
    const result = applyToolCall(rush, call, "agent", at630, data);
    expect(result.ok && result.action.mockCalls[0]).toContain("DoorDash Merchant API (mock)");
    expect(result.ok && result.action.mockCalls[1]).toContain("App B API (mock)");
  });

  it("can start later, and only affects orders from then on", () => {
    const state = getSimStateAt(apply(rush, { ...call, fromMinute: 20 * 60 } as ToolCall), data, CLOSE);
    const delivered = state.orders.filter((o) => o.channel !== "direct" && o.items.some((l) => l.menuItemId === "pad-thai"));
    expect(delivered.some((o) => o.placedAt > at630)).toBe(true);
    expect(delivered.every((o) => o.placedAt < 20 * 60)).toBe(true);
  });

  it("resuming puts it back on sale", () => {
    const paused = apply(rush, call);
    const resumed = apply(paused, { tool: "resumeItem", itemId: "pad-thai", channels: ["doordash", "appB"] }, at630 + 30);
    expect(getSimStateAt(resumed, data, at630 + 30).pausedItems).toEqual([]);
    const later = getSimStateAt(resumed, data, CLOSE).orders.filter((o) => o.placedAt > at630 + 30 && o.channel !== "direct");
    expect(later.some((o) => o.items.some((l) => l.menuItemId === "pad-thai"))).toBe(true);
  });
});

describe("setBusyMode", () => {
  it("pushes back new orders only, and the queue re-sorts", () => {
    const busy = apply(started, { tool: "setBusyMode", channel: "all", extraMinutes: 10, untilTime: CLOSE });
    const before = getSimStateAt(started, data, at630 + 15);
    const after = getSimStateAt(busy, data, at630 + 15);
    const newOrder = before.orders.find((o) => o.placedAt > at630) as (typeof before.orders)[number];
    const oldOrder = before.orders.find((o) => o.placedAt < at630) as (typeof before.orders)[number];
    expect(after.orders.find((o) => o.id === newOrder.id)?.targetReadyAt).toBe(newOrder.targetReadyAt + 10);
    expect(after.orders.find((o) => o.id === oldOrder.id)?.targetReadyAt).toBe(oldOrder.targetReadyAt);
  });

  it("can apply to one channel", () => {
    const busy = apply(started, { tool: "setBusyMode", channel: "doordash", extraMinutes: 10, untilTime: CLOSE });
    const before = getSimStateAt(started, data, at630 + 30);
    const after = getSimStateAt(busy, data, at630 + 30);
    const walkIn = before.orders.find((o) => o.placedAt > at630 && o.channel === "direct") as (typeof before.orders)[number];
    expect(after.orders.find((o) => o.id === walkIn.id)?.targetReadyAt).toBe(walkIn.targetReadyAt);
  });
});

describe("requestStaff", () => {
  it("updates coverage and adds their wages", () => {
    const before = getSimStateAt(rush, data, at630);
    const after = getSimStateAt(apply(rush, { tool: "requestStaff", staffId: "priya", startTime: 19 * 60, station: "packing", reason: "Short" }), data, at630);
    expect(buildStaffingPlan(before.forecast, before.effectiveData).hours.flatMap((h) => h.gaps)).toContain("packing");
    expect(buildStaffingPlan(after.forecast, after.effectiveData).hours.flatMap((h) => h.gaps)).not.toContain("packing");
  });
});

describe("draftSupplierOrder", () => {
  const call: ToolCall = { tool: "draftSupplierOrder", supplierId: "thai-harvest", lines: [{ ingredientId: "rice", qty: 50 }] };

  it("before service, the stock arrives today and fixes the run-out", () => {
    const state = getSimStateAt(apply(DEFAULT_CONTROL, call, 1020), data, CLOSE);
    expect(state.stockouts).toEqual([]);
  });

  it("during service, it's for tomorrow", () => {
    const state = getSimStateAt(apply(started, call), data, CLOSE);
    expect(state.stockouts.map((s) => s.ingredientId)).toContain("rice");
  });

  it("is labeled as a draft", () => {
    const result = applyToolCall(started, call, "agent", at630, data);
    expect(result.ok && result.action.mockCalls[0]).toContain("Supplier email (draft)");
  });
});

describe("holdOrder, fireOrder and markOrderReady", () => {
  it("hold moves an order from FIRE NOW to HOLD", () => {
    const now = 18 * 60 + 20;
    const control: SimControl = { ...DEFAULT_CONTROL, startMinute: now };
    const entry = firstQueued(control, "FIRE NOW", now);
    const held = apply(control, { tool: "holdOrder", orderId: entry?.orderId as string }, now);
    expect(getSimStateAt(held, data, now).queue.find((e) => e.orderId === entry?.orderId)?.label).toBe("HOLD");
  });

  it("fire moves an order from HOLD to FIRE NOW", () => {
    const now = 18 * 60 + 20;
    const control: SimControl = { ...DEFAULT_CONTROL, startMinute: now };
    const entry = firstQueued(control, "HOLD", now);
    const fired = apply(control, { tool: "fireOrder", orderId: entry?.orderId as string }, now);
    expect(getSimStateAt(fired, data, now).queue.find((e) => e.orderId === entry?.orderId)?.label).toBe("FIRE NOW");
  });

  it("firing a held order releases the hold", () => {
    const now = 18 * 60 + 20;
    const control: SimControl = { ...DEFAULT_CONTROL, startMinute: now };
    const entry = firstQueued(control, "HOLD", now);
    const held = apply(control, { tool: "holdOrder", orderId: entry?.orderId as string }, now);
    const fired = apply(held, { tool: "fireOrder", orderId: entry?.orderId as string }, now);
    expect(getSimStateAt(fired, data, now).queue.find((e) => e.orderId === entry?.orderId)?.label).toBe("FIRE NOW");
  });

  it("ready takes an order off the queue", () => {
    const now = 18 * 60 + 20;
    const control: SimControl = { ...DEFAULT_CONTROL, startMinute: now };
    const entry = firstQueued(control, "FIRE NOW", now);
    const ready = apply(control, { tool: "markOrderReady", orderId: entry?.orderId as string }, now);
    const state = getSimStateAt(ready, data, now);
    expect(state.queue.some((e) => e.orderId === entry?.orderId)).toBe(false);
    expect(state.orders.find((o) => o.id === entry?.orderId)?.status).toBe("ready");
  });
});

describe("invalid calls are rejected", () => {
  const bad: [string, ToolCall][] = [
    ["a dish that doesn't exist", { tool: "pauseItem", itemId: "lobster", channels: ["doordash"] }],
    ["no channels", { tool: "pauseItem", itemId: "pad-thai", channels: [] }],
    ["a made-up channel", { tool: "pauseItem", itemId: "pad-thai", channels: ["ubereats" as never] }],
    ["a pause time in the past", { tool: "pauseItem", itemId: "pad-thai", channels: ["doordash"], fromMinute: 600 }],
    ["resuming something not paused", { tool: "resumeItem", itemId: "pad-thai", channels: ["doordash"] }],
    ["zero busy minutes", { tool: "setBusyMode", channel: "all", extraMinutes: 0, untilTime: CLOSE }],
    ["too many busy minutes", { tool: "setBusyMode", channel: "all", extraMinutes: 500, untilTime: CLOSE }],
    ["busy mode ending in the past", { tool: "setBusyMode", channel: "all", extraMinutes: 10, untilTime: 600 }],
    ["busy mode past close", { tool: "setBusyMode", channel: "all", extraMinutes: 10, untilTime: 2000 }],
    ["staff who don't exist", { tool: "requestStaff", staffId: "ghost", startTime: 1140, station: "packing", reason: "x" }],
    ["staff without the skill", { tool: "requestStaff", staffId: "priya", startTime: 1140, station: "wok", reason: "x" }],
    ["staff already working", { tool: "requestStaff", staffId: "sam", startTime: 1140, station: "packing", reason: "x" }],
    ["a supplier that doesn't exist", { tool: "draftSupplierOrder", supplierId: "nobody", lines: [{ ingredientId: "rice", qty: 1 }] }],
    ["an ingredient from the wrong supplier", { tool: "draftSupplierOrder", supplierId: "valley-meats", lines: [{ ingredientId: "rice", qty: 1 }] }],
    ["a negative amount", { tool: "draftSupplierOrder", supplierId: "thai-harvest", lines: [{ ingredientId: "rice", qty: -5 }] }],
    ["an order that doesn't exist", { tool: "holdOrder", orderId: "o9999" }],
    ["firing an order that doesn't exist", { tool: "fireOrder", orderId: "o9999" }],
    ["a payout dispute with no gap", { tool: "disputePayout", channel: "doordash", orderIds: ["o1"] }],
    ["a tool that doesn't exist", { tool: "deleteEverything" } as unknown as ToolCall],
  ];

  it.each(bad)("%s", (_name, call) => {
    const result = applyToolCall(started, call, "agent", at630, data);
    expect(result.ok).toBe(false);
  });

  it("a rejected call doesn't change anything", () => {
    const result = applyToolCall(started, bad[0][1], "agent", at630, data);
    expect(result.ok).toBe(false);
    expect(started.actions).toEqual([]);
  });

  it("can't pause the same thing twice", () => {
    const call: ToolCall = { tool: "pauseItem", itemId: "pad-thai", channels: ["doordash"] };
    expect(applyToolCall(apply(started, call), call, "agent", at630, data).ok).toBe(false);
  });
});

describe("the agent", () => {
  const state = getSimStateAt(rush, data, at630);
  const situation = findSituations(state, data).find((s) => s.kind === "rush") as Situation;
  const context = buildAgentContext(situation, state, data);
  const plan = rulePlan(context);

  it("plans 2 to 4 actions for the rush", () => {
    expect(plan.length).toBeGreaterThanOrEqual(2);
    expect(plan.length).toBeLessThanOrEqual(4);
  });

  it("every action in the rule plan is valid and can be applied", () => {
    let control = rush;
    for (const action of plan) control = apply(control, action.call);
    expect(control.actions).toHaveLength(plan.length);
  });

  it("every reason only cites numbers from the state", () => {
    for (const action of plan) expect(hasInventedNumbers(action.reason, context)).toBe(false);
  });

  it("the rule plan passes its own validation", () => {
    const result = validatePlan(plan.map((p) => ({ call: p.call, reason: p.reason })), context);
    expect(result.rejected).toEqual([]);
    expect(result.plan).toHaveLength(plan.length);
  });

  it("rejects a made-up dish", () => {
    const result = validatePlan([BAD_SUGGESTION], context);
    expect(result.plan).toEqual([]);
    expect(result.rejected[0].why).toContain("isn't on the menu");
  });

  it("rejects a reason with an invented number, even on a valid call", () => {
    const result = validatePlan([{ call: plan[0].call, reason: "This saves $9,999 tonight." }], context);
    expect(result.plan).toEqual([]);
    expect(result.rejected[0].why).toContain("isn't in the data");
  });

  it("rejects an order amount the ordering logic didn't produce", () => {
    const run = context.runOuts[0];
    const call: ToolCall = { tool: "draftSupplierOrder", supplierId: run.supplierId, lines: [{ ingredientId: run.ingredientId, qty: 99999 }] };
    expect(validatePlan([{ call, reason: "More." }], context).plan).toEqual([]);
  });

  it("checks every line of a supplier order, not just the first", () => {
    const run = context.runOuts[0];
    const call: ToolCall = {
      tool: "draftSupplierOrder",
      supplierId: run.supplierId,
      lines: [{ ingredientId: run.ingredientId, qty: run.suggestedOrderQty }, { ingredientId: run.ingredientId, qty: 99999 }],
    };
    expect(validatePlan([{ call, reason: "More." }], context).plan).toEqual([]);
  });

  it("rejects staff who aren't off shift", () => {
    const call: ToolCall = { tool: "requestStaff", staffId: "sam", startTime: 1140, station: "packing", reason: "x" };
    expect(validatePlan([{ call, reason: "More." }], context).plan).toEqual([]);
  });

  it("has a plan for each sad path", () => {
    const delay = getSimStateAt({ ...started, startMinute: 1100, triggers: [{ type: "driverDelay", atMinute: 1100, orderId: "o100", delayMinutes: 12 }] }, data, 1100);
    const delaySituation = findSituations(delay, data).find((s) => s.kind === "driverDelay") as Situation;
    expect(rulePlan(buildAgentContext(delaySituation, delay, data)).map((p) => p.call.tool)).toContain("holdOrder");

    const gap = getSimStateAt({ ...started, triggers: [{ type: "payoutGap" }] }, data, CLOSE);
    const gapSituation = findSituations(gap, data).find((s) => s.kind === "payoutGap") as Situation;
    expect(rulePlan(buildAgentContext(gapSituation, gap, data)).map((p) => p.call.tool)).toEqual(["disputePayout"]);

    const morning = getSimStateAt(DEFAULT_CONTROL, data, 1020);
    const runOut = findSituations(morning, data).find((s) => s.kind === "runOut") as Situation;
    expect(rulePlan(buildAgentContext(runOut, morning, data)).map((p) => p.call.tool)).toEqual(["draftSupplierOrder"]);
  });

  it("tests each action in a replay before it's shown", () => {
    const pause = plan.find((p) => p.call.tool === "pauseItem");
    const prediction = predictAction(rush, pause?.call as ToolCall, at630, data);
    expect(prediction?.summary).toBeTruthy();
    expect(prediction?.lostSalesDifference).toBeLessThanOrEqual(0);
  });
});
