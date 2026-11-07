// Fake data for one Saturday at Basil & Rice. Everything is generated from a fixed
// random seed, so every run is identical. To use a real dataset, change data/index.ts.
import { buildForecast, expectedBetween } from "@/lib/forecast";
import { round2 } from "@/lib/format";
import type {
  Channel,
  DayTag,
  ForecastModifier,
  HistoricalOrder,
  Ingredient,
  Invoice,
  MenuItem,
  Order,
  OrderLine,
  Payout,
  RestaurantData,
  StaffMember,
} from "@/lib/types";

const DATE = "2026-11-07";
const WEEKDAY = 6;
const OPEN_HOUR = 11;
const CLOSE_HOUR = 21;
const at = (hour: number, minute = 0) => hour * 60 + minute;

/** A small seeded random number generator (mulberry32). */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Random = ReturnType<typeof makeRandom>;

function weightedPick<T>(random: Random, options: [T, number][]): T {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of options) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return options[options.length - 1][0];
}

const MENU: MenuItem[] = [
  { id: "pad-thai", name: "Pad Thai", price: 15, prepMinutes: 8, station: "wok", recipe: [
    { ingredientId: "noodles", qty: 0.3, unit: "lb" }, { ingredientId: "chicken", qty: 0.3, unit: "lb" },
    { ingredientId: "pad-thai-sauce", qty: 0.12, unit: "qt" }, { ingredientId: "vegetables", qty: 0.2, unit: "lb" },
    { ingredientId: "boxes", qty: 1, unit: "each" } ] },
  { id: "green-curry", name: "Green Curry", price: 16, prepMinutes: 10, station: "wok", recipe: [
    { ingredientId: "chicken", qty: 0.35, unit: "lb" }, { ingredientId: "curry-base", qty: 0.25, unit: "qt" },
    { ingredientId: "rice", qty: 0.35, unit: "lb" }, { ingredientId: "vegetables", qty: 0.2, unit: "lb" },
    { ingredientId: "boxes", qty: 1, unit: "each" } ] },
  { id: "basil-chicken", name: "Basil Chicken", price: 15, prepMinutes: 7, station: "wok", recipe: [
    { ingredientId: "chicken", qty: 0.4, unit: "lb" }, { ingredientId: "basil", qty: 0.15, unit: "bunch" },
    { ingredientId: "rice", qty: 0.35, unit: "lb" }, { ingredientId: "boxes", qty: 1, unit: "each" } ] },
  { id: "fried-rice", name: "Thai Fried Rice", price: 14, prepMinutes: 7, station: "wok", recipe: [
    { ingredientId: "rice", qty: 0.45, unit: "lb" }, { ingredientId: "chicken", qty: 0.25, unit: "lb" },
    { ingredientId: "vegetables", qty: 0.15, unit: "lb" }, { ingredientId: "boxes", qty: 1, unit: "each" } ] },
  { id: "tom-yum", name: "Tom Yum Soup", price: 12, prepMinutes: 9, station: "wok", recipe: [
    { ingredientId: "tom-yum-broth", qty: 0.5, unit: "qt" }, { ingredientId: "vegetables", qty: 0.15, unit: "lb" },
    { ingredientId: "boxes", qty: 1, unit: "each" } ] },
  { id: "spring-rolls", name: "Spring Rolls", price: 8, prepMinutes: 5, station: "fryer", recipe: [
    { ingredientId: "wrappers", qty: 3, unit: "each" }, { ingredientId: "vegetables", qty: 0.12, unit: "lb" },
    { ingredientId: "boxes", qty: 1, unit: "each" } ] },
  { id: "thai-tea", name: "Thai Iced Tea", price: 5, prepMinutes: 2, station: "packing", recipe: [
    { ingredientId: "tea-mix", qty: 0.12, unit: "qt" } ] },
];

/** How often each item shows up. Pad Thai is the favorite. */
const ITEM_WEIGHTS: [string, number][] = [
  ["pad-thai", 30], ["green-curry", 18], ["basil-chicken", 16], ["fried-rice", 12],
  ["tom-yum", 6], ["spring-rolls", 12], ["thai-tea", 8],
];

const CHANNEL_WEIGHTS: [Channel, number][] = [["doordash", 45], ["appB", 20], ["direct", 35]];
const RAIN_CHANNEL_WEIGHTS: [Channel, number][] = [["doordash", 55], ["appB", 25], ["direct", 20]];

/** Normal Saturday orders per hour, from 11am. Other weekdays are a fraction of this. */
const SATURDAY_PROFILE = [14, 20, 16, 8, 5, 8, 18, 30, 32, 20];
const WEEKDAY_FACTOR = [0.8, 0.72, 0.72, 0.75, 0.8, 0.95, 1];
const HOME_GAME_MULTIPLIER = 1.3;
const HOME_GAME_FROM_HOUR = 17;

