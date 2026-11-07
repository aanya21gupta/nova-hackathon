// The action agent. Code computes the facts, and the LLM chooses from the tools and
// explains why. Everything it returns is checked, and bad suggestions are thrown out.
//
// With no AI available, rulePlan() gives a sensible plan for each situation from the same
// facts, so the demo can't fail on a network or API problem.
import { expectedBetween, REFORECAST_CHECK_MINUTES } from "./forecast";
import { CHANNEL_NAMES, formatTime, orderLabel, round2, SKILL_NAMES } from "./format";
import { comparePrices } from "./invoice";
import { buildSupplierOrder, findRunOuts, latestPauseTime } from "./ordering";
import { hasInventedNumbers } from "./numbers";
import { buildStaffingPlan } from "./staffing";
import { actionId } from "./tools";
import type { Channel, Forecast, Minutes, PlannedAction, RestaurantData, SimState, Skill, ToolCall } from "./types";

export type SituationKind = "rush" | "runOut" | "driverDelay" | "payoutGap" | "priceSpike";

export interface Situation {
  id: string;
  kind: SituationKind;
  title: string;
}

const DELIVERY: Channel[] = ["doordash", "appB"];
const SUGGESTED_BUSY_MINUTES = 10;

/** The facts the agent gets. It may only cite numbers and ids found here. */
export interface AgentContext {
  situation: Situation;
  nowMinute: Minutes;
  nowLabel: string;
  closeMinute: Minutes;
  forecastVsActual: { expectedLastHour: number; actualLastHour: number; percentFromPlan: number };
  runOuts: {
    ingredientId: string;
    ingredientName: string;
    runsOutLabel: string;
    usedMostByItemId: string | null;
    usedMostByItemName: string | null;
    /** Latest time to pause that dish on the apps and still last until close. */
    latestSafePauseMinute: Minutes;
    latestSafePauseLabel: string;
    supplierId: string;
    suggestedOrderQty: number;
    unit: string;
  }[];
  menu: { id: string; name: string }[];
  paused: { itemId: string; channels: Channel[] }[];
  staffOffShift: { id: string; name: string; skills: Skill[] }[];
  staffingGaps: { station: Skill; stationName: string; needed: number; scheduled: number; startMinute: Minutes; startLabel: string }[];
  queue: { orderId: string; label: string; startLabel: string; channel: Channel }[];
  delayedOrders: { orderId: string; orderLabel: string; minutes: number }[];
  payoutGaps: { channel: Channel; channelName: string; gap: number; orderIds: string[] }[];
  priceChanges: { ingredientId: string; ingredientName: string; supplierId: string; percentChange: number; newPrice: number; worstDish: string; lossPerPlate: number }[];
  suggestedBusyMinutes: number;
}

function acceptedPriceRises(state: SimState, data: RestaurantData) {
  return state.invoices.filter((i) => i.flags.length === 0).flatMap((invoice) => comparePrices(invoice, data).filter((c) => c.percentChange > 0));
}

/** What needs a plan right now. Stable ids, so a plan isn't re-requested every minute. */
export function findSituations(state: SimState, data: RestaurantData): Situation[] {
  const situations: Situation[] = [];
  if ((state.forecast.scaledBy ?? 1) > 1) {
    situations.push({ id: "rush", kind: "rush", title: "Orders are beating the forecast" });
  } else {
    for (const alert of state.alerts) {
      if (alert.kind === "runOut") {
        situations.push({ id: alert.id, kind: "runOut", title: `${String(alert.facts.ingredient)} will run out today` });
      }
    }
  }
  for (const [orderId] of Object.entries(state.delayedOrders)) {
    if (state.queue.some((e) => e.orderId === orderId)) {
      situations.push({ id: `delay-${orderId}`, kind: "driverDelay", title: `A driver is late for order ${orderLabel(orderId)}` });
    }
  }
  for (const change of acceptedPriceRises(state, data)) {
    situations.push({ id: `price-${change.ingredientId}`, kind: "priceSpike", title: `${change.ingredientName} went up ${change.percentChange}%` });
  }
  if (state.payoutGapActive && state.serviceOver) {
    situations.push({ id: "payout", kind: "payoutGap", title: "A delivery payout came up short" });
  }
  return situations;
}

