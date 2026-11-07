// See CLAUDE.md 4.1. In one sentence: the average of normal past days like today,
// hour by hour, times today's modifiers, split by the usual item and channel mix.
import { WEEKDAY_NAMES } from "./format";
import type { Channel, Forecast, ForecastHour, ForecastModifier, HistoricalOrder, Minutes, Order, RestaurantData } from "./types";

/** Re-forecast fires when the last 60 minutes differ from forecast by more than this. */
export const REFORECAST_THRESHOLD = 0.2;
/** We only check every 30 minutes, so numbers on screen don't jitter minute to minute. */
export const REFORECAST_CHECK_MINUTES = 30;
/** Below this many expected orders, a difference is just small-number noise. */
const REFORECAST_MIN_EXPECTED = 10;

const CHANNELS: Channel[] = ["doordash", "appB", "direct"];

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length);
}

/**
 * The baseline uses same-weekday days with no special conditions, because a modifier
 * then adds the home-game or rain effect. Counting those days in the baseline too
 * would apply the effect twice. If there are no plain days, it uses all same-weekday days.
 */
export function buildForecast(
  history: HistoricalOrder[],
  modifiers: ForecastModifier[],
  context: Pick<RestaurantData, "date" | "weekday" | "openHour" | "closeHour">,
): Forecast {
  const sameWeekday = history.filter((o) => o.weekday === context.weekday);
  const plain = sameWeekday.filter((o) => o.tags.length === 0);
  const baselineOrders = plain.length > 0 ? plain : sameWeekday;
  const dates = [...new Set(baselineOrders.map((o) => o.date))];

  // Mix comes from every same-weekday order, so it has the most data behind it.
  const itemTotals: Record<string, number> = {};
  const channelTotals: Record<Channel, number> = { doordash: 0, appB: 0, direct: 0 };
  for (const order of sameWeekday) {
    channelTotals[order.channel] += 1;
    for (const line of order.items) itemTotals[line.menuItemId] = (itemTotals[line.menuItemId] ?? 0) + line.qty;
  }
  const orderCount = Math.max(sameWeekday.length, 1);

  const hourly: ForecastHour[] = [];
  for (let hour = context.openHour; hour < context.closeHour; hour++) {
    const countsPerDay = dates.map((date) => baselineOrders.filter((o) => o.date === date && o.hour === hour).length);
    const active = modifiers.filter((m) => hour >= m.fromHour && hour < m.toHour);
    const multiplier = active.reduce((product, m) => product * m.multiplier, 1);
    const orders = mean(countsPerDay) * multiplier;
    const spread = stdDev(countsPerDay) * multiplier;

    const byItem: Record<string, number> = {};
    for (const [itemId, total] of Object.entries(itemTotals)) byItem[itemId] = orders * (total / orderCount);

    const shares: Record<Channel, number> = {
      doordash: channelTotals.doordash / orderCount,
      appB: channelTotals.appB / orderCount,
      direct: channelTotals.direct / orderCount,
    };
    // Delivery share boost (e.g. rain) moves share from direct to the delivery apps.
    const boost = Math.min(active.reduce((sum, m) => sum + (m.deliveryShareBoost ?? 0), 0), shares.direct);
    const deliveryShare = shares.doordash + shares.appB;
    if (boost > 0 && deliveryShare > 0) {
      shares.doordash += boost * (shares.doordash / deliveryShare);
      shares.appB = 1 - shares.doordash - (shares.direct - boost);
      shares.direct -= boost;
    }

    hourly.push({
      hour,
      orders,
      low: Math.max(orders - spread, 0),
      high: orders + spread,
      byItem,
      byChannel: {
        doordash: orders * shares.doordash,
        appB: orders * shares.appB,
        direct: orders * shares.direct,
      },
    });
  }

  return {
    date: context.date,
    hourly,
    modifiers: [WEEKDAY_NAMES[context.weekday], ...modifiers.map((m) => m.label)],
  };
}

export function totalOrders(forecast: Forecast): number {
  return forecast.hourly.reduce((sum, h) => sum + h.orders, 0);
}

/** Forecast orders between two times, counting part of an hour pro rata. */
export function expectedBetween(forecast: Forecast, from: Minutes, to: Minutes): number {
  let total = 0;
  for (const h of forecast.hourly) {
    const overlap = Math.min(to, (h.hour + 1) * 60) - Math.max(from, h.hour * 60);
    if (overlap > 0) total += (h.orders * overlap) / 60;
  }
  return total;
}

/**
 * Checks the last 60 minutes at the most recent half-hour mark. Always compares with
 * the morning forecast passed in, so scaling never compounds. Returns it unchanged
 * unless the difference exceeds REFORECAST_THRESHOLD.
 */
export function reforecast(forecast: Forecast, orders: Order[], now: Minutes): Forecast {
  // The last check is before close: at close there are no hours left to re-plan.
  const lastHour = forecast.hourly[forecast.hourly.length - 1];
  const lastCheck = lastHour ? (lastHour.hour + 1) * 60 - REFORECAST_CHECK_MINUTES : now;
  const checkAt = Math.min(Math.floor(now / REFORECAST_CHECK_MINUTES) * REFORECAST_CHECK_MINUTES, lastCheck);
  const expected = expectedBetween(forecast, checkAt - 60, checkAt);
  if (expected < REFORECAST_MIN_EXPECTED) return forecast;

  const actual = orders.filter((o) => o.placedAt > checkAt - 60 && o.placedAt <= checkAt).length;
  const ratio = actual / expected;
  if (Math.abs(ratio - 1) <= REFORECAST_THRESHOLD) return forecast;

  const hourly = forecast.hourly.map((h): ForecastHour => {
    const start = h.hour * 60;
    // Share of this hour still to come. Only that part gets scaled.
    const remaining = Math.min(Math.max((start + 60 - checkAt) / 60, 0), 1);
    const scale = 1 - remaining + remaining * ratio;
    if (scale === 1) return h;
    return {
      hour: h.hour,
      orders: h.orders * scale,
      low: h.low * scale,
      high: h.high * scale,
      byItem: Object.fromEntries(Object.entries(h.byItem).map(([id, qty]) => [id, qty * scale])),
      byChannel: Object.fromEntries(CHANNELS.map((c) => [c, h.byChannel[c] * scale])) as Record<Channel, number>,
    };
  });

  return { ...forecast, hourly, scaledBy: ratio, reforecastAt: checkAt };
}

/** The first time today's orders triggered a re-forecast, or null. This is the moment the recap reports. */
export function firstReforecast(forecast: Forecast, orders: Order[], now: Minutes): Forecast | null {
  const first = forecast.hourly[0];
  if (!first) return null;
  for (let check = first.hour * 60; check <= now; check += REFORECAST_CHECK_MINUTES) {
    const result = reforecast(forecast, orders, check);
    if (result.scaledBy !== undefined) return result;
  }
  return null;
}
