// See CLAUDE.md 4.2. An ingredient gets prep tasks if it's listed in data.prepped
// (use 0 if nothing is prepped yet). Raw stock like rice isn't a prep task.
import { formatTime } from "./format";
import type { Forecast, Ingredient, PrepTask, RestaurantData } from "./types";

/** Lunch prep covers hours before this. Dinner prep covers the rest. */
const DINNER_STARTS_HOUR = 15;
const DINNER_PREP_DUE = 16 * 60 + 30;
const LUNCH_PREP_LEAD_MINUTES = 30;

function usage(forecast: Forecast, data: RestaurantData, ingredientId: string, fromHour: number, toHour: number): number {
  let total = 0;
  for (const h of forecast.hourly) {
    if (h.hour < fromHour || h.hour >= toHour) continue;
    for (const item of data.menu) {
      const line = item.recipe.find((r) => r.ingredientId === ingredientId);
      if (line) total += (h.byItem[item.id] ?? 0) * line.qty;
    }
  }
  return total;
}

function task(ingredient: Ingredient, qty: number, dueBy: number): PrepTask {
  const rounded = Math.ceil(qty * 2) / 2; // Round up to the nearest half unit.
  return {
    ingredientId: ingredient.id,
    label: `Prep ${rounded} ${ingredient.unit} ${ingredient.name.toLowerCase()} by ${formatTime(dueBy)}`,
    qty: rounded,
    unit: ingredient.unit,
    dueBy,
  };
}

export function buildPrepList(forecast: Forecast, data: RestaurantData): PrepTask[] {
  const lunchDue = data.openHour * 60 - LUNCH_PREP_LEAD_MINUTES;
  const tasks: PrepTask[] = [];

  for (const ingredient of data.ingredients) {
    const alreadyPrepped = data.prepped[ingredient.id];
    if (alreadyPrepped === undefined) continue;

    const lunchNeed = usage(forecast, data, ingredient.id, data.openHour, DINNER_STARTS_HOUR);
    const dinnerNeed = usage(forecast, data, ingredient.id, DINNER_STARTS_HOUR, data.closeHour);
    const lunchPrep = Math.max(lunchNeed - alreadyPrepped, 0);
    const leftover = Math.max(alreadyPrepped - lunchNeed, 0);
    const dinnerPrep = Math.max(dinnerNeed - leftover, 0);

    if (lunchPrep > 0) tasks.push(task(ingredient, lunchPrep, lunchDue));
    if (dinnerPrep > 0) tasks.push(task(ingredient, dinnerPrep, DINNER_PREP_DUE));
  }

  return tasks.sort((a, b) => a.dueBy - b.dueBy || b.qty - a.qty);
}
