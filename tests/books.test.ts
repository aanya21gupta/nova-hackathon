import { describe, expect, it } from "vitest";
import { closeBooks } from "@/lib/books";
import { comparePrices, matchIngredients, parseInvoice, validateInvoice } from "@/lib/invoice";
import { hasInventedNumbers } from "@/lib/llm";
import { templateRecap } from "@/lib/recap";
import { getBaseForecast } from "@/lib/simulator";
import type { Invoice, Order, RestaurantData, SimState } from "@/lib/types";

const orders: Order[] = [
  { id: "o1", channel: "doordash", placedAt: 700, items: [{ menuItemId: "dish", qty: 2 }], targetReadyAt: 720, driverEtaAt: 720, status: "pickedUp" },
  { id: "o2", channel: "direct", placedAt: 710, items: [{ menuItemId: "dish", qty: 1 }], targetReadyAt: 730, status: "pickedUp" },
];

const data: RestaurantData = {
  date: "2026-11-07",
  weekday: 6,
  openHour: 11,
  closeHour: 21,
  menu: [{ id: "dish", name: "Dish", price: 10, prepMinutes: 5, station: "wok", recipe: [{ ingredientId: "chicken", qty: 0.5, unit: "lb" }] }],
  ingredients: [{ id: "chicken", name: "Chicken thighs", unit: "lb", onHand: 100, parLevel: 0, packSize: 10, supplierId: "s", lastUnitPrice: 2 }],
  staff: [{ id: "s", name: "S", skills: ["wok"], hourlyRate: 20, availability: [{ start: 660, end: 720 }] }],
  history: [],
  modifiers: [],
  prepped: {},
  orders,
  rushOrders: [],
  payouts: [
    { channel: "doordash", date: "2026-11-07", grossSales: 100, fees: 20, expectedNet: 80, actualNet: 80 },
    { channel: "appB", date: "2026-11-07", grossSales: 100, fees: 25, expectedNet: 75, actualNet: 75 },
    { channel: "direct", date: "2026-11-07", grossSales: 100, fees: 0, expectedNet: 100, actualNet: 100 },
  ],
  payoutGapOrderIds: ["o1"],
  invoices: [],
};

function stateWith(overrides: Partial<SimState> = {}): SimState {
  const forecast = getBaseForecast(data);
  return {
    now: 1260,
    orders,
    placed: orders,
    cancelledOrders: [],
    lostSales: 0,
    stockouts: [],
    actions: [],
    pausedItems: [],
    queue: [],
    baseForecast: forecast,
    forecast,
    actuals: [],
    alerts: [],
    cookingCount: 0,
    delayedOrders: {},
    invoices: [],
    payoutGapActive: false,
    effectiveData: data,
    serviceOver: true,
    ...overrides,
  };
}

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "i",
    vendor: "V",
    date: "2026-11-07",
    lines: [{ ingredientId: "chicken", rawName: "Chicken thighs", qty: 10, unitPrice: 2.44, lineTotal: 24.4 }],
    total: 24.4,
    confidence: 0.95,
    flags: [],
    ...overrides,
  };
}

describe("closeBooks", () => {
  it("adds up revenue and fees by channel", () => {
    const s = closeBooks(stateWith(), data);
    expect(s.revenueByChannel).toEqual({ doordash: 20, appB: 0, direct: 10 });
    expect(s.feesByChannel.doordash).toBe(4);
    expect(s.totalRevenue).toBe(30);
  });

  it("works out food cost and labor as a share of sales", () => {
    const s = closeBooks(stateWith(), data);
    expect(s.foodCost).toBe(3); // 3 dishes × 0.5 lb × $2.
    expect(s.foodCostPercent).toBe(10);
    expect(s.laborCost).toBe(20);
    expect(s.laborPercent).toBe(66.7);
  });

  it("has no payout gap by default", () => {
    expect(closeBooks(stateWith(), data).payoutGaps).toEqual([]);
  });

  it("lists the specific orders behind a payout gap", () => {
    const [gap] = closeBooks(stateWith({ payoutGapActive: true }), data).payoutGaps;
    expect(gap.channel).toBe("doordash");
    expect(gap.mismatchedOrderIds).toEqual(["o1"]);
    expect(gap.expectedNet).toBe(16);
    expect(gap.actualNet).toBe(0);
    expect(gap.gap).toBe(16);
  });

  it("uses the new price from an accepted invoice", () => {
    const s = closeBooks(stateWith({ invoices: [invoice()] }), data);
    expect(s.foodCost).toBe(3.66); // 1.5 lb × $2.44.
    expect(s.priceChanges[0].percentChange).toBe(22);
    expect(s.priceChanges[0].marginChangeToday).toBe(-0.66);
  });

  it("doesn't use prices from a flagged invoice", () => {
    const flagged = invoice({ flags: ["Doesn't add up"] });
    const s = closeBooks(stateWith({ invoices: [flagged] }), data);
    expect(s.foodCost).toBe(3);
    expect(s.priceChanges).toEqual([]);
    expect(s.flaggedInvoices[0].vendor).toBe("V");
  });
});

