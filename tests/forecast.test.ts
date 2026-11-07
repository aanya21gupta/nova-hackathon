import { describe, expect, it } from "vitest";
import { buildForecast, expectedBetween, reforecast, totalOrders } from "@/lib/forecast";
import type { Forecast, ForecastModifier, HistoricalOrder, Order } from "@/lib/types";

const context = { date: "2026-11-07", weekday: 6, openHour: 18, closeHour: 20 };

function past(date: string, hour: number, count: number, tags: HistoricalOrder["tags"] = [], weekday = 6): HistoricalOrder[] {
  return Array.from({ length: count }, () => ({
    date,
    weekday,
    hour,
    channel: "doordash" as const,
    items: [{ menuItemId: "pad-thai", qty: 1 }],
    tags,
  }));
}

function order(id: string, placedAt: number): Order {
  return { id, channel: "direct", placedAt, items: [], targetReadyAt: placedAt + 20, status: "queued" };
}

const flatForecast: Forecast = {
  date: "2026-11-07",
  modifiers: [],
  hourly: [17, 18, 19, 20].map((hour) => ({
    hour,
    orders: 30,
    low: 25,
    high: 35,
    byItem: { "pad-thai": 30 },
    byChannel: { doordash: 15, appB: 5, direct: 10 },
  })),
};

describe("buildForecast", () => {
  it("averages the same weekday and hour", () => {
    const history = [...past("a", 18, 10), ...past("b", 18, 20)];
    const forecast = buildForecast(history, [], context);
    expect(forecast.hourly[0].orders).toBe(15);
    expect(forecast.hourly[1].orders).toBe(0);
  });

  it("gives a band of one standard deviation", () => {
    const history = [...past("a", 18, 10), ...past("b", 18, 20)];
    const { low, high } = buildForecast(history, [], context).hourly[0];
    expect(low).toBe(10);
    expect(high).toBe(20);
  });

  it("ignores other weekdays", () => {
    const history = [...past("a", 18, 10), ...past("mon", 18, 99, [], 1)];
    expect(buildForecast(history, [], context).hourly[0].orders).toBe(10);
  });

  it("applies a modifier only in its hours, and doesn't count tagged days in the baseline", () => {
    const history = [...past("a", 18, 10), ...past("a", 19, 10), ...past("game", 19, 99, ["homeGame"])];
    const modifier: ForecastModifier = { tag: "homeGame", label: "Game", multiplier: 1.5, fromHour: 19, toHour: 20 };
    const forecast = buildForecast(history, [modifier], context);
    expect(forecast.hourly[0].orders).toBe(10);
    expect(forecast.hourly[1].orders).toBe(15);
  });

  it("moves share to delivery apps without changing total orders", () => {
    const history = [
      ...past("a", 18, 6),
      ...past("a", 18, 4).map((o) => ({ ...o, channel: "direct" as const })),
    ];
    const rain: ForecastModifier = { tag: "rain", label: "Rain", multiplier: 1, fromHour: 18, toHour: 20, deliveryShareBoost: 0.2 };
    const { byChannel, orders } = buildForecast(history, [rain], context).hourly[0];
    expect(byChannel.direct).toBeCloseTo(2);
    expect(byChannel.doordash + byChannel.appB + byChannel.direct).toBeCloseTo(orders);
  });

  it("splits into items by historical mix", () => {
    const history = [...past("a", 18, 10), { ...past("a", 18, 1)[0], items: [{ menuItemId: "tea", qty: 5 }] }];
    const hour = buildForecast(history, [], context).hourly[0];
    expect(hour.byItem["pad-thai"] / hour.byItem.tea).toBeCloseTo(2);
  });
});

describe("reforecast", () => {
  const ordersIn = (count: number, from: number) =>
    Array.from({ length: count }, (_, i) => order(`o${i}`, from + 1 + Math.floor((i * 59) / count)));

  it("does nothing within 20%", () => {
    const orders = ordersIn(35, 1080); // 6pm to 7pm: 35 against 30 expected.
    expect(reforecast(flatForecast, orders, 1140).scaledBy).toBeUndefined();
  });

  it("scales only the remaining hours by the observed ratio", () => {
    const orders = ordersIn(45, 1080); // 45 against 30: ratio 1.5.
    const result = reforecast(flatForecast, orders, 1140);
    expect(result.scaledBy).toBeCloseTo(1.5);
    expect(result.reforecastAt).toBe(1140);
    expect(result.hourly[1].orders).toBe(30); // 6pm is in the past.
    expect(result.hourly[2].orders).toBeCloseTo(45); // 7pm is still to come.
    expect(result.hourly[2].byItem["pad-thai"]).toBeCloseTo(45);
  });

  it("scales part of an hour pro rata", () => {
    const orders = ordersIn(45, 1110); // 6:30 to 7:30.
    const result = reforecast(flatForecast, orders, 1170);
    expect(result.hourly[2].orders).toBeCloseTo(37.5); // Half of 7pm scaled by 1.5.
  });

  it("scales down when orders fall short", () => {
    const orders = ordersIn(15, 1080);
    expect(reforecast(flatForecast, orders, 1140).hourly[2].orders).toBeCloseTo(15);
  });

  it("ignores small numbers", () => {
    const quiet: Forecast = { ...flatForecast, hourly: flatForecast.hourly.map((h) => ({ ...h, orders: 3 })) };
    expect(reforecast(quiet, ordersIn(9, 1080), 1140).scaledBy).toBeUndefined();
  });

  it("only changes at half-hour checks", () => {
    const orders = ordersIn(45, 1080);
    expect(reforecast(flatForecast, orders, 1140).scaledBy).toBe(reforecast(flatForecast, orders, 1169).scaledBy);
  });
});

describe("helpers", () => {
  it("counts part of an hour", () => {
    expect(expectedBetween(flatForecast, 1050, 1110)).toBeCloseTo(30);
    expect(totalOrders(flatForecast)).toBe(120);
  });
});
