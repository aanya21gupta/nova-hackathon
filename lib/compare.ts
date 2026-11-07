// "What Spine changed today": the same day, the same customers, replayed twice.
// Our simulator gives the same result every run, so the only differences are the decisions.
import { buildAgentContext, findSituations, rulePlan } from "./agent";
import { round2 } from "./format";
import { QUALITY_RISK_MINUTES } from "./kitchenRun";
import { dayOutcome, type DayOutcome } from "./outcomes";
import { DEFAULT_CONTROL, getSimStateAt, NOTICE_MINUTES } from "./simulator";
import { actionId, applyToolCall } from "./tools";
import type { RestaurantData, SimControl } from "./types";

const CHECK_MINUTES = 30;
const PRE_OPEN_LEAD_MINUTES = 30;

export interface ComparisonRow {
  label: string;
  without: number;
  with: number;
  unit: "money" | "count" | "minutes";
  /** Footnote: where the number comes from. */
  source: string;
}

export interface Comparison {
  without: DayOutcome;
  with: DayOutcome;
  /** Net estimated dollars: money kept with Spine minus money kept without it. */
  saved: number;
  /** Where the difference came from. These add up to `saved`. */
  breakdown: { label: string; amount: number }[];
  rows: ComparisonRow[];
  /** True if nothing was approved, so "with" is the agent's suggested plan. */
  usedSuggestedPlan: boolean;
  /** What the "with" day did, in plain English. */
  decisions: string[];
}

/** Shown on screen, because the result is only as good as these. */
export const FORMULA = "Money kept = sales − delivery fees − food cost − wages − payout money still missing";

export const ASSUMPTIONS = [
  "Both days have the same customers and the same surprises. Only the decisions differ.",
  "Without Spine, cooks start each order when it comes in, and nobody acts ahead of time: no extra stock, no paused dishes, nobody called in.",
  `After something runs out, the apps keep selling it for ${NOTICE_MINUTES} minutes until someone notices. Those orders are cancelled and refunded.`,
  "When a customer can see a dish isn't available, half pick another dish and half skip it.",
  "Cooking capacity isn't limited in this model, only packing. That's why starting every order on arrival shows few late orders, and why its cost shows up as food left waiting.",
  "A disputed payout is counted as paid in full, though that could take days and isn't guaranteed.",
  "Late orders and food left waiting are shown, but aren't given a dollar value.",
  "This is a simulated day with synthetic data.",
];

/** The day without any Spine actions. Sad-path events still happen. */
function withoutSpine(control: SimControl): SimControl {
  return { ...control, actions: [], skipped: [] };
}

/**
 * What the agent would have done with every plan approved as it came up. Walks the day one
 * check at a time, the way it would have played out.
 */
export function withSuggestedPlan(control: SimControl, data: RestaurantData): SimControl {
  const close = data.closeHour * 60;
  const first = data.openHour * 60 - PRE_OPEN_LEAD_MINUTES;
  let current: SimControl = { ...control, actions: [], paused: true, startedAtMs: null, startMinute: DEFAULT_CONTROL.startMinute };
  // A step is suggested once, the same as a plan on screen.
  const tried = new Set<string>();

  for (let check = first; check <= close; check += CHECK_MINUTES) {
    const morning = check === first;
    // Past the first check it's service, which is what decides when a supplier order arrives.
    if (!morning) current = { ...current, paused: false, startedAtMs: 0 };
    const state = getSimStateAt(current, data, check);
    for (const situation of findSituations(state, data)) {
      const plan = rulePlan(buildAgentContext(situation, state, data, { morningView: morning }));
      for (const step of plan) {
        const id = actionId(step.call);
        if (tried.has(id)) continue;
        tried.add(id);
        const result = applyToolCall(current, step.call, "agent", check, data);
        if (result.ok) current = result.control;
      }
    }
  }
  return current;
}

export function compareDays(control: SimControl, data: RestaurantData): Comparison {
  const usedSuggestedPlan = (control.actions ?? []).length === 0;
  const withControl = usedSuggestedPlan ? withSuggestedPlan(control, data) : control;

  const without = dayOutcome(withoutSpine(control), data, { firstComeFirstServed: true });
  const withSpine = dayOutcome(withControl, data);

  const saved = round2(withSpine.moneyKept - without.moneyKept);
  const breakdown = [
    { label: "Sales after delivery fees", amount: round2(withSpine.netSales - without.netSales) },
    { label: "Food cost", amount: round2(without.foodCost - withSpine.foodCost) },
    { label: "Wages for anyone called in", amount: round2(without.laborCost - withSpine.laborCost) },
    { label: "Payout money disputed", amount: round2(without.payoutMissing - withSpine.payoutMissing) },
  ].filter((row) => Math.abs(row.amount) >= 0.01);

  const rows: ComparisonRow[] = [
    {
      label: "Lost sales and refunds",
      without: without.lostSales,
      with: withSpine.lostSales,
      unit: "money",
      source: "Dishes customers couldn't get × menu price, plus the full value of orders an app sold after the item ran out.",
    },
    {
      label: "Orders lost",
      without: without.ordersLost,
      with: withSpine.ordersLost,
      unit: "count",
      source: "Orders that couldn't be made at all, including cancelled ones.",
    },
    {
      label: "Late orders",
      without: without.lateOrders,
      with: withSpine.lateOrders,
      unit: "count",
      source: "Orders ready at least a minute after their promised time.",
    },
    {
      label: "Minutes late",
      without: without.lateMinutes,
      with: withSpine.lateMinutes,
      unit: "minutes",
      source: "Each late order's ready time minus its promised time, added up.",
    },
    {
      label: "Food waiting",
      without: without.foodWaitMinutes,
      with: withSpine.foodWaitMinutes,
      unit: "minutes",
      source: "Pickup time minus ready time, for each order that was ready early, added up.",
    },
    {
      label: `Orders waiting over ${QUALITY_RISK_MINUTES} min`,
      without: without.qualityRiskOrders,
      with: withSpine.qualityRiskOrders,
      unit: "count",
      source: `Food that sits longer than ${QUALITY_RISK_MINUTES} minutes counts as a quality risk.`,
    },
    {
      label: "Driver wait",
      without: without.driverWaitMinutes,
      with: withSpine.driverWaitMinutes,
      unit: "minutes",
      source: "Minutes between a driver's arrival and the food being ready, for late delivery orders.",
    },
    {
      label: "Extra labor",
      without: 0,
      with: round2(withSpine.laborCost - without.laborCost),
      unit: "money",
      source: "Wages for anyone called in: hours from their start until close × their hourly rate.",
    },
  ];

  const finalState = getSimStateAt(withControl, data, data.closeHour * 60);
  return {
    without,
    with: withSpine,
    saved,
    breakdown,
    rows,
    usedSuggestedPlan,
    decisions: finalState.actions.map((a) => a.result),
  };
}