describe("validateInvoice", () => {
  it("passes one that adds up", () => {
    expect(validateInvoice(invoice()).flags).toEqual([]);
  });

  it("flags a line whose total is wrong", () => {
    const line = { rawName: "Curry base", qty: 8, unitPrice: 11, lineTotal: 98 };
    const flags = validateInvoice(invoice({ lines: [line], total: 98 })).flags;
    expect(flags.join()).toContain("should be $88.00");
  });

  it("flags lines that don't sum to the total", () => {
    expect(validateInvoice(invoice({ total: 30 })).flags.join()).toContain("add up to $24.40");
  });

  it("flags a hard-to-read scan and an empty one", () => {
    expect(validateInvoice(invoice({ confidence: 0.4 })).flags.join()).toContain("hard to read");
    expect(validateInvoice(invoice({ lines: [], total: 0, confidence: 0 })).flags.join()).toContain("No items");
  });

  it("flags numbers it couldn't read", () => {
    const line = { rawName: "Curry base", qty: 8, unitPrice: Number.NaN, lineTotal: 88 };
    expect(validateInvoice(invoice({ lines: [line], total: 88 })).flags.join()).toContain("Couldn't read");
  });
});

describe("invoice reading", () => {
  it("parses LLM JSON, including inside a code fence", () => {
    const raw = '```json\n{"vendor":"V","date":"2026-11-07","lines":[{"rawName":"Rice","qty":1,"unitPrice":2,"lineTotal":2}],"total":2,"confidence":0.9}\n```';
    const parsed = parseInvoice(raw, "x");
    expect(parsed.vendor).toBe("V");
    expect(parsed.lines[0].unitPrice).toBe(2);
  });

  it("turns a null price into a flag, not a zero", () => {
    const raw = '{"vendor":"V","lines":[{"rawName":"Rice","qty":1,"unitPrice":null,"lineTotal":2}],"total":2,"confidence":0.9}';
    const parsed = validateInvoice(parseInvoice(raw, "x"));
    expect(parsed.lines[0].unitPrice).toBeNaN();
    expect(parsed.flags.join()).toContain("Couldn't read");
  });

  it("matches printed names to ingredients", () => {
    const matched = matchIngredients(invoice({ lines: [{ rawName: "Chicken thighs, boneless", qty: 1, unitPrice: 1, lineTotal: 1 }] }), data);
    expect(matched.lines[0].ingredientId).toBe("chicken");
    const unmatched = matchIngredients(invoice({ lines: [{ rawName: "Ground pork", qty: 1, unitPrice: 1, lineTotal: 1 }] }), data);
    expect(unmatched.lines[0].ingredientId).toBeUndefined();
  });

  it("works out the margin hit per dish", () => {
    const [change] = comparePrices(invoice(), data, { dish: 10 });
    expect(change.oldPrice).toBe(2);
    expect(change.newPrice).toBe(2.44);
    expect(change.affectedDishes[0].marginChangePerDish).toBe(-0.22);
    expect(change.marginChangeToday).toBe(-2.2);
  });

  it("ignores tiny price changes", () => {
    const line = { ingredientId: "chicken", rawName: "Chicken thighs", qty: 10, unitPrice: 2.01, lineTotal: 20.1 };
    expect(comparePrices(invoice({ lines: [line], total: 20.1 }), data)).toEqual([]);
  });
});

describe("hasInventedNumbers", () => {
  const input = { revenue: 4560.5, percent: 19.34, label: "6:30pm", ids: ["o12"] };

  it("allows numbers from the input, rounded or with commas", () => {
    expect(hasInventedNumbers("You sold $4,560.50, about $4,561, at 19.3% by 6:30pm. See order 12.", input)).toBe(false);
  });

  it("catches a made-up number", () => {
    expect(hasInventedNumbers("You sold $5,000.", input)).toBe(true);
    expect(hasInventedNumbers("Tomorrow will be 40% busier.", input)).toBe(true);
  });
});

describe("templateRecap", () => {
  it("never uses a number that isn't in the summary, in any sad path", () => {
    const summary = closeBooks(stateWith({ payoutGapActive: true, invoices: [invoice()] }), data);
    const recap = templateRecap(summary);
    expect(hasInventedNumbers(`${recap.text} ${recap.recommendations.join(" ")}`, summary)).toBe(false);
    expect(recap.source).toBe("fallback");
    expect(recap.recommendations.length).toBeGreaterThan(0);
    expect(recap.recommendations.length).toBeLessThanOrEqual(3);
  });
});
