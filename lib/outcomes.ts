// Replays a whole day to see what a set of decisions is worth. Our simulator gives the
// same result every run, so the only difference between two replays is the decisions.
import { closeBooks } from "./books";
import { round2 } from "./format";
import { measureKitchen, type KitchenMetrics } from "./kitchenRun";
import { getSimStateAt } from "./simulator";
import { applyToolCall } from "./tools";
import type { Minutes, RestaurantData, SimControl, ToolCall } from "./types";

export interface DayOutcome extends KitchenMetrics {
  /** Sales, minus fees, food and wages. Also minus any payout money still missing. */
  moneyKept: number;
  netSales: number;
  foodCost: number;
  laborCost: number;
  payoutMissing: number;
  lostSales: number;
  ordersLost: number;
  ordersCancelled: number;
  ranOut: string[];
}

export function dayOutcome(control: SimControl, data: RestaurantData, options: { firstComeFirstServed?: boolean } = {}): DayOutcome {
  const state = getSimStateAt(control, data, data.closeHour * 60);
  const summary = closeBooks(state, data);
  const fees = Object.values(summary.feesByChannel).reduce((sum, fee) => sum + fee, 0);
  const netSales = round2(summary.totalRevenue - fees);
  const disputed = state.actions.some((a) => a.call.tool === "disputePayout");
  const payoutMissing = disputed ? 0 : round2(summary.payoutGaps.reduce((sum, gap) => sum + gap.gap, 0));
  return {
    ...measureKitchen(state, data, options),
    moneyKept: round2(netSales - summary.foodCost - summary.laborCost - payoutMissing),
    netSales,
    foodCost: summary.foodCost,
    laborCost: summary.laborCost,
    payoutMissing,
    lostSales: summary.lostSales,
    ordersLost: summary.lostOrders,
    ordersCancelled: summary.cancelledOrders,
    ranOut: summary.stockouts.map((s) => s.ingredientName),
  };
}

export interface Prediction {
  moneyDifference: number;
  lateOrdersDifference: number;
  lostSalesDifference: number;
  /** One short line for the plan card, e.g. "+$140 kept, 6 fewer late orders". */
  summary: string;
}

/**
 * The agent's plan is tested before it's shown: code replays the rest of the day with and
 * without this one action. The AI chooses, and the simulator checks the choice.
 */
export function predictAction(control: SimControl, call: ToolCall, now: Minutes, data: RestaurantData): Prediction | null {
  const applied = applyToolCall(control, call, "agent", now, data);
  if (!applied.ok) return null;
  const without = dayOutcome(control, data);
  const withAction = dayOutcome(applied.control, data);

  const moneyDifference = round2(withAction.moneyKept - without.moneyKept);
  const lateOrdersDifference = withAction.lateOrders - without.lateOrders;
  const lostSalesDifference = round2(withAction.lostSales - without.lostSales);

  const parts: string[] = [];
  if (Math.abs(moneyDifference) >= 1) {
    parts.push(`${moneyDifference > 0 ? "+" : "-"}$${Math.abs(Math.round(moneyDifference)).toLocaleString("en-US")} kept`);
  }
  if (lateOrdersDifference !== 0) {
    parts.push(`${Math.abs(lateOrdersDifference)} ${lateOrdersDifference < 0 ? "fewer" : "more"} late orders`);
  }
  return {
    moneyDifference,
    lateOrdersDifference,
    lostSalesDifference,
    summary: parts.length > 0 ? parts.join(", ") : "No change to money or late orders",
  };
}
