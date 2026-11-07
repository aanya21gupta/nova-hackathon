// Small hand-written data so Tracks B and C can build before the real seed exists.
// When data/generated/restaurant.json lands, Track A switches data/index.ts over to it.
import type { Forecast, Order, RestaurantData, SimState } from "@/lib/types";

const h = (hour: number, minute = 0) => hour * 60 + minute;

const orders: Order[] = [
  { id: "o1", channel: "doordash", placedAt: h(18, 0), items: [{ menuItemId: "pad-thai", qty: 2 }], targetReadyAt: h(18, 25), driverEtaAt: h(18, 25), status: "queued" },
  { id: "o2", channel: "direct", placedAt: h(18, 2), items: [{ menuItemId: "green-curry", qty: 1 }], targetReadyAt: h(18, 20), status: "queued" },
  { id: "o3", channel: "appB", placedAt: h(18, 5), items: [{ menuItemId: "spring-rolls", qty: 2 }, { menuItemId: "pad-thai", qty: 1 }], targetReadyAt: h(18, 30), driverEtaAt: h(18, 30), status: "queued" },
  { id: "o4", channel: "doordash", placedAt: h(18, 8), items: [{ menuItemId: "green-curry", qty: 2 }], targetReadyAt: h(18, 40), driverEtaAt: h(18, 40), status: "queued" },
];

/**
 * The complete demo restaurant profile. Swap this object for another profile
 * and the app, setup flow, forecast and service views all read the same shape.
 */
export const restaurantProfile: RestaurantData = {
  id: "basil-and-rice",
  name: "Basil & Rice",
  timezone: "America/New_York",
  date: "2026-11-07",
  weekday: 6,
  openHour: 11,
  closeHour: 21,
  channels: [
    { id: "direct", name: "Toast POS", kind: "pos" },
    { id: "doordash", name: "DoorDash", kind: "delivery" },
    { id: "appB", name: "Other delivery", kind: "delivery" },
  ],
  suppliers: [
    { id: "asian-foods", name: "Asian Foods" },
    { id: "valley-meats", name: "Valley Meats" },
  ],
  menu: [
    { id: "pad-thai", name: "Pad Thai", price: 15, prepMinutes: 8, station: "wok", recipe: [{ ingredientId: "noodles", qty: 0.25, unit: "lb" }, { ingredientId: "chicken", qty: 0.3, unit: "lb" }] },
    { id: "green-curry", name: "Green Curry", price: 16, prepMinutes: 10, station: "wok", recipe: [{ ingredientId: "chicken", qty: 0.35, unit: "lb" }, { ingredientId: "rice", qty: 0.4, unit: "lb" }] },
    { id: "spring-rolls", name: "Spring Rolls", price: 7, prepMinutes: 5, station: "fryer", recipe: [{ ingredientId: "wrappers", qty: 2, unit: "each" }] },
  ],
  ingredients: [
    { id: "noodles", name: "Pad thai noodles", unit: "lb", onHand: 20, parLevel: 10, packSize: 10, supplierId: "asian-foods", lastUnitPrice: 2.4 },
    { id: "chicken", name: "Chicken thighs", unit: "lb", onHand: 30, parLevel: 15, packSize: 40, supplierId: "valley-meats", lastUnitPrice: 2.5 },
    { id: "rice", name: "Jasmine rice", unit: "lb", onHand: 25, parLevel: 25, packSize: 25, supplierId: "asian-foods", lastUnitPrice: 1.1 },
    { id: "wrappers", name: "Spring roll wrappers", unit: "each", onHand: 100, parLevel: 50, packSize: 50, supplierId: "asian-foods", lastUnitPrice: 0.12 },
  ],
  staff: [
    { id: "dev", name: "Dev", skills: ["wok"], hourlyRate: 22, availability: [] },
    { id: "lina", name: "Lina", skills: ["fryer", "packing"], hourlyRate: 18, availability: [{ start: h(10), end: h(21) }] },
    { id: "sam", name: "Sam", skills: ["wok", "register"], hourlyRate: 19, availability: [{ start: h(15), end: h(21) }] },
  ],
  history: [
    { date: "2026-10-31", weekday: 6, hour: 18, channel: "doordash", items: [{ menuItemId: "pad-thai", qty: 1 }], tags: ["homeGame"] },
    { date: "2026-10-31", weekday: 6, hour: 18, channel: "direct", items: [{ menuItemId: "green-curry", qty: 1 }], tags: ["homeGame"] },
    { date: "2026-10-24", weekday: 6, hour: 18, channel: "appB", items: [{ menuItemId: "spring-rolls", qty: 2 }], tags: [] },
  ],
  modifiers: [{ tag: "homeGame", label: "Home game tonight", multiplier: 1.3, fromHour: 17, toHour: 21 }],
  prepped: { noodles: 2, chicken: 5 },
  orders,
  rushOrders: [
    { id: "r1", channel: "doordash", placedAt: h(18, 31), items: [{ menuItemId: "pad-thai", qty: 3 }], targetReadyAt: h(18, 55), driverEtaAt: h(18, 55), status: "queued" },
  ],
  payouts: [
    { channel: "doordash", date: "2026-11-07", grossSales: 70, fees: 14, expectedNet: 56, actualNet: 56 },
    { channel: "appB", date: "2026-11-07", grossSales: 29, fees: 6.96, expectedNet: 22.04, actualNet: 22.04 },
    { channel: "direct", date: "2026-11-07", grossSales: 16, fees: 0, expectedNet: 16, actualNet: 16 },
  ],
  payoutsWithGap: [
    { channel: "doordash", date: "2026-11-07", grossSales: 70, fees: 14, expectedNet: 56, actualNet: 32 },
    { channel: "appB", date: "2026-11-07", grossSales: 29, fees: 6.96, expectedNet: 22.04, actualNet: 22.04 },
    { channel: "direct", date: "2026-11-07", grossSales: 16, fees: 0, expectedNet: 16, actualNet: 16 },
  ],
  payoutGapOrderIds: ["o1"],
  invoices: [
    {
      id: "inv-last",
      vendor: "Valley Meats",
      date: "2026-10-31",
      lines: [{ ingredientId: "chicken", rawName: "Chicken thighs, boneless", qty: 40, unitPrice: 2.5, lineTotal: 100 }],
      total: 100,
      confidence: 1,
      flags: [],
    },
  ],
};

// Backwards-compatible name for the existing fixture tests and demo helpers.
export const fixtureData = restaurantProfile;

export const fixtureForecast: Forecast = {
  date: "2026-11-07",
  modifiers: ["Saturday", "Home game tonight"],
  hourly: [
    { hour: 18, orders: 30, low: 25, high: 35, byItem: { "pad-thai": 14, "green-curry": 10, "spring-rolls": 6 }, byChannel: { doordash: 15, appB: 6, direct: 9 } },
    { hour: 19, orders: 34, low: 28, high: 40, byItem: { "pad-thai": 16, "green-curry": 11, "spring-rolls": 7 }, byChannel: { doordash: 17, appB: 7, direct: 10 } },
  ],
};

/** A moment mid-service, so Track C can build /close without the simulator. */
export const fixtureSimState: SimState = {
  now: h(21),
  orders,
  queue: [],
  forecast: fixtureForecast,
  actuals: [
    { hour: 18, orders: 28 },
    { hour: 19, orders: 36 },
  ],
  alerts: [],
  serviceOver: true,
};
