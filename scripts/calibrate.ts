/**
 * Turn the raw datasets in data/external/ into a small, committed summary:
 * data/calibration.json. The seed generator can read that file, so the app
 * never needs the raw data (or the internet) to run.
 *
 *   npx tsx scripts/fetch-data.ts   # first, if data/external/ is empty
 *   npx tsx scripts/calibrate.ts
 *
 * Only derived numbers go in the output — no raw rows — plus where each came from.
 * Pure Node, no dependencies, so it runs on any teammate's laptop.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const EXT = path.join(ROOT, "data", "external");
const OUT = path.join(ROOT, "data", "calibration.json");
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ── helpers ──────────────────────────────────────────────────────────────────
function readCsv(file: string): Record<string, string>[] {
  const p = path.join(EXT, file);
  if (!existsSync(p)) throw new Error(`Missing ${p}. Run: npx tsx scripts/fetch-data.ts`);
  const lines = readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean);
  const split = (l: string) => l.split(",").map((c) => c.replace(/^"|"$/g, "")); // these files have no quoted commas
  const header = split(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = split(l);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
}
const r = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
function quantile(xs: number[], q: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}
const weekdayOf = (isoDate: string) => new Date(isoDate + "T00:00:00Z").getUTCDay();

// ── 1) Pizza: demand shape for a single small restaurant ─────────────────────
function pizza() {
  const rows = readCsv("pizzaplace.csv");
  const orders = new Map<string, { date: string; hour: number; items: number }>();
  for (const row of rows) {
    const o = orders.get(row.id) ?? { date: row.date, hour: Number(row.time.slice(0, 2)), items: 0 };
    o.items += 1;
    orders.set(row.id, o);
  }
  const perDay = new Map<string, number>();
  for (const o of orders.values()) perDay.set(o.date, (perDay.get(o.date) ?? 0) + 1);

  // Weekday multiplier = avg orders on that weekday ÷ avg across weekdays.
  const byWd: number[][] = Array.from({ length: 7 }, () => []);
  for (const [d, n] of perDay) byWd[weekdayOf(d)].push(n);
  const wdAvg = byWd.map(mean);
  const overall = mean(wdAvg);

  const hourCounts = new Map<number, number>();
  for (const o of orders.values()) hourCounts.set(o.hour, (hourCounts.get(o.hour) ?? 0) + 1);
  const total = orders.size;
  const hourShare = Object.fromEntries(
    [...hourCounts.entries()].sort((a, b) => a[0] - b[0])
      .filter(([, n]) => n / total >= 0.005) // drop near-empty edge hours
      .map(([h, n]) => [h, r(n / total)]),
  );

  return {
    source: "Rdatasets gt::pizzaplace (public domain), one pizza restaurant, 2015",
    orders: total,
    daysOpen: perDay.size,
    ordersPerDay: r(total / perDay.size, 1),
    itemsPerOrder: r(rows.length / total, 2),
    weekdayMultiplier: Object.fromEntries(WEEKDAYS.map((w, i) => [w, r(wdAvg[i] / overall, 2)])),
    hourShare,
  };
}

// ── 2) DoorDash: how long delivery takes, and how often it runs late ─────────
function doordash() {
  const rows = readCsv("doordash_historical_data.csv");
  const PACIFIC_OFFSET_H = -8; // data is Jan–Feb 2015 (PST); timestamps are UTC
  const parse = (s: string) => Date.parse(s.replace(" ", "T") + "Z");

  const durations: number[] = [];
  const thai: number[] = [];
  const unexplained: number[] = []; // total − (order-place estimate + driving estimate) ≈ kitchen + waiting
  const hourCounts = new Array(24).fill(0);

  for (const row of rows) {
    if (!row.created_at || row.created_at === "NA" || !row.actual_delivery_time || row.actual_delivery_time === "NA") continue;
    const created = parse(row.created_at);
    const mins = (parse(row.actual_delivery_time) - created) / 60000;
    if (!(mins >= 5 && mins <= 240)) continue; // drop broken rows
    durations.push(mins);
    if (row.store_primary_category === "thai") thai.push(mins);
    hourCounts[(new Date(created).getUTCHours() + 24 + PACIFIC_OFFSET_H) % 24]++;
    const place = Number(row.estimated_order_place_duration);
    const drive = Number(row.estimated_store_to_consumer_driving_duration);
    if (Number.isFinite(place) && Number.isFinite(drive) && row.estimated_store_to_consumer_driving_duration !== "NA") {
      unexplained.push(mins - (place + drive) / 60);
    }
  }
  const med = quantile(unexplained, 0.5);
  const lateBy = (m: number) => r(unexplained.filter((x) => x - med >= m).length / unexplained.length, 3);
  const totalH = hourCounts.reduce((s, n) => s + n, 0);

  return {
    source: "DoorDash take-home historical_data.csv (MIT per Kaggle listing; DoorDash added noise). Use as rough shapes only.",
    deliveries: durations.length,
    thaiDeliveries: thai.length,
    deliveryMinutes: { p10: r(quantile(durations, 0.1), 1), median: r(quantile(durations, 0.5), 1), p90: r(quantile(durations, 0.9), 1) },
    thaiDeliveryMinutes: { median: r(quantile(thai, 0.5), 1), p90: r(quantile(thai, 0.9), 1) },
    kitchenAndWaitMinutes: { p25: r(quantile(unexplained, 0.25), 1), median: r(med, 1), p75: r(quantile(unexplained, 0.75), 1), p90: r(quantile(unexplained, 0.9), 1) },
    shareRunningLateBy: { "5min": lateBy(5), "12min": lateBy(12), "20min": lateBy(20) },
    hourShareLocalTime: Object.fromEntries(
      hourCounts.map((n, h) => [h, r(n / totalH)]).filter(([, s]) => (s as number) >= 0.005),
    ),
  };
}

// ── 3) Weather: how often it actually rains ──────────────────────────────────
function weather() {
  const file = existsSync(EXT) ? readdirJson() : null;
  if (!file) throw new Error("Missing Open-Meteo JSON. Run: npx tsx scripts/fetch-data.ts");
  const data = JSON.parse(readFileSync(path.join(EXT, file), "utf8")) as {
    latitude: number; longitude: number; hourly: { time: string[]; precipitation: (number | null)[] };
  };
  const byDay = new Map<string, number>();
  data.hourly.time.forEach((t, i) => {
    const p = data.hourly.precipitation[i];
    if (p != null) byDay.set(t.slice(0, 10), (byDay.get(t.slice(0, 10)) ?? 0) + p);
  });
  const days = [...byDay.entries()];
  const share = (mm: number) => r(days.filter(([, v]) => v >= mm).length / days.length, 3);
  const sats = days.filter(([d]) => weekdayOf(d) === 6);
  return {
    source: `Open-Meteo historical archive (CC BY 4.0), ${file}`,
    location: { lat: data.latitude, lon: data.longitude },
    days: days.length,
    shareOfDaysWithRain: { "1mm+": share(1), "5mm+": share(5), "10mm+": share(10) },
    saturdaysWithRain5mm: sats.filter(([, v]) => v >= 5).length,
  };
}
function readdirJson(): string | null {
  return readdirSync(EXT).find((f) => f.startsWith("openmeteo_") && f.endsWith(".json")) ?? null;
}

// ── main ─────────────────────────────────────────────────────────────────────
const calibration = {
  generatedAt: new Date().toISOString().slice(0, 10),
  note: "Derived summary stats only. Regenerate with: npx tsx scripts/fetch-data.ts && npx tsx scripts/calibrate.ts",
  pizza: pizza(),
  doordash: doordash(),
  weather: weather(),
};
writeFileSync(OUT, JSON.stringify(calibration, null, 2) + "\n");
console.log(JSON.stringify(calibration, null, 2));
console.log(`\nWrote ${OUT}`);
