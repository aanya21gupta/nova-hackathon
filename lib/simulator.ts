// Pure: the same inputs always give the same state, on every tab.
import { buildAlerts } from "./alerts";
import { buildForecast, reforecast } from "./forecast";
import { orderLabel } from "./format";
import { runOut } from "./ordering";
import { buildQueue, effectiveStart, type QueueOverrides } from "./queue";
import type {
  ActualHour,
  AppliedAction,
  Alert,
  Channel,
  Forecast,
  Invoice,
  MenuItem,
  Minutes,
  Order,
  OrderLine,
  RestaurantData,
  RunOut,
  SimControl,
  SimState,
  Trigger,
} from "./types";

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
/** After something runs out, the apps keep selling it this long, until someone notices. */
export const NOTICE_MINUTES = 15;

export const DEFAULT_CONTROL: SimControl = {
  startedAtMs: null,
  startMinute: 17 * 60,
  speed: 1,
  paused: true,
  triggers: [],
  actions: [],
  skipped: [],
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

// ---------- Reading approved actions ----------

/** Time windows when an item is off a channel. A resume closes the window. */
function pauseWindows(actions: AppliedAction[]): Map<string, { from: Minutes; to: Minutes }[]> {
  const windows = new Map<string, { from: Minutes; to: Minutes }[]>();
  for (const action of actions) {
    const { call } = action;
    if (call.tool === "pauseItem") {
      for (const channel of call.channels) {
        const key = `${call.itemId}|${channel}`;
        windows.set(key, [...(windows.get(key) ?? []), { from: call.fromMinute ?? action.atMinute, to: Infinity }]);
      }
    }
    if (call.tool === "resumeItem") {
      for (const channel of call.channels) {
        for (const window of windows.get(`${call.itemId}|${channel}`) ?? []) {
          if (window.to === Infinity) window.to = action.atMinute;
        }
      }
    }
  }
  return windows;
}

/** Busy mode pushes back the promised time on new orders. */
function busyDelay(actions: AppliedAction[], order: Order): number {
  let delay = 0;
  for (const action of actions) {
    const { call } = action;
    if (call.tool !== "setBusyMode") continue;
    if (call.channel !== "all" && call.channel !== order.channel) continue;
    if (order.placedAt >= action.atMinute && order.placedAt <= call.untilTime) delay = Math.max(delay, call.extraMinutes);
  }
  return delay;
}

function queueOverrides(actions: AppliedAction[], now: Minutes): QueueOverrides & { readyAt: Record<string, Minutes> } {
  const heldUntil: Record<string, Minutes> = {};
  const firedAt: Record<string, Minutes> = {};
  const readyAt: Record<string, Minutes> = {};
  for (const action of actions) {
    if (action.atMinute > now) continue;
    if (action.call.tool === "holdOrder") {
      heldUntil[action.call.orderId] = action.atMinute + HOLD_MINUTES;
      delete firedAt[action.call.orderId];
    }
    if (action.call.tool === "fireOrder") firedAt[action.call.orderId] = action.atMinute;
    if (action.call.tool === "markOrderReady") readyAt[action.call.orderId] = action.atMinute;
  }
  return { heldUntil, firedAt, readyAt };
}

/** A hold ends on its own, so an order can't be forgotten forever. */
export const HOLD_MINUTES = 15;

// ---------- Serving the day ----------

function canMake(item: MenuItem, qty: number, stock: Record<string, number>): boolean {
  return item.recipe.every((r) => stock[r.ingredientId] === undefined || stock[r.ingredientId] >= r.qty * qty);
}

function consume(item: MenuItem, qty: number, stock: Record<string, number>) {
  for (const r of item.recipe) {
    if (stock[r.ingredientId] !== undefined) stock[r.ingredientId] -= r.qty * qty;
  }
}

function addLine(lines: OrderLine[], menuItemId: string, qty: number) {
  const existing = lines.find((l) => l.menuItemId === menuItemId);
  if (existing) existing.qty += qty;
  else lines.push({ menuItemId, qty });
}

/** The same order always makes the same choice, so every run of the demo matches. */
function customerPicksSomethingElse(orderId: string, lineIndex: number): boolean {
  let total = lineIndex;
  for (const character of orderId) total += character.charCodeAt(0);
  return total % 2 === 0;
}

interface ServedDay {
  placed: Order[];
  served: Order[];
  cancelled: Order[];
  lostSales: number;
  stockouts: RunOut[];
}

/**
 * Goes through the orders in time order, taking stock as it goes. When a dish can't be
 * sold there are two outcomes:
 *  - The customer can see that first (it's paused, the app has caught up, or they're at
 *    the counter): half pick another dish from the same station, half skip that dish.
 *  - An app is still selling it because nobody noticed: the whole order is cancelled and
 *    refunded. This is what pausing ahead of time avoids.
 */
function serveOrders(data: RestaurantData, triggers: Trigger[], actions: AppliedAction[], now: Minutes): ServedDay {
  const rush = triggers.find((t) => t.type === "rush");
  const rushAt = rush?.type === "rush" ? rush.atMinute : Infinity;
  const placed = [...data.orders, ...data.rushOrders.filter((o) => o.placedAt >= rushAt)]
    .filter((o) => o.placedAt <= now)
    .sort((a, b) => a.placedAt - b.placedAt || a.id.localeCompare(b.id));

  const stock: Record<string, number> = {};
  for (const i of data.ingredients) stock[i.id] = i.onHand;

  const windows = pauseWindows(actions);
  const pendingStock = actions.flatMap((a) =>
    a.call.tool === "draftSupplierOrder" && a.stockArrivesAt !== null && a.stockArrivesAt !== undefined
      ? a.call.lines.map((line) => ({ ...line, atMinute: a.stockArrivesAt as Minutes }))
      : [],
  );

  const priceOf = (id: string) => data.menu.find((m) => m.id === id)?.price ?? 0;
  const outAt: Record<string, Minutes> = {};
  const stockouts: RunOut[] = [];
  const served: Order[] = [];
  const cancelled: Order[] = [];
  let lostSales = 0;

  for (const order of placed) {
    for (let i = pendingStock.length - 1; i >= 0; i--) {
      if (pendingStock[i].atMinute <= order.placedAt) {
        stock[pendingStock[i].ingredientId] = (stock[pendingStock[i].ingredientId] ?? 0) + pendingStock[i].qty;
        pendingStock.splice(i, 1);
      }
    }

    const delivery = order.channel !== "direct";
    const isPaused = (itemId: string) =>
      (windows.get(`${itemId}|${order.channel}`) ?? []).some((w) => order.placedAt >= w.from && order.placedAt < w.to);
    const tentative = { ...stock };
    const lines: OrderLine[] = [];
    let lostHere = 0;
    let cancel = false;

    for (const [index, line] of order.items.entries()) {
      const item = data.menu.find((m) => m.id === line.menuItemId);
      if (!item) continue;
      const paused = isPaused(item.id);
      const available = canMake(item, line.qty, tentative);

      if (!available && outAt[item.id] === undefined) {
        outAt[item.id] = order.placedAt;
        const missing = item.recipe.find((r) => (tentative[r.ingredientId] ?? Infinity) < r.qty * line.qty);
        if (missing && !stockouts.some((s) => s.ingredientId === missing.ingredientId)) {
          const name = data.ingredients.find((i) => i.id === missing.ingredientId)?.name ?? missing.ingredientId;
          stockouts.push(runOut(missing.ingredientId, name, order.placedAt));
        }
      }
      if (!available && delivery && !paused && order.placedAt < outAt[item.id] + NOTICE_MINUTES) {
        cancel = true;
        break;
      }
      if (paused || !available) {
        const swap = customerPicksSomethingElse(order.id, index)
          ? data.menu.find((m) => m.id !== item.id && m.station === item.station && !isPaused(m.id) && canMake(m, line.qty, tentative))
          : undefined;
        if (swap) {
          consume(swap, line.qty, tentative);
          addLine(lines, swap.id, line.qty);
          lostHere += Math.max(priceOf(item.id) - swap.price, 0) * line.qty;
        } else {
          lostHere += priceOf(item.id) * line.qty;
        }
        continue;
      }
      consume(item, line.qty, tentative);
      addLine(lines, item.id, line.qty);
    }

    if (cancel) {
      cancelled.push(order);
      lostSales += order.items.reduce((sum, l) => sum + priceOf(l.menuItemId) * l.qty, 0);
      continue;
    }
    lostSales += lostHere;
    if (lines.length > 0) {
      Object.assign(stock, tentative);
      served.push({ ...order, items: lines });
    }
  }

  return { placed, served, cancelled, lostSales, stockouts };
}

/** Works out where an order is, from the clock and anything done to it by hand. */
function withStatus(
  order: Order,
  driverDelay: number,
  actions: AppliedAction[],
  overrides: ReturnType<typeof queueOverrides>,
  data: RestaurantData,
  now: Minutes,
): Order {
  const delay = driverDelay + busyDelay(actions, order);
  const moved: Order =
    delay > 0
      ? {
          ...order,
          targetReadyAt: order.targetReadyAt + delay,
          driverEtaAt: order.driverEtaAt === undefined ? undefined : order.driverEtaAt + delay,
        }
      : order;
  const start = effectiveStart(moved, data.menu, overrides);
  const ready = moved.driverEtaAt ?? moved.targetReadyAt;
  let status: Order["status"] = "pickedUp";
  const markedReady = overrides.readyAt[order.id];
  if (markedReady !== undefined) status = now < markedReady + HANDOFF_MINUTES ? "ready" : "pickedUp";
  else if (now < start + FIRE_WINDOW_MINUTES) status = "queued";
  else if (now < ready) status = "cooking";
  else if (now < ready + HANDOFF_MINUTES) status = "ready";
  return { ...moved, status };
}

function actualsAt(orders: Order[], data: RestaurantData): ActualHour[] {
  const hours: ActualHour[] = [];
  for (let hour = data.openHour; hour < data.closeHour; hour++) {
    hours.push({ hour, orders: orders.filter((o) => Math.floor(o.placedAt / 60) === hour).length });
  }
  return hours;
}

/** Stock and staff, with approved actions added. */
function withActions(data: RestaurantData, actions: AppliedAction[]): RestaurantData {
  const extras: Record<string, number> = {};
  const shifts: Record<string, { start: Minutes; end: Minutes }[]> = {};
  for (const { call, stockArrivesAt } of actions) {
    if (call.tool === "draftSupplierOrder" && stockArrivesAt !== null && stockArrivesAt !== undefined) {
      for (const line of call.lines) extras[line.ingredientId] = (extras[line.ingredientId] ?? 0) + line.qty;
    }
    if (call.tool === "requestStaff") {
      (shifts[call.staffId] ??= []).push({ start: call.startTime, end: data.closeHour * 60 });
    }
  }
  if (Object.keys(extras).length === 0 && Object.keys(shifts).length === 0) return data;
  return {
    ...data,
    ingredients: data.ingredients.map((i) => (extras[i.id] ? { ...i, onHand: i.onHand + extras[i.id] } : i)),
    staff: data.staff.map((s) => (shifts[s.id] ? { ...s, availability: [...s.availability, ...shifts[s.id]] } : s)),
  };
}

/** A paused item's forecast is zero on those channels, so run-outs and prep recompute. */
function withPauses(forecast: Forecast, windows: Map<string, { from: Minutes; to: Minutes }[]>): Forecast {
  if (windows.size === 0) return forecast;
  return {
    ...forecast,
    hourly: forecast.hourly.map((h) => {
      const byItem = { ...h.byItem };
      for (const [key, list] of windows) {
        const [itemId, channel] = key.split("|") as [string, Channel];
        if (byItem[itemId] === undefined || h.orders === 0) continue;
        for (const w of list) {
          const overlap = Math.max(Math.min(w.to, (h.hour + 1) * 60) - Math.max(w.from, h.hour * 60), 0) / 60;
          byItem[itemId] -= h.byItem[itemId] * overlap * (h.byChannel[channel] / h.orders);
        }
      }
      return { ...h, byItem };
    }),
  };
}

function computeState(triggers: Trigger[], allActions: AppliedAction[], data: RestaurantData, now: Minutes): SimState {
  const actions = allActions.filter((a) => a.atMinute <= now);
  const effectiveData = withActions(data, actions);
  const { placed, served, cancelled, lostSales, stockouts } = serveOrders(data, triggers, actions, now);

  const delayedOrders: Record<string, number> = {};
  for (const t of triggers) {
    if (t.type === "driverDelay" && now >= t.atMinute) delayedOrders[t.orderId] = (delayedOrders[t.orderId] ?? 0) + t.delayMinutes;
  }
  const overrides = queueOverrides(actions, now);
  const orders = served.map((o) => withStatus(o, delayedOrders[o.id] ?? 0, actions, overrides, data, now));

  const baseForecast = getBaseForecast(data);
  const windows = pauseWindows(actions);
  // Re-forecast from what customers tried to order: a sold-out dish is still demand.
  const forecast = withPauses(reforecast(baseForecast, placed, now), windows);
  const queue = buildQueue(orders, data.menu, now, overrides);

  const pausedItems: SimState["pausedItems"] = [];
  for (const [key, list] of windows) {
    const [itemId, channel] = key.split("|") as [string, Channel];
    const open = list.filter((w) => w.to === Infinity);
    if (open.length === 0) continue;
    const from = Math.min(...open.map((w) => w.from));
    const existing = pausedItems.find((p) => p.itemId === itemId);
    if (existing) {
      existing.channels.push(channel);
      existing.fromMinute = Math.min(existing.fromMinute, from);
    } else {
      pausedItems.push({ itemId, channels: [channel], fromMinute: from });
    }
  }

  const extraAlerts: Alert[] = Object.entries(delayedOrders)
    .filter(([id]) => queue.some((e) => e.orderId === id))
    .map(([id, minutes]) => ({
      id: `delay-${id}`,
      kind: "driverDelay",
      severity: "info",
      message: `The driver for order ${orderLabel(id)} is ${minutes} minutes late, so the kitchen is holding it.`,
      facts: { order: orderLabel(id), minutes },
      reason: "Starting it now would leave the food sitting until the driver arrives.",
    }));

  if (cancelled.length > 0) {
    const names = stockouts.map((s) => s.ingredientName.toLowerCase()).join(" and ");
    extraAlerts.push({
      id: "cancelled",
      kind: "cancelled",
      severity: "urgent",
      message: `${cancelled.length} app ${cancelled.length === 1 ? "order was" : "orders were"} cancelled and refunded because we ran out of ${names}.`,
      facts: { cancelled: cancelled.length, ingredients: names },
      reason: "The apps kept selling the dish after it ran out, until someone noticed.",
    });
  }

  const invoices: Invoice[] = [];
  for (const t of triggers) if (t.type === "invoice") invoices.push(t.invoice);

  return {
    now,
    orders,
    placed,
    cancelledOrders: cancelled,
    lostSales,
    stockouts,
    actions,
    pausedItems,
    queue,
    baseForecast,
    forecast,
    actuals: actualsAt(placed, data),
    alerts: [...buildAlerts(forecast, served, effectiveData, now, stockouts), ...extraAlerts],
    cookingCount: orders.filter((o) => o.status === "cooking").length,
    delayedOrders,
    invoices,
    payoutGapActive: triggers.some((t) => t.type === "payoutGap"),
    effectiveData,
    serviceOver: now >= data.closeHour * 60,
  };
}

export function getSimStateAt(control: SimControl, data: RestaurantData, now: Minutes): SimState {
  return computeState(control.triggers, control.actions ?? [], data, now);
}

/** nowMs is passed in rather than read from the clock so this stays testable. */
export function getSimState(control: SimControl, data: RestaurantData, nowMs: number): SimState {
  return getSimStateAt(control, data, currentMinute(control, data, nowMs));
}
