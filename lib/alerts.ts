// Code builds each message and its facts. The LLM may only explain them.
import { REFORECAST_CHECK_MINUTES } from "./forecast";
import { formatHour, SKILL_NAMES } from "./format";
import { findRunOuts } from "./ordering";
import { buildStaffingPlan } from "./staffing";
import type { Alert, Forecast, MenuItem, Minutes, Order, RestaurantData, RunOut, Skill, StaffingHour } from "./types";

/** The menu item that uses the most of an ingredient, by forecast. */
function biggestUser(ingredientId: string, forecast: Forecast, data: RestaurantData): MenuItem | undefined {
  let best: MenuItem | undefined;
  let bestUse = 0;
  for (const item of data.menu) {
    const line = item.recipe.find((r) => r.ingredientId === ingredientId);
    if (!line) continue;
    const count = forecast.hourly.reduce((sum, h) => sum + (h.byItem[item.id] ?? 0), 0);
    if (count * line.qty > bestUse) {
      best = item;
      bestUse = count * line.qty;
    }
  }
  return best;
}

function runOutAlerts(runOuts: RunOut[], forecast: Forecast, data: RestaurantData, checkAt: Minutes): Alert[] {
  const alerts: Alert[] = [];
  for (const r of runOuts) {
    if (r.runsOutAt === null || r.runsOutLabel === null) continue;
    alerts.push({
      id: `runout-${r.ingredientId}`,
      kind: "runOut",
      severity: "urgent",
      message: r.runsOutAt <= checkAt ? `We've run out of ${r.ingredientName}.` : `${r.ingredientName} will run out by ${r.runsOutLabel}.`,
      facts: { ingredient: r.ingredientName, runsOutBy: r.runsOutLabel },
      reason: `At the current pace, what's left of the ${r.ingredientName.toLowerCase()} won't last until close.`,
    });
    const item = biggestUser(r.ingredientId, forecast, data);
    if (item && forecast.scaledBy !== undefined) {
      alerts.push({
        id: `pause-${item.id}`,
        kind: "pauseItem",
        severity: "warning",
        message: `Pause ${item.name} on DoorDash and App B to save it for phone and walk-in orders.`,
        facts: { item: item.name, ingredient: r.ingredientName, runsOutBy: r.runsOutLabel },
        reason: `${item.name} uses the most ${r.ingredientName.toLowerCase()}. Direct orders don't pay delivery fees, so they keep more of each sale.`,
      });
    }
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
export function buildAlerts(forecast: Forecast, orders: Order[], data: RestaurantData, now: Minutes): Alert[] {
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

  alerts.push(...runOutAlerts(findRunOuts(forecast, data, checkAt, orders), forecast, data, checkAt));

  const remaining = buildStaffingPlan(forecast, data).hours.filter((h) => (h.hour + 1) * 60 > checkAt);
  alerts.push(...staffingAlerts(remaining));
  return alerts;
}
