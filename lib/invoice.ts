// See CLAUDE.md 4.6. Validation is code, so bad scans get flagged even with no LLM.
import { formatMoney, round2 } from "./format";
import type { Invoice, InvoiceLine, PriceChange, RestaurantData } from "./types";

const MONEY_TOLERANCE = 0.02;
const LOW_CONFIDENCE = 0.7;
/** Smaller changes than this are ordinary rounding, not worth telling Mai about. */
const MIN_PRICE_CHANGE_PERCENT = 1;

/** An unreadable number stays NaN so validation flags it. Number(null) would quietly give 0. */
function toNumber(value: unknown): number {
  return value === null || value === undefined || value === "" ? Number.NaN : Number(value);
}

/** Turns the LLM's raw text into an invoice. Throws if the shape is wrong. */
export function parseInvoice(raw: string, id: string): Invoice {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed.lines)) throw new Error("Invoice has no lines");
  return {
    id,
    vendor: String(parsed.vendor ?? "Unknown vendor"),
    date: String(parsed.date ?? ""),
    lines: parsed.lines.map(
      (line: Record<string, unknown>): InvoiceLine => ({
        rawName: String(line.rawName ?? line.item ?? ""),
        qty: toNumber(line.qty ?? line.quantity),
        unitPrice: toNumber(line.unitPrice),
        lineTotal: toNumber(line.lineTotal),
      }),
    ),
    total: toNumber(parsed.total),
    confidence: Number(parsed.confidence ?? 0),
    flags: [],
  };
}

/** Matches a printed name to an ingredient if every word of the ingredient's name appears. */
export function matchIngredients(invoice: Invoice, data: RestaurantData): Invoice {
  const lines = invoice.lines.map((line) => {
    const printed = line.rawName.toLowerCase();
    const match = data.ingredients.find((i) =>
      i.name
        .toLowerCase()
        .split(/\s+/)
        .every((word) => printed.includes(word)),
    );
    return match ? { ...line, ingredientId: match.id } : line;
  });
  return { ...invoice, lines };
}

/** Adds a flag for anything that doesn't add up. Never drops or corrects what was read. */
export function validateInvoice(invoice: Invoice): Invoice {
  const flags: string[] = [];

  if (invoice.confidence < LOW_CONFIDENCE) flags.push("This scan is hard to read. Please check it against the paper copy.");
  if (invoice.lines.length === 0) flags.push("No items could be read from this invoice.");

  invoice.lines.forEach((line) => {
    if (![line.qty, line.unitPrice, line.lineTotal].every(Number.isFinite)) {
      flags.push(`Couldn't read the numbers for "${line.rawName}".`);
      return;
    }
    const expected = round2(line.qty * line.unitPrice);
    if (Math.abs(expected - line.lineTotal) > MONEY_TOLERANCE) {
      flags.push(
        `${line.rawName}: ${line.qty} × ${formatMoney(line.unitPrice, 2)} should be ${formatMoney(expected, 2)}, but the invoice says ${formatMoney(line.lineTotal, 2)}.`,
      );
    }
  });

  const sum = round2(invoice.lines.reduce((total, line) => total + (Number.isFinite(line.lineTotal) ? line.lineTotal : 0), 0));
  if (!Number.isFinite(invoice.total)) {
    flags.push("Couldn't read the invoice total.");
  } else if (invoice.lines.length > 0 && Math.abs(sum - invoice.total) > MONEY_TOLERANCE) {
    flags.push(`The items add up to ${formatMoney(sum, 2)}, but the invoice total says ${formatMoney(invoice.total, 2)}.`);
  }

  return { ...invoice, flags };
}

/** The most recent price we knew before this invoice. */
function previousPrice(ingredientId: string, data: RestaurantData): number | undefined {
  const earlier = [...data.invoices].sort((a, b) => b.date.localeCompare(a.date));
  for (const invoice of earlier) {
    const line = invoice.lines.find((l) => l.ingredientId === ingredientId);
    if (line) return line.unitPrice;
  }
  return data.ingredients.find((i) => i.id === ingredientId)?.lastUnitPrice;
}

/**
 * Compares unit prices with the last invoice and works out the margin impact per dish.
 * soldByItem lets the result include the effect on today's sales.
 */
export function comparePrices(invoice: Invoice, data: RestaurantData, soldByItem: Record<string, number> = {}): PriceChange[] {
  const changes: PriceChange[] = [];
  for (const line of invoice.lines) {
    if (!line.ingredientId) continue;
    const oldPrice = previousPrice(line.ingredientId, data);
    if (oldPrice === undefined || oldPrice === 0) continue;
    const percentChange = Math.round(((line.unitPrice - oldPrice) / oldPrice) * 1000) / 10;
    if (Math.abs(percentChange) < MIN_PRICE_CHANGE_PERCENT) continue;

    const delta = line.unitPrice - oldPrice;
    const affectedDishes = data.menu.flatMap((item) => {
      const recipeLine = item.recipe.find((r) => r.ingredientId === line.ingredientId);
      if (!recipeLine) return [];
      return [{
        menuItemId: item.id,
        name: item.name,
        marginChangePerDish: round2(-recipeLine.qty * delta),
        soldToday: soldByItem[item.id] ?? 0,
      }];
    });

    changes.push({
      ingredientId: line.ingredientId,
      ingredientName: data.ingredients.find((i) => i.id === line.ingredientId)?.name ?? line.rawName,
      oldPrice,
      newPrice: line.unitPrice,
      percentChange,
      affectedDishes,
      marginChangeToday: round2(
        data.menu.reduce((total, item) => {
          const recipeLine = item.recipe.find((r) => r.ingredientId === line.ingredientId);
          return recipeLine ? total - recipeLine.qty * delta * (soldByItem[item.id] ?? 0) : total;
        }, 0),
      ),
    });
  }
  return changes;
}
