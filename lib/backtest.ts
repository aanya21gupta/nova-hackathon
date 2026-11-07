// M3: a forecast that measures and improves itself.
//
// Backtest: walk forward through the last 4 weeks. Each day is forecast using ONLY the
// days before it, then compared with what really happened, for three forecasts:
//   (a) naive    = the same hour on the same weekday last week
//   (b) current  = the app's forecast (lib/forecast.ts): plain-day average × fixed modifiers
//   (c) learning = the same average × multipliers that get nudged every night
//
// Learning, in one sentence: "Each night Spine compares its forecast to what really
// happened and nudges its multipliers." The nudge is exponential smoothing:
//   multiplier ← multiplier + LEARNING_RATE × (observed ratio − multiplier)
// Pure and deterministic. No ML library, nothing random.
import type { DayTag, HistoricalOrder, RestaurantData } from "./types";

export const LEARNING_RATE = 0.2;
export const BACKTEST_DAYS = 28;

export interface Multipliers {
  /** Corrects the plain-day average for each weekday (0 = Sunday). Starts at 1. */
  dayOfWeek: number[];
  /** Evening lift on home-game days. Starts at the configured value. */
  homeGame: number;
  /** Whole-day lift on rainy days. Starts at 1 (no assumption). */
  rain: number;
}

export interface DayResult {
  date: string;
  weekday: number;
  tags: DayTag[];
  /** Orders per open hour, from openHour. */
  actual: number[];
  naive: number[] | null;
  current: number[];
  learning: number[];
}

export interface MultiplierChange {
  factor: "dayOfWeek" | "homeGame" | "rain";
  label: string;
  before: number;
  after: number;
  /** What that day actually showed: actual ÷ forecast without this factor. */
  observed: number;
}

export interface Errors {
  naive: number;
  current: number;
  learning: number;
}

export interface BacktestResult {
  days: DayResult[];
  /** Mean absolute error, in orders per hour, over every hour of every backtest day. */
  mae: Errors;
  /** The same, as a % of the average orders per hour. */
  maePercent: Errors;
  weekly: ({ label: string } & Errors)[];
  configuredHomeGame: number;
  start: Multipliers;
  end: Multipliers;
  /** What the most recent nightly update changed. */
  lastNight: { date: string; weekday: number; changes: MultiplierChange[] } | null;
}

