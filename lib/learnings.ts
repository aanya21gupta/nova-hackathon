// Code finds the patterns in history; the LLM may cite them but never computes them.
import { WEEKDAY_NAMES } from "./format";
import type { HistoricalOrder, Learning } from "./types";

const EVENING_FROM_HOUR = 17;
const SATURDAY = 6;

function groupByDate(orders: HistoricalOrder[]): Map<string, HistoricalOrder[]> {
  const days = new Map<string, HistoricalOrder[]>();
  for (const order of orders) {
    const day = days.get(order.date);
    if (day) day.push(order);
    else days.set(order.date, [order]);
  }
  return days;
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / Math.max(values.length, 1);
}

function eveningCount(day: HistoricalOrder[]): number {
  return day.filter((o) => o.hour >= EVENING_FROM_HOUR).length;
}

function deliveryShare(day: HistoricalOrder[]): number {
  return day.filter((o) => o.channel !== "direct").length / Math.max(day.length, 1);
}

export function computeLearnings(history: HistoricalOrder[]): Learning[] {
  const learnings: Learning[] = [];
  const days = [...groupByDate(history).values()];

  const saturdays = days.filter((d) => d[0].weekday === SATURDAY);
  const games = saturdays.filter((d) => d[0].tags.includes("homeGame"));
  const normal = saturdays.filter((d) => !d[0].tags.includes("homeGame"));
  if (games.length > 0 && normal.length > 0) {
    const normalAvg = average(normal.map(eveningCount));
    const gameAvg = average(games.map(eveningCount));
    const percent = Math.round((gameAvg / Math.max(normalAvg, 1) - 1) * 100);
    const beat = games.filter((d) => eveningCount(d) > normalAvg).length;
    learnings.push({
      id: "home-game-saturdays",
      text: `Home-game Saturday evenings ran ${percent}% busier than normal Saturdays, and beat a normal Saturday ${beat} of ${games.length} times.`,
      facts: { percent, beat, games: games.length },
    });
  }

  const rainy = days.filter((d) => d[0].tags.includes("rain"));
  const dry = days.filter((d) => !d[0].tags.includes("rain"));
  if (rainy.length > 0 && dry.length > 0) {
    const rainShare = Math.round(average(rainy.map(deliveryShare)) * 100);
    const dryShare = Math.round(average(dry.map(deliveryShare)) * 100);
    learnings.push({
      id: "rain-delivery",
      text: `On rainy days, delivery apps were ${rainShare}% of orders, compared with ${dryShare}% on dry days.`,
      facts: { rainShare, dryShare, rainyDays: rainy.length },
    });
  }

  const averageByWeekday = WEEKDAY_NAMES.map((name, weekday) => ({
    name,
    orders: average(days.filter((d) => d[0].weekday === weekday).map((d) => d.length)),
  }));
  const busiest = averageByWeekday.reduce((a, b) => (b.orders > a.orders ? b : a));
  if (busiest.orders > 0) {
    const orders = Math.round(busiest.orders);
    learnings.push({
      id: "busiest-day",
      text: `${busiest.name} is the busiest day, averaging ${orders} orders.`,
      facts: { weekday: busiest.name, orders },
    });
  }

  return learnings;
}
