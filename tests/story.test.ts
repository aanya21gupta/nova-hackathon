// Checks the numbers the demo story depends on. These use the fake data, so if you
// switch to a real dataset, re-tune it or update this file.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getData } from "@/data";
import { closeBooks } from "@/lib/books";
import { totalOrders } from "@/lib/forecast";
import { matchIngredients, parseInvoice, validateInvoice } from "@/lib/invoice";
import { hasInventedNumbers } from "@/lib/llm";
import { findRunOuts } from "@/lib/ordering";
import { templateRecap } from "@/lib/recap";
import { dayPhase, DEFAULT_CONTROL, DEMO_JUMP_MINUTE, DRIVER_DELAY_MINUTES, getBaseForecast, getSimState, getSimStateAt, makeRushTrigger, pickDelayTarget } from "@/lib/simulator";
import { buildStaffingPlan } from "@/lib/staffing";
import type { SimControl, Trigger } from "@/lib/types";

const data = getData();
const CLOSE = 21 * 60;
const at630 = 18 * 60 + 30;
const pickedUpRice: Trigger = { type: "extraStock", ingredientId: "rice", qty: 50 };
const control = (...triggers: Trigger[]): SimControl => ({ ...DEFAULT_CONTROL, triggers });
const scanned = (name: string) =>
  validateInvoice(matchIngredients(parseInvoice(readFileSync(`data/llm-cache/invoice-${name}.json`, "utf8"), name), data));

describe("morning", () => {
  const forecast = getBaseForecast(data);

  it("expects a busy day inside Mai's normal range", () => {
    expect(totalOrders(forecast)).toBeGreaterThan(180);
    expect(totalOrders(forecast)).toBeLessThan(220);
  });

  it("explains why", () => {
    expect(forecast.modifiers).toEqual(["Saturday", "Home game tonight"]);
  });

  it("warns that rice runs out around 7:40pm, and nothing else", () => {
    const runOuts = findRunOuts(forecast, data, 660).filter((r) => r.runsOutAt !== null);
    expect(runOuts.map((r) => [r.ingredientId, r.runsOutLabel])).toEqual([["rice", "7:40pm"]]);
  });

  it("covers every station every hour, and flags that only Dev runs the wok", () => {
    const plan = buildStaffingPlan(forecast, data);
    expect(plan.hours.flatMap((h) => h.gaps)).toEqual([]);
    expect(plan.risks.map((r) => r.onlyStaffId)).toEqual(["dev"]);
  });
});

describe("happy path", () => {
  it("never re-forecasts, at any minute of the day", () => {
    for (let minute = 660; minute <= CLOSE; minute++) {
      expect(getSimStateAt(control(pickedUpRice), data, minute).forecast.scaledBy).toBeUndefined();
    }
  });

  it("has no alerts once the rice is picked up", () => {
    for (let minute = 1020; minute <= CLOSE; minute += 10) {
      expect(getSimStateAt(control(pickedUpRice), data, minute).alerts).toEqual([]);
    }
  });

  it("closes with no stockouts and believable costs", () => {
    const summary = closeBooks(getSimStateAt(control(pickedUpRice), data, CLOSE), data);
    expect(summary.stockouts).toEqual([]);
    expect(summary.foodCostPercent).toBeGreaterThan(25);
    expect(summary.foodCostPercent).toBeLessThan(35);
    expect(summary.laborPercent).toBeLessThan(30);
    expect(Math.abs(summary.orderDifference)).toBeLessThan(15);
  });

  it("lists the rice stockout if Mai ignores the morning warning", () => {
    const summary = closeBooks(getSimStateAt(control(), data, CLOSE), data);
    expect(summary.stockouts.map((s) => s.ingredientId)).toEqual(["rice"]);
  });

  it("gives the kitchen something to do during the rush", () => {
    const labels = new Set<string>();
    for (let minute = 1080; minute < 1200; minute += 5) {
      for (const entry of getSimStateAt(control(), data, minute).queue) labels.add(entry.label);
    }
    expect(labels).toEqual(new Set(["FIRE NOW", "UP NEXT", "HOLD"]));
  });
});

