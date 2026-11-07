// Measures how a day felt: what was late, what sat, who waited. Deterministic, per order.
//
// In one sentence: each order starts cooking at its start time, then waits its turn with
// the packers, and we compare the moment it's ready with the moment it's picked up.
import { ORDERS_PER_LABOR_HOUR, buildStaffingPlan } from "./staffing";
import { startTime } from "./queue";
import type { ForecastHour, MenuItem, Order, RestaurantData, SimState } from "./types";

/** Food that sits ready longer than this is a quality risk. */
export const QUALITY_RISK_MINUTES = 10;

export interface KitchenMetrics {
  lateOrders: number;
  lateMinutes: number;
  foodWaitMinutes: number;
  qualityRiskOrders: number;
  driverWaitMinutes: number;
}

function longestPrep(order: Order, menu: MenuItem[]): number {
  return order.items.reduce((longest, line) => Math.max(longest, menu.find((m) => m.id === line.menuItemId)?.prepMinutes ?? 0), 0);
}

/** How many people are packing in each hour, given how many orders came in. */
function packersByHour(orders: Order[], data: RestaurantData): Record<number, number> {
  const hourly: ForecastHour[] = [];
  for (let hour = data.openHour; hour < data.closeHour; hour++) {
    const count = orders.filter((o) => Math.floor(o.placedAt / 60) === hour).length;
    hourly.push({ hour, orders: count, low: count, high: count, byItem: {}, byChannel: { doordash: 0, appB: 0, direct: 0 } });
  }
  const plan = buildStaffingPlan({ date: data.date, modifiers: [], hourly }, data);
  return Object.fromEntries(plan.hours.map((h) => [h.hour, h.scheduled.packing]));
}

/**
 * firstComeFirstServed is the kitchen without a fire-now queue: every order starts cooking
 * the moment it comes in. Otherwise an order starts at its start time from the queue.
 */
export function measureKitchen(state: SimState, data: RestaurantData, options: { firstComeFirstServed?: boolean } = {}): KitchenMetrics {
  const packers = packersByHour(state.orders, state.effectiveData);
  const cooked = state.orders
    .map((order) => {
      const start = options.firstComeFirstServed ? order.placedAt : Math.max(order.placedAt, startTime(order, data.menu));
      return { order, cookedAt: start + longestPrep(order, data.menu) };
    })
    .sort((a, b) => a.cookedAt - b.cookedAt);

  const metrics: KitchenMetrics = { lateOrders: 0, lateMinutes: 0, foodWaitMinutes: 0, qualityRiskOrders: 0, driverWaitMinutes: 0 };
  let packerFreeAt = 0;
  for (const { order, cookedAt } of cooked) {
    // Whoever is packing at close stays until the last order is out.
    const hour = Math.min(Math.floor(cookedAt / 60), data.closeHour - 1);
    const crew = Math.max(packers[hour] ?? 1, 1);
    const packMinutes = 60 / (ORDERS_PER_LABOR_HOUR.packing * crew);
    const readyAt = Math.max(cookedAt, packerFreeAt) + packMinutes;
    packerFreeAt = readyAt;

    const pickupAt = order.driverEtaAt ?? order.targetReadyAt;
    const late = readyAt - pickupAt;
    if (late >= 1) {
      metrics.lateOrders += 1;
      metrics.lateMinutes += late;
      if (order.driverEtaAt !== undefined) metrics.driverWaitMinutes += late;
    } else if (late < 0) {
      metrics.foodWaitMinutes += -late;
      if (-late > QUALITY_RISK_MINUTES) metrics.qualityRiskOrders += 1;
    }
  }

  return {
    lateOrders: metrics.lateOrders,
    lateMinutes: Math.round(metrics.lateMinutes),
    foodWaitMinutes: Math.round(metrics.foodWaitMinutes),
    qualityRiskOrders: metrics.qualityRiskOrders,
    driverWaitMinutes: Math.round(metrics.driverWaitMinutes),
  };
}
