import { describe, expect, it } from "vitest";
import { getData } from "@/data";
import { baselineFrom, BACKTEST_DAYS, learnedLines, LEARNING_RATE, nudge, runBacktest, toDays } from "@/lib/backtest";
import { buildForecast } from "@/lib/forecast";
import type { RestaurantData } from "@/lib/types";

const data = getData();
const result = runBacktest(data);

describe("backtest", () => {
  it("covers the last 4 weeks, one result per day", () => {
    expect(result.days).toHaveLength(BACKTEST_DAYS);
    expect(result.weekly).toHaveLength(4);
  });

  it("uses no future data: cutting off history after a day doesn't change that day's forecasts", () => {
    for (const day of result.days.filter((_, i) => i % 5 === 0)) {
      const truncated: RestaurantData = { ...data, history: data.history.filter((o) => o.date <= day.date) };
      const again = runBacktest(truncated, 1).days.at(-1)!;
      expect(again.date).toBe(day.date);
      expect(again.current).toEqual(day.current);
      expect(again.learning).toEqual(day.learning);
      expect(again.naive).toEqual(day.naive);
    }
  });

  it("forecast (b) is exactly the app's forecast built from the earlier days only", () => {
    const day = result.days[10];
    const earlier = data.history.filter((o) => o.date < day.date);
    const modifiers = day.tags.includes("homeGame") ? data.modifiers : [];
    const app = buildForecast(earlier, modifiers, { date: day.date, weekday: day.weekday, openHour: data.openHour, closeHour: data.closeHour });
    app.hourly.forEach((h, i) => expect(day.current[i]).toBeCloseTo(h.orders, 9));
  });

  it("naive (a) is the same hour on the same weekday last week", () => {
    const days = toDays(data.history, data.openHour, data.closeHour);
    const day = result.days[3];
    const lastWeek = days.find((d) => d.weekday === day.weekday && d.date < day.date && days.indexOf(d) === days.findIndex((x) => x.date === day.date) - 7);
    expect(day.naive).toEqual(lastWeek?.counts);
  });

  it("the real forecast beats 'same as last week'", () => {
    expect(result.mae.current).toBeLessThan(result.mae.naive);
    expect(result.mae.learning).toBeLessThan(result.mae.naive);
  });

  it("is deterministic", () => {
    expect(runBacktest(data)).toEqual(result);
  });
});

describe("learning step", () => {
  it("moves a multiplier part of the way toward the observed ratio", () => {
    expect(nudge(1.0, 1.5)).toBeCloseTo(1.0 + LEARNING_RATE * 0.5, 10);
    expect(Math.abs(nudge(1.3, 1.1) - 1.1)).toBeLessThan(Math.abs(1.3 - 1.1));
    expect(nudge(1.2, 1.2)).toBe(1.2);
  });

  it("learns the home-game lift from history when it starts knowing nothing", () => {
    const scratch = runBacktest(data, BACKTEST_DAYS, "scratch");
    expect(scratch.start.homeGame).toBe(1);
    expect(scratch.end.homeGame).toBeGreaterThan(1.1); // moved toward the real ~1.3
  });

  it("baseline matches buildForecast's rule (plain same-weekday days)", () => {
    const days = toDays(data.history, data.openHour, data.closeHour);
    const base = baselineFrom(days, data.weekday, data.closeHour - data.openHour)!;
    const app = buildForecast(data.history, [], data);
    app.hourly.forEach((h, i) => expect(base[i]).toBeCloseTo(h.orders, 9));
  });

  it("explains what it learned using only computed numbers", () => {
    const lines = learnedLines(result);
    expect(lines.some((l) => l.includes("Home games"))).toBe(true);
    expect(lines.join(" ")).toContain(`${Math.round((result.end.homeGame - 1) * 100)}%`);
  });
});
