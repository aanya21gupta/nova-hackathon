// See CLAUDE.md 4.3.
import { formatTime, round2 } from "./format";
import type { Forecast, Minutes, Order, RestaurantData, RunOut, SupplierOrderLine } from "./types";

/** Ingredient quantity used per one of each menu item. */
function recipeIndex(data: RestaurantData): Record<string, { ingredientId: string; qty: number }[]> {
  return Object.fromEntries(data.menu.map((m) => [m.id, m.recipe]));
}

/** Total of each ingredient used by a set of orders. */
export function usageFromOrders(orders: Order[], data: RestaurantData): Record<string, number> {
  const recipes = recipeIndex(data);
  const used: Record<string, number> = {};
  for (const order of orders) {
    for (const line of order.items) {
      for (const r of recipes[line.menuItemId] ?? []) {
        used[r.ingredientId] = (used[r.ingredientId] ?? 0) + r.qty * line.qty;
      }
    }
  }
  return used;
}

/** Usage for the next N days + par buffer - on hand, rounded up to pack sizes. N days use today's forecast. */
export function buildSupplierOrder(forecast: Forecast, data: RestaurantData, days: number): SupplierOrderLine[] {
  const recipes = recipeIndex(data);
  const dayUsage: Record<string, number> = {};
  for (const h of forecast.hourly) {
    for (const [itemId, count] of Object.entries(h.byItem)) {
      for (const r of recipes[itemId] ?? []) dayUsage[r.ingredientId] = (dayUsage[r.ingredientId] ?? 0) + count * r.qty;
    }
  }

  const lines: SupplierOrderLine[] = [];
  for (const ingredient of data.ingredients) {
    const needed = (dayUsage[ingredient.id] ?? 0) * days + ingredient.parLevel - ingredient.onHand;
    if (needed <= 0) continue;
    const packs = Math.ceil(needed / ingredient.packSize);
    const qty = packs * ingredient.packSize;
    lines.push({
      ingredientId: ingredient.id,
      supplierId: ingredient.supplierId,
      qty,
      packs,
      estimatedCost: round2(qty * ingredient.lastUnitPrice),
    });
  }
  return lines;
}

function runOut(ingredientId: string, name: string, at: Minutes | null): RunOut {
  return {
    ingredientId,
    ingredientName: name,
    runsOutAt: at,
    runsOutLabel: at === null ? null : formatTime(Math.round(at / 5) * 5),
  };
}

/**
 * When each ingredient runs out, starting from `from`. Orders placed by then are
 * subtracted from stock, and the forecast is used after that, a minute at a time.
 * Soonest first, with ingredients that last through close at the end.
 */
export function findRunOuts(forecast: Forecast, data: RestaurantData, from: Minutes, orders: Order[] = []): RunOut[] {
  const recipes = recipeIndex(data);
  const used = usageFromOrders(orders.filter((o) => o.placedAt <= from), data);
  const stock: Record<string, number> = {};
  for (const i of data.ingredients) stock[i.id] = i.onHand - (used[i.id] ?? 0);

  const found: Record<string, Minutes> = {};
  for (const i of data.ingredients) if (stock[i.id] <= 0) found[i.id] = from;

  const close = data.closeHour * 60;
  for (const h of forecast.hourly) {
    const perMinute: Record<string, number> = {};
    for (const [itemId, count] of Object.entries(h.byItem)) {
      for (const r of recipes[itemId] ?? []) perMinute[r.ingredientId] = (perMinute[r.ingredientId] ?? 0) + (count * r.qty) / 60;
    }
    const start = Math.max(h.hour * 60, from);
    const end = Math.min((h.hour + 1) * 60, close);
    for (let minute = start; minute < end; minute++) {
      for (const [ingredientId, rate] of Object.entries(perMinute)) {
        if (stock[ingredientId] === undefined) continue;
        stock[ingredientId] -= rate;
        if (stock[ingredientId] <= 0 && found[ingredientId] === undefined) found[ingredientId] = minute + 1;
      }
    }
  }

  return data.ingredients
    .map((i) => runOut(i.id, i.name, found[i.id] ?? null))
    .sort((a, b) => (a.runsOutAt ?? Infinity) - (b.runsOutAt ?? Infinity));
}

/** What actually ran out, going through the day's real orders. */
export function actualStockouts(orders: Order[], data: RestaurantData): RunOut[] {
  const recipes = recipeIndex(data);
  const stock: Record<string, number> = {};
  for (const i of data.ingredients) stock[i.id] = i.onHand;

  const found: RunOut[] = [];
  const seen = new Set<string>();
  for (const order of [...orders].sort((a, b) => a.placedAt - b.placedAt)) {
    for (const line of order.items) {
      for (const r of recipes[line.menuItemId] ?? []) {
        if (stock[r.ingredientId] === undefined) continue;
        stock[r.ingredientId] -= r.qty * line.qty;
        if (stock[r.ingredientId] <= 0 && !seen.has(r.ingredientId)) {
          seen.add(r.ingredientId);
          const ingredient = data.ingredients.find((i) => i.id === r.ingredientId);
          found.push(runOut(r.ingredientId, ingredient?.name ?? r.ingredientId, order.placedAt));
        }
      }
    }
  }
  return found;
}