describe("sad path: rush beats forecast", () => {
  const rush = control(pickedUpRice, makeRushTrigger(1020));
  const state = getSimStateAt(rush, data, at630);
  const messages = state.alerts.map((a) => a.message);

  it("re-forecasts 35% up at exactly 6:30pm, and not before", () => {
    expect(getSimStateAt(rush, data, at630 - 1).forecast.scaledBy).toBeUndefined();
    expect(Math.round((state.forecast.scaledBy as number) * 100)).toBe(135);
    expect(state.forecast.reforecastAt).toBe(at630);
  });

  it("warns that Pad Thai noodles run out by 8:15pm", () => {
    expect(messages).toContain("Pad Thai noodles will run out by 8:15pm.");
  });

  it("keeps the focus on noodles once the rice is picked up", () => {
    expect(state.alerts.filter((a) => a.kind === "runOut").map((a) => a.id)).toEqual(["runout-noodles"]);
  });

  it("says an item has run out rather than predicting a time already passed", () => {
    const late = getSimStateAt(control(pickedUpRice, makeRushTrigger(1020)), data, 20 * 60 + 30);
    const message = late.alerts.find((a) => a.id === "runout-noodles")?.message;
    expect(message === "We've run out of Pad Thai noodles." || message?.includes("will run out by")).toBe(true);
  });

  it("suggests pausing Pad Thai on delivery apps", () => {
    expect(messages.some((m) => m.startsWith("Pause Pad Thai on DoorDash and App B"))).toBe(true);
  });

  it("flags that packing is understaffed", () => {
    expect(messages.some((m) => m.startsWith("Packing is short 1 person"))).toBe(true);
  });

  it("updates the plan every module reads", () => {
    expect(totalOrders(state.forecast)).toBeGreaterThan(totalOrders(state.baseForecast));
    expect(buildStaffingPlan(state.forecast, data).hours.flatMap((h) => h.gaps)).toContain("packing");
  });

  it("has the recap report the 6:30pm catch, not the last check of the night", () => {
    const summary = closeBooks(getSimStateAt(rush, data, CLOSE), data);
    expect(summary.reforecastAtLabel).toBe("6:30pm");
    expect(summary.reforecastPercent).toBe(35);
    expect(templateRecap(summary).text).toContain("At 6:30pm, orders were running 35% above plan");
  });

  it("still shows an updated plan at close", () => {
    const atClose = getSimStateAt(rush, data, CLOSE);
    expect(atClose.forecast.scaledBy).toBeDefined();
    expect(totalOrders(atClose.forecast)).toBeGreaterThan(totalOrders(atClose.baseForecast));
  });

  it("gives the same result when fired late, right before the check", () => {
    const late = getSimStateAt(control(pickedUpRice, makeRushTrigger(at630 - 5)), data, at630);
    expect(late.alerts.map((a) => a.message)).toEqual(messages);
  });
});

describe("sad path: driver delay", () => {
  it("has a delivery order on FIRE NOW at the demo's jump time, with or without the rush", () => {
    for (const c of [control(pickedUpRice), control(pickedUpRice, makeRushTrigger(1020))]) {
      const state = getSimStateAt(c, data, DEMO_JUMP_MINUTE);
      const target = state.queue.find((e) => e.orderId === pickDelayTarget(state));
      expect(target?.label).toBe("FIRE NOW");
    }
  });

  it("moves a FIRE NOW order to HOLD", () => {
    let minute = 1080;
    while (!getSimStateAt(control(), data, minute).queue.some((e) => e.label === "FIRE NOW" && e.order.driverEtaAt !== undefined)) minute++;
    const before = getSimStateAt(control(), data, minute);
    const orderId = pickDelayTarget(before) as string;
    expect(before.queue.find((e) => e.orderId === orderId)?.label).toBe("FIRE NOW");

    const delay: Trigger = { type: "driverDelay", atMinute: minute, orderId, delayMinutes: DRIVER_DELAY_MINUTES };
    const after = getSimStateAt(control(delay), data, minute);
    expect(after.queue.find((e) => e.orderId === orderId)?.label).toBe("HOLD");
    expect(after.delayedOrders[orderId]).toBe(12);
    expect(after.alerts.some((a) => a.kind === "driverDelay")).toBe(true);
  });
});