function biggestUser(ingredientId: string, forecast: Forecast, data: RestaurantData) {
  let best: { id: string; name: string } | null = null;
  let bestUse = 0;
  for (const item of data.menu) {
    const line = item.recipe.find((r) => r.ingredientId === ingredientId);
    if (!line) continue;
    const use = forecast.hourly.reduce((sum, h) => sum + (h.byItem[item.id] ?? 0), 0) * line.qty;
    if (use > bestUse) {
      best = { id: item.id, name: item.name };
      bestUse = use;
    }
  }
  return best;
}

export function buildAgentContext(situation: Situation, state: SimState, data: RestaurantData, options: { morningView?: boolean } = {}): AgentContext {
  const { now, forecast } = state;
  const stock = state.effectiveData;
  const checkAt = Math.floor(now / REFORECAST_CHECK_MINUTES) * REFORECAST_CHECK_MINUTES;
  const expected = expectedBetween(state.baseForecast, checkAt - 60, checkAt);
  const actual = state.placed.filter((o) => o.placedAt > checkAt - 60 && o.placedAt <= checkAt).length;

  const supplierLines = buildSupplierOrder(forecast, stock, 2);
  const runOuts = (options.morningView ? findRunOuts(forecast, stock, data.openHour * 60) : findRunOuts(forecast, stock, checkAt, state.orders))
    .filter((r) => r.runsOutAt !== null)
    .map((r) => {
      const ingredient = stock.ingredients.find((i) => i.id === r.ingredientId);
      const item = biggestUser(r.ingredientId, forecast, data);
      // Worked out from the same check as the run-out time, and never earlier than now.
      const latest = Math.max(item ? latestPauseTime(forecast, stock, r.ingredientId, item.id, DELIVERY, checkAt, state.orders) : now, now);
      const line = supplierLines.find((l) => l.ingredientId === r.ingredientId);
      return {
        ingredientId: r.ingredientId,
        ingredientName: r.ingredientName,
        runsOutLabel: r.runsOutLabel ?? "",
        usedMostByItemId: item?.id ?? null,
        usedMostByItemName: item?.name ?? null,
        latestSafePauseMinute: latest,
        latestSafePauseLabel: formatTime(latest),
        supplierId: ingredient?.supplierId ?? "",
        suggestedOrderQty: line?.qty ?? ingredient?.packSize ?? 1,
        unit: ingredient?.unit ?? "",
      };
    });

  const close = data.closeHour * 60;
  const staffOffShift = stock.staff
    .filter((s) => !s.availability.some((shift) => shift.start <= now && shift.end > now))
    .filter((s) => !s.availability.some((shift) => shift.start >= now && shift.start < close))
    .map((s) => ({ id: s.id, name: s.name, skills: s.skills }));

  const remaining = buildStaffingPlan(forecast, stock).hours.filter((h) => (h.hour + 1) * 60 > now);
  const staffingGaps: AgentContext["staffingGaps"] = [];
  for (const station of ["wok", "fryer", "packing", "register"] as Skill[]) {
    const short = remaining.filter((h) => h.gaps.includes(station));
    if (short.length === 0) continue;
    const startMinute = Math.max(short[0].hour * 60, now);
    staffingGaps.push({
      station,
      stationName: SKILL_NAMES[station],
      needed: short[0].required[station],
      scheduled: short[0].scheduled[station],
      startMinute,
      startLabel: formatTime(startMinute),
    });
  }

  const summaryGaps = state.payoutGapActive
    ? (["doordash", "appB", "direct"] as Channel[]).flatMap((channel) => {
        const orders = state.orders.filter((o) => o.channel === channel && data.payoutGapOrderIds.includes(o.id));
        if (orders.length === 0) return [];
        const feeReport = data.payouts.find((p) => p.channel === channel);
        const keepRate = feeReport && feeReport.grossSales > 0 ? 1 - feeReport.fees / feeReport.grossSales : 1;
        const gross = orders.reduce((sum, o) => sum + o.items.reduce((s, l) => s + (data.menu.find((m) => m.id === l.menuItemId)?.price ?? 0) * l.qty, 0), 0);
        return [{ channel, channelName: CHANNEL_NAMES[channel], gap: round2(gross * keepRate), orderIds: orders.map((o) => o.id) }];
      })
    : [];

  return {
    situation,
    nowMinute: now,
    nowLabel: formatTime(now),
    closeMinute: close,
    forecastVsActual: {
      expectedLastHour: Math.round(expected),
      actualLastHour: actual,
      percentFromPlan: forecast.scaledBy === undefined ? 0 : Math.round((forecast.scaledBy - 1) * 100),
    },
    runOuts,
    menu: data.menu.map((m) => ({ id: m.id, name: m.name })),
    paused: state.pausedItems.map((p) => ({ itemId: p.itemId, channels: p.channels })),
    staffOffShift,
    staffingGaps,
    queue: state.queue.slice(0, 12).map((e) => ({ orderId: e.orderId, label: e.label, startLabel: formatTime(e.startAt), channel: e.order.channel })),
    delayedOrders: Object.entries(state.delayedOrders).map(([orderId, minutes]) => ({ orderId, orderLabel: orderLabel(orderId), minutes })),
    payoutGaps: summaryGaps,
    priceChanges: acceptedPriceRises(state, data).map((c) => {
      const worst = [...c.affectedDishes].sort((a, b) => a.marginChangePerDish - b.marginChangePerDish)[0];
      return {
        ingredientId: c.ingredientId,
        ingredientName: c.ingredientName,
        supplierId: data.ingredients.find((i) => i.id === c.ingredientId)?.supplierId ?? "",
        percentChange: c.percentChange,
        newPrice: c.newPrice,
        worstDish: worst?.name ?? "",
        lossPerPlate: Math.abs(worst?.marginChangePerDish ?? 0),
      };
    }),
    suggestedBusyMinutes: SUGGESTED_BUSY_MINUTES,
  };
}