interface Day {
  date: string;
  weekday: number;
  tags: DayTag[];
  counts: number[];
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Group history into days with hourly order counts, oldest first. */
export function toDays(history: HistoricalOrder[], openHour: number, closeHour: number): Day[] {
  const byDate = new Map<string, Day>();
  for (const o of history) {
    let day = byDate.get(o.date);
    if (!day) {
      day = { date: o.date, weekday: o.weekday, tags: o.tags, counts: new Array(closeHour - openHour).fill(0) };
      byDate.set(o.date, day);
    }
    if (o.hour >= openHour && o.hour < closeHour) day.counts[o.hour - openHour] += 1;
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Same rule as buildForecast: average of plain same-weekday days, or all same-weekday days if none are plain. */
export function baselineFrom(training: Day[], weekday: number, hours: number): number[] | null {
  const same = training.filter((d) => d.weekday === weekday);
  if (same.length === 0) return null;
  const plain = same.filter((d) => d.tags.length === 0);
  const use = plain.length > 0 ? plain : same;
  return Array.from({ length: hours }, (_, i) => use.reduce((s, d) => s + d.counts[i], 0) / use.length);
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** Exponential smoothing: move part of the way toward what was observed. */
export function nudge(current: number, observed: number, rate = LEARNING_RATE): number {
  return current + rate * (observed - current);
}

export function runBacktest(
  data: RestaurantData,
  backtestDays = BACKTEST_DAYS,
  /** "configured" starts home games at data.modifiers; "scratch" starts at ×1 and must learn it. */
  startFrom: "configured" | "scratch" = "configured",
): BacktestResult {
  const hours = data.closeHour - data.openHour;
  const game = data.modifiers.find((m) => m.tag === "homeGame");
  const gameFrom = game?.fromHour ?? 17;
  const gameTo = game?.toHour ?? data.closeHour;
  const configuredHomeGame = game?.multiplier ?? 1;
  const inGameHours = (i: number) => data.openHour + i >= gameFrom && data.openHour + i < gameTo;

  const days = toDays(data.history, data.openHour, data.closeHour);
  const start: Multipliers = { dayOfWeek: new Array(7).fill(1), homeGame: startFrom === "scratch" ? 1 : configuredHomeGame, rain: 1 };
  const m: Multipliers = { dayOfWeek: [...start.dayOfWeek], homeGame: start.homeGame, rain: start.rain };
  const results: DayResult[] = [];
  let lastNight: BacktestResult["lastNight"] = null;

  for (let index = 0; index < days.length; index++) {
    const day = days[index];
    const training = days.slice(0, index); // Only the past. Never days[index] or later.
    const base = baselineFrom(training, day.weekday, hours);
    if (!base) continue;

    const isGame = day.tags.includes("homeGame");
    const isRain = day.tags.includes("rain");
    const gameAt = (i: number, mult: number) => (isGame && inGameHours(i) ? mult : 1);

    // (b) The app's forecast: only the configured modifiers (data.modifiers), applied on tagged days.
    const current = base.map((b, i) => b * gameAt(i, configuredHomeGame));
    // (c) The learning forecast, with tonight's multipliers.
    const dow = m.dayOfWeek[day.weekday];
    const rainMult = isRain ? m.rain : 1;
    const learning = base.map((b, i) => b * dow * gameAt(i, m.homeGame) * rainMult);

    if (index >= days.length - backtestDays) {
      const lastWeek = days.find((d) => d.date === addDays(day.date, -7));
      results.push({ date: day.date, weekday: day.weekday, tags: day.tags, actual: day.counts, naive: lastWeek ? lastWeek.counts : null, current, learning });
    }

    // ---- Tonight's learning step: each factor is judged with the others held fixed. ----
    const changes: MultiplierChange[] = [];
    const actual = day.counts;

    if (isGame) {
      const idx = actual.map((_, i) => i).filter(inGameHours);
      const expected = sum(idx.map((i) => base[i] * dow * rainMult));
      if (expected > 0) {
        const observed = sum(idx.map((i) => actual[i])) / expected;
        changes.push({ factor: "homeGame", label: "Home games", before: m.homeGame, after: nudge(m.homeGame, observed), observed });
        m.homeGame = nudge(m.homeGame, observed);
      }
    }
    if (isRain) {
      const expected = sum(base.map((b, i) => b * dow * gameAt(i, m.homeGame)));
      if (expected > 0) {
        const observed = sum(actual) / expected;
        changes.push({ factor: "rain", label: "Rainy days", before: m.rain, after: nudge(m.rain, observed), observed });
        m.rain = nudge(m.rain, observed);
      }
    }
    if (day.tags.length === 0) {
      const expected = sum(base);
      if (expected > 0) {
        const observed = sum(actual) / expected;
        const before = m.dayOfWeek[day.weekday];
        m.dayOfWeek[day.weekday] = nudge(before, observed);
        changes.push({ factor: "dayOfWeek", label: `${WEEKDAYS[day.weekday]}s`, before, after: m.dayOfWeek[day.weekday], observed });
      }
    }
    lastNight = { date: day.date, weekday: day.weekday, changes };
  }

  const mae = errorsOver(results);
  const avgActual = mean(results.flatMap((d) => d.actual));
  const pct = (x: number) => (avgActual > 0 ? (x / avgActual) * 100 : 0);

  const weekly: BacktestResult["weekly"] = [];
  for (let w = 0; w * 7 < results.length; w++) {
    const week = results.slice(w * 7, w * 7 + 7);
    weekly.push({ label: `Week ${w + 1}`, ...errorsOver(week) });
  }

  return {
    days: results,
    mae,
    maePercent: { naive: pct(mae.naive), current: pct(mae.current), learning: pct(mae.learning) },
    weekly,
    configuredHomeGame,
    start,
    end: m,
    lastNight,
  };
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : sum(xs) / xs.length;
}

function errorsOver(days: DayResult[]): Errors {
  const abs = (pred: (d: DayResult) => number[] | null) =>
    mean(days.flatMap((d) => {
      const p = pred(d);
      return p ? d.actual.map((a, i) => Math.abs(p[i] - a)) : [];
    }));
  return { naive: abs((d) => d.naive), current: abs((d) => d.current), learning: abs((d) => d.learning) };
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Plain-English lines for the card. Every number comes from the backtest result. */
export function learnedLines(result: BacktestResult): string[] {
  const lines: string[] = [];
  const pct = (x: number) => Math.round((x - 1) * 100);
  const learnedGame = pct(result.end.homeGame);
  const configuredGame = pct(result.configuredHomeGame);
  lines.push(
    Math.abs(learnedGame - configuredGame) >= 2
      ? `Home games bring ${learnedGame}% more evening orders, not ${configuredGame}%.`
      : `Home games bring about ${learnedGame}% more evening orders, as planned.`,
  );
  const rain = pct(result.end.rain);
  lines.push(
    Math.abs(rain) < 3
      ? "Rain changes who orders (more delivery), not how many."
      : `Rainy days bring ${Math.abs(rain)}% ${rain > 0 ? "more" : "fewer"} orders.`,
  );
  const night = result.lastNight?.changes.find((c) => c.factor === "dayOfWeek");
  if (night) {
    const diff = Math.round((night.observed - 1) * 100);
    lines.unshift(
      Math.abs(diff) < 2
        ? `${night.label} came in right on plan.`
        : `${night.label} ran ${Math.abs(diff)}% ${diff > 0 ? "busier" : "quieter"} than the usual average, so Spine nudged ${night.label} from ×${night.before.toFixed(2)} to ×${night.after.toFixed(2)}.`,
    );
  }
  return lines;
}