const INGREDIENTS: Ingredient[] = [
  // The on-hand amounts for noodles and rice are tuned so the story's run-out times hold.
  { id: "noodles", name: "Pad Thai noodles", unit: "lb", onHand: 31.5, parLevel: 10, packSize: 10, supplierId: "thai-harvest", lastUnitPrice: 3.4 },
  { id: "rice", name: "Jasmine rice", unit: "lb", onHand: 46.5, parLevel: 25, packSize: 50, supplierId: "thai-harvest", lastUnitPrice: 1.6 },
  { id: "chicken", name: "Chicken thighs", unit: "lb", onHand: 120, parLevel: 30, packSize: 40, supplierId: "valley-meats", lastUnitPrice: 3.5 },
  { id: "vegetables", name: "Mixed vegetables", unit: "lb", onHand: 80, parLevel: 15, packSize: 20, supplierId: "valley-produce", lastUnitPrice: 2.8 },
  { id: "basil", name: "Thai basil", unit: "bunch", onHand: 25, parLevel: 8, packSize: 12, supplierId: "valley-produce", lastUnitPrice: 2.5 },
  { id: "curry-base", name: "Curry base", unit: "qt", onHand: 30, parLevel: 6, packSize: 4, supplierId: "thai-harvest", lastUnitPrice: 11 },
  { id: "pad-thai-sauce", name: "Pad Thai sauce", unit: "qt", onHand: 25, parLevel: 4, packSize: 4, supplierId: "thai-harvest", lastUnitPrice: 12 },
  { id: "tom-yum-broth", name: "Tom yum broth", unit: "qt", onHand: 25, parLevel: 4, packSize: 4, supplierId: "thai-harvest", lastUnitPrice: 7.5 },
  { id: "wrappers", name: "Spring roll wrappers", unit: "each", onHand: 300, parLevel: 60, packSize: 50, supplierId: "thai-harvest", lastUnitPrice: 0.3 },
  { id: "tea-mix", name: "Thai tea mix", unit: "qt", onHand: 15, parLevel: 3, packSize: 2, supplierId: "thai-harvest", lastUnitPrice: 12 },
  { id: "boxes", name: "Takeout boxes", unit: "each", onHand: 500, parLevel: 100, packSize: 100, supplierId: "valley-produce", lastUnitPrice: 0.55 },
];

/** Listed here means it gets prep tasks. The number is how much is prepped already. */
const PREPPED: Record<string, number> = { "curry-base": 2, "pad-thai-sauce": 3, "tom-yum-broth": 1, vegetables: 5 };

const STAFF: StaffMember[] = [
  { id: "mai", name: "Mai", skills: ["register", "packing"], hourlyRate: 20, availability: [{ start: at(10, 30), end: at(21) }] },
  { id: "dev", name: "Dev", skills: ["wok"], hourlyRate: 22, availability: [{ start: at(10, 30), end: at(21) }] },
  { id: "priya", name: "Priya", skills: ["fryer", "packing"], hourlyRate: 18, availability: [{ start: at(10, 30), end: at(17) }] },
  { id: "lina", name: "Lina", skills: ["fryer", "packing"], hourlyRate: 18, availability: [{ start: at(17), end: at(21) }] },
  { id: "sam", name: "Sam", skills: ["packing", "register"], hourlyRate: 17, availability: [{ start: at(15), end: at(21) }] },
  { id: "tomas", name: "Tomas", skills: ["packing"], hourlyRate: 16, availability: [{ start: at(11), end: at(15) }, { start: at(17), end: at(21) }] },
];

const MODIFIERS: ForecastModifier[] = [
  { tag: "homeGame", label: "Home game tonight", multiplier: HOME_GAME_MULTIPLIER, fromHour: HOME_GAME_FROM_HOUR, toHour: CLOSE_HOUR },
];

/** 1 to 3 items per order. */
function randomItems(random: Random): OrderLine[] {
  const lineCount = weightedPick(random, [[1, 45], [2, 40], [3, 15]] as [number, number][]);
  const lines: OrderLine[] = [];
  for (let i = 0; i < lineCount; i++) {
    const menuItemId = weightedPick(random, ITEM_WEIGHTS);
    const existing = lines.find((l) => l.menuItemId === menuItemId);
    if (existing) existing.qty += 1;
    else lines.push({ menuItemId, qty: 1 });
  }
  return lines;
}

function gaussian(random: Random): number {
  return Math.sqrt(-2 * Math.log(Math.max(random(), 1e-9))) * Math.cos(2 * Math.PI * random());
}

/** The 8 weeks before the demo Saturday. Every second Saturday is a home game. */
function buildHistory(random: Random): HistoricalOrder[] {
  const orders: HistoricalOrder[] = [];
  const demoDay = Date.UTC(2026, 10, 7);
  let saturdayCount = 0;

  for (let daysAgo = 56; daysAgo >= 1; daysAgo--) {
    const day = new Date(demoDay - daysAgo * 86_400_000);
    const date = day.toISOString().slice(0, 10);
    const weekday = day.getUTCDay();
    const tags: DayTag[] = [];
    if (weekday === 6 && saturdayCount++ % 2 === 1) tags.push("homeGame");
    if (random() < 0.15) tags.push("rain");
    const channels = tags.includes("rain") ? RAIN_CHANNEL_WEIGHTS : CHANNEL_WEIGHTS;

    SATURDAY_PROFILE.forEach((base, index) => {
      const hour = OPEN_HOUR + index;
      const game = tags.includes("homeGame") && hour >= HOME_GAME_FROM_HOUR ? HOME_GAME_MULTIPLIER : 1;
      const count = Math.max(Math.round(base * WEEKDAY_FACTOR[weekday] * game * (1 + gaussian(random) * 0.08)), 0);
      for (let i = 0; i < count; i++) {
        orders.push({ date, weekday, hour, channel: weightedPick(random, channels), items: randomItems(random), tags });
      }
    });
  }
  return orders;
}