function planned(call: ToolCall, reason: string): PlannedAction {
  return { id: actionId(call), call, reason };
}

/** The non-AI plan for each situation, built only from the context. */
export function rulePlan(ctx: AgentContext): PlannedAction[] {
  const plan: PlannedAction[] = [];

  if (ctx.situation.kind === "rush") {
    for (const r of ctx.runOuts) {
      const alreadyPaused = ctx.paused.some((p) => p.itemId === r.usedMostByItemId);
      if (r.usedMostByItemId && !alreadyPaused && plan.length < 2) {
        const later = r.latestSafePauseMinute > ctx.nowMinute;
        plan.push(
          planned(
            { tool: "pauseItem", itemId: r.usedMostByItemId, channels: DELIVERY, fromMinute: later ? r.latestSafePauseMinute : undefined },
            `${r.ingredientName} will run out by ${r.runsOutLabel}. Pausing ${r.usedMostByItemName} on the apps at ${r.latestSafePauseLabel} keeps it selling as long as possible and saves enough for walk-ins.`,
          ),
        );
      }
    }
    for (const gap of ctx.staffingGaps) {
      const backup = ctx.staffOffShift.find((s) => s.skills.includes(gap.station));
      if (backup) {
        plan.push(
          planned(
            { tool: "requestStaff", staffId: backup.id, startTime: gap.startMinute, station: gap.station, reason: `${gap.stationName} needs ${gap.needed} and has ${gap.scheduled}.` },
            `${gap.stationName} needs ${gap.needed} people from ${gap.startLabel} and has ${gap.scheduled}. ${backup.name} is off shift and can do it.`,
          ),
        );
      }
    }
    plan.push(
      planned(
        { tool: "setBusyMode", channel: "all", extraMinutes: ctx.suggestedBusyMinutes, untilTime: ctx.closeMinute },
        `Orders are ${ctx.forecastVsActual.percentFromPlan}% above plan, so promising ${ctx.suggestedBusyMinutes} more minutes keeps customers and drivers from waiting.`,
      ),
    );
    const firstRunOut = ctx.runOuts[0];
    if (firstRunOut && plan.length < 4) {
      plan.push(
        planned(
          { tool: "draftSupplierOrder", supplierId: firstRunOut.supplierId, lines: [{ ingredientId: firstRunOut.ingredientId, qty: firstRunOut.suggestedOrderQty }] },
          `Tonight used more ${firstRunOut.ingredientName.toLowerCase()} than planned, so this restocks it for tomorrow.`,
        ),
      );
    }
  }

  if (ctx.situation.kind === "runOut") {
    const target = ctx.runOuts.find((r) => `runout-${r.ingredientId}` === ctx.situation.id) ?? ctx.runOuts[0];
    if (target) {
      plan.push(
        planned(
          { tool: "draftSupplierOrder", supplierId: target.supplierId, lines: [{ ingredientId: target.ingredientId, qty: target.suggestedOrderQty }] },
          `${target.ingredientName} runs out around ${target.runsOutLabel} at this pace. This is enough to last, plus your safety stock.`,
        ),
      );
    }
  }

  if (ctx.situation.kind === "driverDelay") {
    const delayed = ctx.delayedOrders.find((d) => `delay-${d.orderId}` === ctx.situation.id);
    if (delayed) {
      plan.push(
        planned(
          { tool: "holdOrder", orderId: delayed.orderId },
          `The driver for ${delayed.orderLabel} is ${delayed.minutes} minutes late, so starting it now would leave the food sitting.`,
        ),
      );
      const next = ctx.queue.find((e) => e.orderId !== delayed.orderId && e.label === "UP NEXT");
      if (next) {
        plan.push(
          planned(
            { tool: "fireOrder", orderId: next.orderId },
            `${delayed.orderLabel} freed up a slot, so ${orderLabel(next.orderId)} can start now instead of ${next.startLabel}.`,
          ),
        );
      }
    }
  }

  if (ctx.situation.kind === "payoutGap") {
    for (const gap of ctx.payoutGaps) {
      plan.push(
        planned(
          { tool: "disputePayout", channel: gap.channel, orderIds: gap.orderIds },
          `${gap.channelName} paid $${gap.gap.toFixed(2)} less than sales minus fees. These are the orders that don't match.`,
        ),
      );
    }
  }

  if (ctx.situation.kind === "priceSpike") {
    const change = ctx.priceChanges.find((c) => `price-${c.ingredientId}` === ctx.situation.id);
    if (change) {
      plan.push(
        planned(
          { tool: "requestQuote", supplierId: change.supplierId, ingredientId: change.ingredientId },
          `${change.ingredientName} went up ${change.percentChange}% to $${change.newPrice.toFixed(2)}, and ${change.worstDish} keeps $${change.lossPerPlate.toFixed(2)} less a plate.`,
        ),
      );
    }
  }

  return plan;
}

