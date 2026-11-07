// The non-AI recap. It runs whenever the LLM is off or fails, and every number comes from DaySummary.
import { CHANNEL_NAMES, formatMoney, orderLabel } from "./format";
import type { DaySummary, Recap } from "./types";

export function templateRecap(s: DaySummary): Recap {
  const sentences: string[] = [];
  const difference = s.orderDifference;
  const versus =
    difference === 0
      ? "exactly what we planned"
      : `${Math.abs(difference)} ${difference > 0 ? "more" : "fewer"} than the ${s.forecastOrders} planned`;
  sentences.push(`You served ${s.actualOrders} orders today, ${versus}, and sold ${formatMoney(s.totalRevenue)}.`);
  if (s.lostOrders > 0) {
    sentences.push(`${s.lostOrders} orders couldn't be made because something ran out${s.cancelledOrders > 0 ? `, and ${s.cancelledOrders} of those were cancelled and refunded` : ""}.`);
  }
  sentences.push(`Food cost was ${s.foodCostPercent}% of sales and labor was ${s.laborPercent}%.`);

  if (s.bestItems[0]) sentences.push(`${s.bestItems[0].name} was your best seller, with ${s.bestItems[0].sold} sold.`);
  if (s.reforecastPercent !== null && s.reforecastAtLabel) {
    const direction = s.reforecastPercent > 0 ? "above" : "below";
    sentences.push(`At ${s.reforecastAtLabel}, orders were running ${Math.abs(s.reforecastPercent)}% ${direction} plan, so Spine updated the rest of the night.`);
  }
  for (const stockout of s.stockouts) {
    sentences.push(`${stockout.ingredientName} ran out around ${stockout.runsOutLabel}.`);
  }
  for (const change of s.priceChanges) {
    sentences.push(
      `${change.ingredientName} went from ${formatMoney(change.oldPrice, 2)} to ${formatMoney(change.newPrice, 2)}, up ${change.percentChange}%, which cost you ${formatMoney(Math.abs(change.marginChangeToday), 2)} in margin today.`,
    );
  }
  for (const gap of s.payoutGaps) {
    const ids = gap.mismatchedOrderIds.map(orderLabel).join(", ");
    sentences.push(`${CHANNEL_NAMES[gap.channel]} paid ${formatMoney(gap.gap, 2)} less than expected. These orders don't match: ${ids}.`);
  }
  for (const flagged of s.flaggedInvoices) {
    sentences.push(`The ${flagged.vendor} invoice didn't add up, so it wasn't used. Please check it.`);
  }

  const recommendations: string[] = [];
  for (const gap of s.payoutGaps) {
    recommendations.push(`Ask ${CHANNEL_NAMES[gap.channel]} about orders ${gap.mismatchedOrderIds.map(orderLabel).join(", ")}.`);
  }
  for (const change of s.priceChanges) {
    const dish = [...change.affectedDishes].sort((a, b) => a.marginChangePerDish - b.marginChangePerDish)[0];
    if (change.percentChange > 0 && dish) {
      recommendations.push(
        `Get another quote on ${change.ingredientName.toLowerCase()}, or raise the price of ${dish.name}, which loses ${formatMoney(Math.abs(dish.marginChangePerDish), 2)} a plate.`,
      );
    }
  }
  for (const stockout of s.stockouts) {
    recommendations.push(`Order more ${stockout.ingredientName.toLowerCase()} before the next busy night.`);
  }
  const homeGames = s.learnings.find((l) => l.id === "home-game-saturdays");
  if (s.reforecastPercent !== null && s.reforecastPercent > 0) {
    recommendations.push("Schedule one more person on packing for the next busy Saturday.");
  } else if (homeGames) {
    recommendations.push(`Keep planning extra for home games. ${homeGames.text}`);
  }
  if (recommendations.length === 0) recommendations.push("Keep tomorrow's plan as it is. Today ran close to forecast.");

  return { text: sentences.join(" "), recommendations: recommendations.slice(0, 3), source: "fallback" };
}