function makeOrder(random: Random, id: string, placedAt: number): Order {
  const channel = weightedPick(random, CHANNEL_WEIGHTS);
  const items = randomItems(random);
  if (channel === "direct") {
    return { id, channel, placedAt, items, targetReadyAt: placedAt + 18 + Math.floor(random() * 10), status: "queued" };
  }
  const eta = placedAt + 22 + Math.floor(random() * 13);
  return { id, channel, placedAt, items, targetReadyAt: eta, driverEtaAt: eta, status: "queued" };
}

/** The Saturday replay: each hour close to forecast, so the happy path never re-forecasts. */
const HOURLY_TWEAK = [0, 1, -1, 0, 0, 1, 0, -1, 1, 2];
const RUSH_SIZE = 0.35;

function addPadThai(order: Order) {
  const line = order.items.find((l) => l.menuItemId === "pad-thai");
  if (line) line.qty += 1;
  else order.items.push({ menuItemId: "pad-thai", qty: 1 });
}

function build(): RestaurantData {
  const random = makeRandom(20261107);
  const history = buildHistory(random);
  const forecast = buildForecast(history, MODIFIERS, { date: DATE, weekday: WEEKDAY, openHour: OPEN_HOUR, closeHour: CLOSE_HOUR });

  const orders: Order[] = [];
  forecast.hourly.forEach((h, index) => {
    const count = Math.max(Math.round(h.orders) + HOURLY_TWEAK[index], 0);
    for (let i = 0; i < count; i++) {
      const placedAt = at(h.hour) + Math.floor(((i + 0.5) * 60) / count);
      orders.push(makeOrder(random, "pending", placedAt));
    }
  });
  orders.sort((a, b) => a.placedAt - b.placedAt);
  orders.forEach((order, index) => {
    order.id = `o${index + 1}`;
  });

  // Rush orders add 35% to each half hour from 5:30pm to close.
  const rushOrders: Order[] = [];
  for (let start = at(17, 30); start < at(CLOSE_HOUR); start += 30) {
    const count = Math.round(expectedBetween(forecast, start, start + 30) * RUSH_SIZE);
    for (let i = 0; i < count; i++) {
      const placedAt = start + 1 + Math.floor(((i + 0.5) * 29) / count);
      const order = makeOrder(random, `r${rushOrders.length + 1}`, placedAt);
      // The early rush is the game crowd, who mostly want Pad Thai. This is what uses
      // up the noodles in the rush story without running them out on a normal night.
      if (placedAt <= at(18, 30)) addPadThai(order);
      rushOrders.push(order);
    }
  }

  const FEE_RATES: Record<Channel, number> = { doordash: 0.2, appB: 0.24, direct: 0.03 };
  const payouts: Payout[] = (Object.keys(FEE_RATES) as Channel[]).map((channel) => {
    const grossSales = round2(
      orders
        .filter((o) => o.channel === channel)
        .reduce(
          (sum, o) => sum + o.items.reduce((s, l) => s + (MENU.find((m) => m.id === l.menuItemId)?.price ?? 0) * l.qty, 0),
          0,
        ),
    );
    const fees = round2(grossSales * FEE_RATES[channel]);
    return { channel, date: DATE, grossSales, fees, expectedNet: round2(grossSales - fees), actualNet: round2(grossSales - fees) };
  });

  // Three DoorDash dinner orders go missing from the report in the payout-gap sad path.
  const payoutGapOrderIds = orders
    .filter((o) => o.channel === "doordash" && o.placedAt >= at(18))
    .slice(0, 3)
    .map((o) => o.id);

  const invoices: Invoice[] = [
    {
      id: "inv-valley-last",
      vendor: "Valley Meats",
      date: "2026-10-31",
      lines: [{ ingredientId: "chicken", rawName: "Chicken thighs, boneless", qty: 40, unitPrice: 3.5, lineTotal: 140 }],
      total: 140,
      confidence: 1,
      flags: [],
    },
  ];

  return {
    date: DATE,
    weekday: WEEKDAY,
    openHour: OPEN_HOUR,
    closeHour: CLOSE_HOUR,
    menu: MENU,
    ingredients: INGREDIENTS,
    staff: STAFF,
    history,
    modifiers: MODIFIERS,
    prepped: PREPPED,
    orders,
    rushOrders,
    payouts,
    payoutGapOrderIds,
    invoices,
  };
}

export const fakeData: RestaurantData = build();
