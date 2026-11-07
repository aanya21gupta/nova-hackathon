import { describe, expect, it } from "vitest";
import { getData } from "@/data";

// Keep this passing with the real seed too: a dangling id breaks a demo silently.
describe("restaurant data", () => {
  const data = getData();
  const menuIds = new Set(data.menu.map((m) => m.id));
  const ingredientIds = new Set(data.ingredients.map((i) => i.id));

  it("recipes only use known ingredients", () => {
    for (const item of data.menu) {
      for (const line of item.recipe) expect(ingredientIds).toContain(line.ingredientId);
    }
  });

  it("orders only use known menu items", () => {
    for (const order of [...data.orders, ...data.rushOrders]) {
      for (const line of order.items) expect(menuIds).toContain(line.menuItemId);
    }
  });

  it("the payout gap lists real orders", () => {
    const orderIds = new Set(data.orders.map((o) => o.id));
    for (const id of data.payoutGapOrderIds) expect(orderIds).toContain(id);
  });
});