export interface RejectedSuggestion {
  suggestion: string;
  why: string;
}

/** Checks a suggestion against the facts the agent was given. Returns what's wrong, or null. */
function checkAgainstContext(call: ToolCall, ctx: AgentContext): string | null {
  const itemIds = new Set(ctx.menu.map((m) => m.id));
  const orderIds = new Set(ctx.queue.map((e) => e.orderId));
  switch (call?.tool) {
    case "pauseItem":
    case "resumeItem":
      if (!itemIds.has(call.itemId)) return `"${call.itemId}" isn't on the menu.`;
      if (!Array.isArray(call.channels) || call.channels.length === 0) return "It didn't say which channels.";
      if (call.tool === "pauseItem" && call.fromMinute !== undefined && (call.fromMinute < ctx.nowMinute || call.fromMinute > ctx.closeMinute)) {
        return "That time is outside tonight's service.";
      }
      return null;
    case "setBusyMode":
      if (typeof call.extraMinutes !== "number" || call.extraMinutes < 1 || call.extraMinutes > 60) return "That amount of extra time isn't sensible.";
      if (call.untilTime <= ctx.nowMinute || call.untilTime > ctx.closeMinute) return "That time is outside tonight's service.";
      return null;
    case "requestStaff": {
      const person = ctx.staffOffShift.find((s) => s.id === call.staffId);
      if (!person) return `"${call.staffId}" isn't an off-shift staff member.`;
      if (!person.skills.includes(call.station)) return `${person.name} can't work ${call.station}.`;
      if (call.startTime < ctx.nowMinute || call.startTime >= ctx.closeMinute) return "That time is outside tonight's service.";
      return null;
    }
    case "draftSupplierOrder": {
      if (!Array.isArray(call.lines) || call.lines.length === 0) return "The order was empty.";
      // Quantities come from the ordering logic, never from the AI.
      for (const line of call.lines) {
        const known = ctx.runOuts.find((r) => r.ingredientId === line.ingredientId && r.supplierId === call.supplierId);
        if (!known) return `"${line.ingredientId}" from "${call.supplierId}" isn't something that needs ordering.`;
        if (line.qty !== known.suggestedOrderQty) return `The order amount has to come from the ordering logic (${known.suggestedOrderQty} ${known.unit}), not the AI.`;
      }
      return null;
    }
    case "holdOrder":
    case "fireOrder":
    case "markOrderReady":
      return orderIds.has(call.orderId) ? null : `Order "${call.orderId}" isn't in the queue.`;
    case "disputePayout":
      return ctx.payoutGaps.some((g) => g.channel === call.channel) ? null : "There's no payout gap on that channel.";
    case "requestQuote":
      return ctx.priceChanges.some((c) => c.ingredientId === call.ingredientId) ? null : "That ingredient's price didn't change.";
    default:
      return `Spine doesn't have a tool called "${(call as { tool?: string })?.tool}".`;
  }
}

