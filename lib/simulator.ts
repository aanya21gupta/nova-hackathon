// Pure: the same inputs always give the same state, on every tab.
import { buildAlerts } from "./alerts";
import { buildForecast, reforecast } from "./forecast";
import { orderLabel } from "./format";
import { buildQueue, startTime } from "./queue";
import type { ActualHour, Alert, Forecast, Invoice, Minutes, Order, RestaurantData, SimControl, SimState, Trigger } from "./types";

export const SIM_STORAGE_KEY = "spine.sim.control";

/** How long an order stays on FIRE NOW before it counts as cooking. */
const FIRE_WINDOW_MINUTES = 3;
/** How long a finished order waits before it's handed off. */
const HANDOFF_MINUTES = 5;
/** The rush begins here, so the last hour is 35% over by the 6:30pm check. */
export const RUSH_START: Minutes = 17 * 60 + 30;
const RUSH_CHECK: Minutes = 18 * 60 + 30;
export const DRIVER_DELAY_MINUTES = 12;
/** The /demo jump button. See tests/story.test.ts for why this time. */
export const DEMO_JUMP_MINUTE: Minutes = 18 * 60 + 20;

export const DEFAULT_CONTROL: SimControl = {
  startedAtMs: null,
  startMinute: 17 * 60,
  speed: 1,
  paused: true,
  triggers: [],
};

const baseForecasts = new WeakMap<RestaurantData, Forecast>();

export function getBaseForecast(data: RestaurantData): Forecast {
  let forecast = baseForecasts.get(data);
  if (!forecast) {
    forecast = buildForecast(data.history, data.modifiers, data);
    baseForecasts.set(data, forecast);
  }
  return forecast;
}

/** The simulated minute, stopped at closing time. */
export function currentMinute(control: SimControl, data: RestaurantData, nowMs: number): Minutes {
  const close = data.closeHour * 60;
  if (control.paused || control.startedAtMs === null) return Math.min(control.startMinute, close);
  const elapsed = ((nowMs - control.startedAtMs) / 1000) * control.speed;
  return Math.min(Math.floor(control.startMinute + elapsed), close);
}

export type DayPhase = "morning" | "service" | "close";

/** Morning until the clock has been started or moved, then service, then close. */
export function dayPhase(control: SimControl, state: Pick<SimState, "serviceOver">): DayPhase {
  if (state.serviceOver) return "close";
  return !control.paused || control.startMinute !== DEFAULT_CONTROL.startMinute ? "service" : "morning";
}

/** Before the 6:30pm check, the rush starts at 5:30pm, so the story always lands at 6:30pm. */
export function makeRushTrigger(now: Minutes): Trigger {
  return { type: "rush", atMinute: now < RUSH_CHECK ? RUSH_START : now };
}

/** The order the driver-delay button should move. Prefers one on FIRE NOW so the move is visible. */
export function pickDelayTarget(state: SimState): string | null {
  const delayed = new Set(Object.keys(state.delayedOrders));
  const delivery = state.queue.filter((e) => e.order.driverEtaAt !== undefined && !delayed.has(e.orderId));
  const target = delivery.find((e) => e.label === "FIRE NOW") ?? delivery.find((e) => e.label === "UP NEXT") ?? delivery[0];
  return target?.orderId ?? null;
}

/** All orders placed so far, with driver delays applied and status worked out from the clock. */
function ordersAt(data: RestaurantData, triggers: Trigger[], now: Minutes): { orders: Order[]; delayedOrders: Record<string, number> } {
  const rush = triggers.find((t) => t.type === "rush");
  const rushAt = rush?.type === "rush" ? rush.atMinute : Infinity;
  const candidates = [...data.orders, ...data.rushOrders.filter((o) => o.placedAt >= rushAt)];

  const delayedOrders: Record<string, number> = {};
  for (const t of triggers) {
    if (t.type === "driverDelay" && now >= t.atMinute) delayedOrders[t.orderId] = (delayedOrders[t.orderId] ?? 0) + t.delayMinutes;
  }

  const orders = candidates
    .filter((o) => o.placedAt <= now)
    .map((o): Order => {
      const delay = delayedOrders[o.id] ?? 0;
      const delayed: Order =
        delay > 0 && o.driverEtaAt !== undefined
          ? { ...o, driverEtaAt: o.driverEtaAt + delay, targetReadyAt: o.targetReadyAt + delay }
          : o;
      const start = startTime(delayed, data.menu);
      const ready = delayed.driverEtaAt ?? delayed.targetReadyAt;
      let status: Order["status"] = "pickedUp";
      if (now < start + FIRE_WINDOW_MINUTES) status = "queued";
      else if (now < ready) status = "cooking";
      else if (now < ready + HANDOFF_MINUTES) status = "ready";
      return { ...delayed, status };
    })
    .sort((a, b) => a.placedAt - b.placedAt);

  return { orders, delayedOrders };
}

function actualsAt(orders: Order[], data: RestaurantData): ActualHour[] {
  const hours: ActualHour[] = [];
  for (let hour = data.openHour; hour < data.closeHour; hour++) {
    hours.push({ hour, orders: orders.filter((o) => Math.floor(o.placedAt / 60) === hour).length });
  }
  return hours;
}

function withExtraStock(data: RestaurantData, triggers: Trigger[]): RestaurantData {
  const extras: Record<string, number> = {};
  for (const t of triggers) {
    if (t.type === "extraStock") extras[t.ingredientId] = (extras[t.ingredientId] ?? 0) + t.qty;
  }
  if (Object.keys(extras).length === 0) return data;
  return {
    ...data,
    ingredients: data.ingredients.map((i) => (extras[i.id] ? { ...i, onHand: i.onHand + extras[i.id] } : i)),
  };
}

export function getSimStateAt(control: SimControl, data: RestaurantData, now: Minutes): SimState {
  const { triggers } = control;
  const effectiveData = withExtraStock(data, triggers);
  const { orders, delayedOrders } = ordersAt(data, triggers, now);
  const baseForecast = getBaseForecast(data);
  const forecast = reforecast(baseForecast, orders, now);
  const queue = buildQueue(orders, data.menu, now);

  const delayAlerts: Alert[] = Object.entries(delayedOrders)
    .filter(([id]) => queue.some((e) => e.orderId === id))
    .map(([id, minutes]) => ({
      id: `delay-${id}`,
      kind: "driverDelay",
      severity: "info",
      message: `The driver for order ${orderLabel(id)} is ${minutes} minutes late, so the kitchen is holding it.`,
      facts: { order: orderLabel(id), minutes },
      reason: "Starting it now would leave the food sitting until the driver arrives.",
    }));

  const invoices: Invoice[] = [];
  for (const t of triggers) if (t.type === "invoice") invoices.push(t.invoice);

  return {
    now,
    orders,
    queue,
    baseForecast,
    forecast,
    actuals: actualsAt(orders, data),
    alerts: [...buildAlerts(forecast, orders, effectiveData, now), ...delayAlerts],
    cookingCount: orders.filter((o) => o.status === "cooking").length,
    delayedOrders,
    invoices,
    pausedItemIds: triggers.flatMap((t) => (t.type === "pauseItem" ? [t.menuItemId] : [])),
    payoutGapActive: triggers.some((t) => t.type === "payoutGap"),
    effectiveData,
    serviceOver: now >= data.closeHour * 60,
  };
}

/** nowMs is passed in rather than read from the clock so this stays testable. */
export function getSimState(control: SimControl, data: RestaurantData, nowMs: number): SimState {
  return getSimStateAt(control, data, currentMinute(control, data, nowMs));
}
