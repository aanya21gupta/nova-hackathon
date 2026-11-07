// Code builds each message and its facts. The LLM may only explain them.
// What to do about an alert is the agent's job: see lib/agent.ts.
import { REFORECAST_CHECK_MINUTES } from "./forecast";
import { formatHour, SKILL_NAMES } from "./format";
import { findRunOuts } from "./ordering";
import { buildStaffingPlan } from "./staffing";
import type { Alert, Forecast, Minutes, Order, RestaurantData, RunOut, Skill, StaffingHour } from "./types";

function runOutAlerts(runOuts: RunOut[], stockouts: RunOut[]): Alert[] {
  const alerts: Alert[] = stockouts.map((out) => ({
    id: `runout-${out.ingredientId}`,
    kind: "runOut",
    severity: "urgent",
    message: `We've run out of ${out.ingredientName}.`,
    facts: { ingredient: out.ingredientName, ranOutAt: out.runsOutLabel ?? "" },
    reason: `${out.ingredientName} ran out at about ${out.runsOutLabel}, so dishes that use it can't be made.`,
  }));

  const alreadyOut = new Set(stockouts.map((s) => s.ingredientId));
  for (const r of runOuts) {
    if (r.runsOutAt === null || r.runsOutLabel === null || alreadyOut.has(r.ingredientId)) continue;
    alerts.push({
      id: `runout-${r.ingredientId}`,
      kind: "runOut",
      severity: "urgent",
      message: `${r.ingredientName} will run out by ${r.runsOutLabel}.`,
      facts: { ingredient: r.ingredientName, runsOutBy: r.runsOutLabel },
      reason: `At the current pace, what's left of the ${r.ingredientName.toLowerCase()} won't last until close.`,
    });
  }
  return alerts;
}

function staffingAlerts(hours: StaffingHour[]): Alert[] {
  const alerts: Alert[] = [];
  const skills: Skill[] = ["wok", "fryer", "packing", "register"];
  for (const skill of skills) {
    const short = hours.filter((h) => h.gaps.includes(skill));
    if (short.length === 0) continue;
    const worst = short.reduce((a, b) =>
      b.required[skill] - b.scheduled[skill] > a.required[skill] - a.scheduled[skill] ? b : a,
    );
    const missing = worst.required[skill] - worst.scheduled[skill];
    const from = formatHour(short[0].hour);
    const to = formatHour(short[short.length - 1].hour + 1);
    alerts.push({
      id: `understaffed-${skill}`,
      kind: "understaffed",
      severity: "warning",
      message: `${SKILL_NAMES[skill]} is short ${missing} ${missing === 1 ? "person" : "people"} from ${from} to ${to}.`,
      facts: { station: SKILL_NAMES[skill], needed: worst.required[skill], scheduled: worst.scheduled[skill], from, to },
      reason: `With this many orders, ${SKILL_NAMES[skill].toLowerCase()} needs ${worst.required[skill]} people, and ${worst.scheduled[skill]} are scheduled.`,
    });
  }
  return alerts;
}

/**
 * Alerts use the last half-hour check, the same moment as the re-forecast, so a
 * warning like "by 8:15" stays still on screen instead of shifting every minute.
 */
export function buildAlerts(forecast: Forecast, orders: Order[], data: RestaurantData, now: Minutes, stockouts: RunOut[] = []): Alert[] {
  const checkAt = Math.floor(now / REFORECAST_CHECK_MINUTES) * REFORECAST_CHECK_MINUTES;
  const alerts: Alert[] = [];

  if (forecast.scaledBy !== undefined) {
    const percent = Math.round(Math.abs(forecast.scaledBy - 1) * 100);
    const direction = forecast.scaledBy > 1 ? "above" : "below";
    alerts.push({
      id: "reforecast",
      kind: "reforecast",
      severity: "warning",
      message: `Orders are running ${percent}% ${direction} the plan, so the rest of tonight's plan has been updated.`,
      facts: { percent, direction },
      reason: `In the last hour, orders were more than 20% away from the forecast, so Spine scaled the remaining hours to match.`,
    });
  }

  alerts.push(...runOutAlerts(findRunOuts(forecast, data, checkAt, orders), stockouts));

  const remaining = buildStaffingPlan(forecast, data).hours.filter((h) => (h.hour + 1) * 60 > checkAt);
  alerts.push(...staffingAlerts(remaining));
  return alerts;
}