export interface AgentPlanResult {
  plan: PlannedAction[];
  rejected: RejectedSuggestion[];
}

const MAX_PLAN_ACTIONS = 4;

/** Keeps only what passes every check, and records why the rest were thrown out. */
export function validatePlan(raw: { call: ToolCall; reason: string }[], ctx: AgentContext): AgentPlanResult {
  const plan: PlannedAction[] = [];
  const rejected: RejectedSuggestion[] = [];
  for (const entry of raw) {
    const name = `${entry.call?.tool ?? "unknown"}: ${JSON.stringify(entry.call ?? {}).slice(0, 110)}`;
    const why = checkAgainstContext(entry.call, ctx);
    if (why) {
      rejected.push({ suggestion: name, why });
      continue;
    }
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
      rejected.push({ suggestion: name, why: "It didn't give a reason." });
      continue;
    }
    if (hasInventedNumbers(entry.reason, ctx)) {
      rejected.push({ suggestion: name, why: `Its reason used a number that isn't in the data: "${entry.reason.slice(0, 90)}"` });
      continue;
    }
    if (plan.length < MAX_PLAN_ACTIONS && !plan.some((p) => p.id === actionId(entry.call))) {
      plan.push({ id: actionId(entry.call), call: entry.call, reason: entry.reason });
    }
  }
  return { plan, rejected };
}

/** Demo only: a suggestion that should never get through, to show the check working. */
export const BAD_SUGGESTION: { call: ToolCall; reason: string } = {
  call: { tool: "pauseItem", itemId: "lobster-thermidor", channels: ["doordash"] },
  reason: "Lobster thermidor is selling 400% above plan, so pausing it saves $9,000.",
};

/** Turns the LLM's JSON into calls. Anything malformed is reported by validatePlan. */
export function parseAgentPlan(raw: string): { call: ToolCall; reason: string }[] {
  const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""));
  if (!Array.isArray(parsed.plan)) throw new Error("No plan in the response");
  return parsed.plan.map((entry: { tool: string; args?: Record<string, unknown>; reason: string }) => ({
    call: { tool: entry.tool, ...(entry.args ?? {}) } as ToolCall,
    reason: entry.reason,
  }));
}
