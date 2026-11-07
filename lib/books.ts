// See CLAUDE.md 4.6.
import { formatTime, round2 } from "./format";
import { firstReforecast, totalOrders } from "./forecast";
import { comparePrices } from "./invoice";
import { computeLearnings } from "./learnings";
import { actualStockouts, usageFromOrders } from "./ordering";
import type { Channel, DaySummary, MenuItem, Order, Payout, PayoutGap, RestaurantData, SimState } from "./types";

const CHANNELS: Channel[] = ["doordash", "appB", "direct"];

function orderRevenue(order: Order, menu: MenuItem[]): number {
  return order.items.reduce((sum, line) => {
    const item = menu.find((m) => m.id === line.menuItemId);
    return sum + (item?.price ?? 0) * line.qty;
  }, 0);
}

/** Fee rate per channel, taken from the payout reports. */
function feeRates(data: RestaurantData): Record<Channel, number> {
  const rates: Record<Channel, number> = { doordash: 0, appB: 0, direct: 0 };
  for (const p of data.payouts) if (p.grossSales > 0) rates[p.channel] = p.fees / p.grossSales;
  return rates;
}

export function closeBooks(state: SimState, data: RestaurantData): DaySummary {
  const { orders } = state;
  const rates = feeRates(data);

  const revenueByChannel: Record<Channel, number> = { doordash: 0, appB: 0, direct: 0 };
  for (const order of orders) revenueByChannel[order.channel] += orderRevenue(order, data.menu);
  const feesByChannel = Object.fromEntries(
    CHANNELS.map((c) => [c, round2(revenueByChannel[c] * rates[c])]),
  ) as Record<Channel, number>;
  const totalRevenue = CHANNELS.reduce((sum, c) => sum + revenueByChannel[c], 0);

  // Payouts: expected = sales minus fees. A missing order lowers what actually arrives.
  const missingIds = state.payoutGapActive ? data.payoutGapOrderIds : [];
  const missing = orders.filter((o) => missingIds.includes(o.id));
  const payouts: Payout[] = CHANNELS.map((channel) => {
    const expectedNet = round2(revenueByChannel[channel] - feesByChannel[channel]);
    const lost = missing
      .filter((o) => o.channel === channel)
      .reduce((sum, o) => sum + orderRevenue(o, data.menu) * (1 - rates[channel]), 0);
    return {
      channel,
      date: data.date,
      grossSales: round2(revenueByChannel[channel]),
      fees: feesByChannel[channel],
      expectedNet,
      actualNet: round2(expectedNet - lost),
    };
  });
  const payoutGaps: PayoutGap[] = payouts
    .filter((p) => p.actualNet < p.expectedNet)
    .map((p) => ({
      channel: p.channel,
      expectedNet: p.expectedNet,
      actualNet: p.actualNet,
      gap: round2(p.expectedNet - p.actualNet),
      mismatchedOrderIds: missing.filter((o) => o.channel === p.channel).map((o) => o.id),
    }));

  // Only invoices that passed the checks can change prices.
  const accepted = state.invoices.filter((i) => i.flags.length === 0);
  const flaggedInvoices = state.invoices.filter((i) => i.flags.length > 0).map((i) => ({ vendor: i.vendor, flags: i.flags }));
  const prices: Record<string, number> = {};
  for (const i of data.ingredients) prices[i.id] = i.lastUnitPrice;
  for (const invoice of accepted) {
    for (const line of invoice.lines) if (line.ingredientId) prices[line.ingredientId] = line.unitPrice;
  }

  const used = usageFromOrders(orders, data);
  const foodCost = Object.entries(used).reduce((sum, [id, qty]) => sum + qty * (prices[id] ?? 0), 0);

  const shiftCost = data.staff.reduce(
    (sum, member) => sum + member.availability.reduce((hours, s) => hours + (s.end - s.start) / 60, 0) * member.hourlyRate,
    0,
  );

  const sold: Record<string, number> = {};
  for (const order of orders) {
    for (const line of order.items) sold[line.menuItemId] = (sold[line.menuItemId] ?? 0) + line.qty;
  }
  const itemRows = data.menu
    .map((m) => ({
      menuItemId: m.id,
      name: m.name,
      sold: sold[m.id] ?? 0,
      revenue: round2((sold[m.id] ?? 0) * m.price),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const percentOf = (part: number) => (totalRevenue > 0 ? Math.round((part / totalRevenue) * 1000) / 10 : 0);
  const first = firstReforecast(state.baseForecast, orders, state.now);
  const forecastOrders = Math.round(totalOrders(state.baseForecast));

  return {
    date: data.date,
    forecastOrders,
    actualOrders: orders.length,
    orderDifference: orders.length - forecastOrders,
    totalRevenue: round2(totalRevenue),
    revenueByChannel: Object.fromEntries(CHANNELS.map((c) => [c, round2(revenueByChannel[c])])) as Record<Channel, number>,
    feesByChannel,
    payouts,
    foodCost: round2(foodCost),
    foodCostPercent: percentOf(foodCost),
    laborCost: round2(shiftCost),
    laborPercent: percentOf(shiftCost),
    reforecastPercent: first?.scaledBy === undefined ? null : Math.round((first.scaledBy - 1) * 100),
    reforecastAtLabel: first?.reforecastAt === undefined ? null : formatTime(first.reforecastAt),
    driverDelays: Object.keys(state.delayedOrders).length,
    flaggedInvoices,
    bestItems: itemRows.slice(0, 3),
    worstItems: itemRows.slice(-2).reverse(),
    priceChanges: accepted.flatMap((invoice) => comparePrices(invoice, data, sold)),
    payoutGaps,
    stockouts: actualStockouts(orders, state.effectiveData),
    learnings: computeLearnings(data.history),
  };
}