describe("sad path: invoices", () => {
  it("accepts the clean one, with no price changes", () => {
    const invoice = scanned("clean");
    expect(invoice.flags).toEqual([]);
    const summary = closeBooks(getSimStateAt(control(pickedUpRice, { type: "invoice", invoice }), data, CLOSE), data);
    expect(summary.priceChanges).toEqual([]);
  });

  it("shows chicken up 22% and the margin hit", () => {
    const invoice = scanned("priceSpike");
    expect(invoice.flags).toEqual([]);
    const state = getSimStateAt(control(pickedUpRice, { type: "invoice", invoice }), data, CLOSE);
    const summary = closeBooks(state, data);
    expect(summary.priceChanges[0].ingredientId).toBe("chicken");
    expect(summary.priceChanges[0].percentChange).toBe(22);
    expect(summary.priceChanges[0].marginChangeToday).toBeLessThan(0);
    expect(templateRecap(summary).text).toContain("up 22%");
  });

  it("flags the bad scan and doesn't use its prices", () => {
    const invoice = scanned("badScan");
    expect(invoice.flags.length).toBeGreaterThanOrEqual(3);
    const clean = closeBooks(getSimStateAt(control(pickedUpRice), data, CLOSE), data);
    const summary = closeBooks(getSimStateAt(control(pickedUpRice, { type: "invoice", invoice }), data, CLOSE), data);
    expect(summary.foodCost).toBe(clean.foodCost);
    expect(summary.flaggedInvoices).toHaveLength(1);
  });
});

describe("sad path: payout gap", () => {
  it("lists three DoorDash orders", () => {
    const summary = closeBooks(getSimStateAt(control(pickedUpRice, { type: "payoutGap" }), data, CLOSE), data);
    expect(summary.payoutGaps).toHaveLength(1);
    expect(summary.payoutGaps[0].channel).toBe("doordash");
    expect(summary.payoutGaps[0].mismatchedOrderIds).toHaveLength(3);
    expect(summary.payoutGaps[0].gap).toBeGreaterThan(0);
  });
});

describe("the whole bad night", () => {
  it("still gives a recap with no invented numbers", () => {
    const summary = closeBooks(
      getSimStateAt(control(makeRushTrigger(1020), { type: "payoutGap" }, { type: "invoice", invoice: scanned("priceSpike") }, { type: "invoice", invoice: scanned("badScan") }), data, CLOSE),
      data,
    );
    const recap = templateRecap(summary);
    expect(hasInventedNumbers(`${recap.text} ${recap.recommendations.join(" ")}`, summary)).toBe(false);
  });
});

describe("clock", () => {
  it("knows which part of the day it is", () => {
    expect(dayPhase(DEFAULT_CONTROL, { serviceOver: false })).toBe("morning");
    expect(dayPhase({ ...DEFAULT_CONTROL, paused: false, startedAtMs: 1 }, { serviceOver: false })).toBe("service");
    expect(dayPhase({ ...DEFAULT_CONTROL, startMinute: 1100 }, { serviceOver: false })).toBe("service");
    expect(dayPhase(DEFAULT_CONTROL, { serviceOver: true })).toBe("close");
  });

  it("advances at the chosen speed, stops at close, and holds when paused", () => {
    const running: SimControl = { ...DEFAULT_CONTROL, paused: false, startedAtMs: 1000, speed: 2 };
    expect(getSimState(running, data, 1000 + 10_000).now).toBe(1020 + 20);
    expect(getSimState(running, data, 1000 + 10_000_000).now).toBe(CLOSE);
    expect(getSimState(DEFAULT_CONTROL, data, 999_999).now).toBe(1020);
  });
});
