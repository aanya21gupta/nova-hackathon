// The agent's tools. Every change to the day goes through here, whoever asks for it, so
// the same validation protects against a bad AI suggestion and a mistyped edit.
import { CHANNEL_NAMES, formatTime, orderLabel, SKILL_NAMES } from "./format";
import { findRunOuts } from "./ordering";
import { buildStaffingPlan } from "./staffing";
import { dayPhase, getSimStateAt, HOLD_MINUTES } from "./simulator";
import type { ActionSource, AppliedAction, Channel, Minutes, RestaurantData, SimControl, SimState, Skill, ToolCall } from "./types";

const CHANNELS: Channel[] = ["doordash", "appB", "direct"];
const STATIONS: Skill[] = ["wok", "fryer", "packing", "register"];
const MAX_BUSY_MINUTES = 60;
const MAX_ORDER_QTY = 5000;

function channelNames(channels: Channel[]): string {
  return channels.map((c) => CHANNEL_NAMES[c]).join(" and ");
}

function supplierName(id: string): string {
  return id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

function isMinute(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 24 * 60;
}

function supplierExists(id: unknown, data: RestaurantData): boolean {
  return data.ingredients.some((i) => i.supplierId === id);
}

/** A stable id, so the same suggestion is recognized as already approved or skipped. */
export function actionId(call: ToolCall): string {
  switch (call.tool) {
    case "pauseItem":
    case "resumeItem":
      return `${call.tool}:${call.itemId}:${[...call.channels].sort().join(",")}`;
    case "setBusyMode":
      return `${call.tool}:${call.channel}`;
    case "requestStaff":
      return `${call.tool}:${call.staffId}`;
    case "draftSupplierOrder":
      return `${call.tool}:${call.supplierId}:${call.lines.map((l) => l.ingredientId).sort().join(",")}`;
    case "holdOrder":
    case "fireOrder":
    case "markOrderReady":
      return `${call.tool}:${call.orderId}`;
    case "disputePayout":
      return `${call.tool}:${call.channel}`;
    case "requestQuote":
      return `${call.tool}:${call.supplierId}:${call.ingredientId}`;
  }
}

/** Returns what's wrong with a call, or null if it's safe to run right now. */
export function validateToolCall(call: ToolCall, state: SimState, data: RestaurantData): string | null {
  const close = data.closeHour * 60;
  const validChannels = (channels: unknown): channels is Channel[] =>
    Array.isArray(channels) && channels.length > 0 && channels.every((c) => CHANNELS.includes(c as Channel)) && new Set(channels).size === channels.length;

  switch (call?.tool) {
    case "pauseItem": {
      if (!data.menu.some((m) => m.id === call.itemId)) return `There's no dish called "${call.itemId}" on the menu.`;
      if (!validChannels(call.channels)) return "Choose at least one valid channel.";
      if (call.fromMinute !== undefined && (!isMinute(call.fromMinute) || call.fromMinute < state.now || call.fromMinute > close)) {
        return "The pause time must be between now and close.";
      }
      const paused = state.pausedItems.find((p) => p.itemId === call.itemId);
      if (paused && call.channels.every((c) => paused.channels.includes(c))) return "That dish is already paused on those channels.";
      return null;
    }
    case "resumeItem": {
      if (!data.menu.some((m) => m.id === call.itemId)) return `There's no dish called "${call.itemId}" on the menu.`;
      if (!validChannels(call.channels)) return "Choose at least one valid channel.";
      const paused = state.pausedItems.find((p) => p.itemId === call.itemId);
      if (!paused || !call.channels.some((c) => paused.channels.includes(c))) return "That dish isn't paused on those channels.";
      return null;
    }
    case "setBusyMode":
      if (call.channel !== "all" && !CHANNELS.includes(call.channel)) return "Choose a valid channel.";
      if (!Number.isInteger(call.extraMinutes) || call.extraMinutes < 1 || call.extraMinutes > MAX_BUSY_MINUTES) {
        return `Extra prep time must be 1 to ${MAX_BUSY_MINUTES} minutes.`;
      }
      if (!isMinute(call.untilTime) || call.untilTime <= state.now || call.untilTime > close) return "Busy mode must end after now and by close.";
      return null;
    case "requestStaff": {
      const member = data.staff.find((s) => s.id === call.staffId);
      if (!member) return `There's no staff member called "${call.staffId}".`;
      if (!STATIONS.includes(call.station)) return "Choose a valid station.";
      if (!member.skills.includes(call.station)) return `${member.name} can't work ${call.station}.`;
      if (!isMinute(call.startTime) || call.startTime < state.now || call.startTime >= close) return "The start time must be between now and close.";
      const onShift = state.effectiveData.staff
        .find((s) => s.id === call.staffId)
        ?.availability.some((s) => s.start <= call.startTime && s.end > call.startTime);
      if (onShift) return `${member.name} is already working then.`;
      return null;
    }
    case "draftSupplierOrder":
      if (!supplierExists(call.supplierId, data)) return `There's no supplier called "${call.supplierId}".`;
      if (!Array.isArray(call.lines) || call.lines.length === 0) return "The order needs at least one item.";
      for (const line of call.lines) {
        const ingredient = data.ingredients.find((i) => i.id === line.ingredientId);
        if (!ingredient) return `There's no ingredient called "${line.ingredientId}".`;
        if (ingredient.supplierId !== call.supplierId) return `${ingredient.name} doesn't come from that supplier.`;
        if (typeof line.qty !== "number" || line.qty <= 0 || line.qty > MAX_ORDER_QTY) return `The amount of ${ingredient.name} isn't sensible.`;
      }
      return null;
    case "holdOrder":
    case "fireOrder": {
      const order = state.orders.find((o) => o.id === call.orderId);
      if (!order) return `There's no order ${call.orderId}.`;
      if (order.status !== "queued") return `Order ${orderLabel(call.orderId)} has already started.`;
      return null;
    }
    case "markOrderReady": {
      const order = state.orders.find((o) => o.id === call.orderId);
      if (!order) return `There's no order ${call.orderId}.`;
      if (order.status === "ready" || order.status === "pickedUp") return `Order ${orderLabel(call.orderId)} is already done.`;
      return null;
    }
    case "disputePayout":
      if (!CHANNELS.includes(call.channel)) return "Choose a valid channel.";
      if (!state.payoutGapActive) return "There's no payout gap to dispute.";
      if (!Array.isArray(call.orderIds) || call.orderIds.length === 0 || !call.orderIds.every((id) => data.payoutGapOrderIds.includes(id))) {
        return "Those orders don't match the payout gap.";
      }
      return null;
    case "requestQuote":
      if (!supplierExists(call.supplierId, data)) return `There's no supplier called "${call.supplierId}".`;
      if (!data.ingredients.some((i) => i.id === call.ingredientId)) return `There's no ingredient called "${call.ingredientId}".`;
      return null;
    default:
      return "Spine doesn't have that tool.";
  }
}

/** The card title for a tool call. */
export function describeCall(call: ToolCall, data: RestaurantData): string {
  const dish = (id: string) => data.menu.find((m) => m.id === id)?.name ?? id;
  const ingredient = (id: string) => data.ingredients.find((i) => i.id === id);
  switch (call.tool) {
    case "pauseItem":
      return `Pause ${dish(call.itemId)} on ${channelNames(call.channels)}${call.fromMinute !== undefined ? ` at ${formatTime(call.fromMinute)}` : " now"}`;
    case "resumeItem":
      return `Put ${dish(call.itemId)} back on ${channelNames(call.channels)}`;
    case "setBusyMode":
      return `Add ${call.extraMinutes} minutes to new ${call.channel === "all" ? "" : `${CHANNEL_NAMES[call.channel]} `}orders until ${formatTime(call.untilTime)}`;
    case "requestStaff":
      return `Ask ${data.staff.find((s) => s.id === call.staffId)?.name ?? call.staffId} to come in for ${SKILL_NAMES[call.station]?.toLowerCase()} at ${formatTime(call.startTime)}`;
    case "draftSupplierOrder":
      return `Order ${call.lines.map((l) => `${l.qty} ${ingredient(l.ingredientId)?.unit === "each" ? "" : ingredient(l.ingredientId)?.unit} ${ingredient(l.ingredientId)?.name}`).join(", ")} from ${supplierName(call.supplierId)}`;
    case "holdOrder":
      return `Hold order ${orderLabel(call.orderId)}`;
    case "fireOrder":
      return `Fire order ${orderLabel(call.orderId)} now`;
    case "markOrderReady":
      return `Mark order ${orderLabel(call.orderId)} ready`;
    case "disputePayout":
      return `Dispute ${CHANNEL_NAMES[call.channel]}'s payout for ${call.orderIds.map(orderLabel).join(", ")}`;
    case "requestQuote":
      return `Ask ${supplierName(call.supplierId)} for a better price on ${ingredient(call.ingredientId)?.name.toLowerCase()}`;
  }
}

/** Calls to outside systems. All simulated, and labeled that way on screen. */
function mockCallsFor(call: ToolCall, data: RestaurantData): string[] {
  const dish = (id: string) => data.menu.find((m) => m.id === id)?.name ?? id;
  const channelApi: Record<Channel, string> = { doordash: "DoorDash Merchant API (mock)", appB: "App B API (mock)", direct: "POS (mock)" };
  switch (call.tool) {
    case "pauseItem":
      return call.channels.map((c) => `${channelApi[c]}: mark ${dish(call.itemId)} unavailable${call.fromMinute !== undefined ? ` from ${formatTime(call.fromMinute)}` : ""}`);
    case "resumeItem":
      return call.channels.map((c) => `${channelApi[c]}: mark ${dish(call.itemId)} available`);
    case "setBusyMode": {
      const channels = call.channel === "all" ? CHANNELS : [call.channel];
      return channels.map((c) => `${channelApi[c]}: add ${call.extraMinutes} min prep time until ${formatTime(call.untilTime)}`);
    }
    case "requestStaff":
      return [`SMS (mock): to ${data.staff.find((s) => s.id === call.staffId)?.name}: can you work ${call.station} from ${formatTime(call.startTime)}? ${call.reason}`];
    case "draftSupplierOrder":
      return [`Supplier email (draft): to ${supplierName(call.supplierId)}: ${describeCall(call, data)}`];
    case "disputePayout":
      return [`${channelApi[call.channel]}: dispute payout for orders ${call.orderIds.map(orderLabel).join(", ")}`];
    case "requestQuote":
      return [`Supplier email (draft): to ${supplierName(call.supplierId)}: asking for a better price`];
    default:
      return [];
  }
}

function runOutLabel(state: SimState, ingredientId: string, data: RestaurantData, morningView: boolean): string {
  if (morningView) {
    const planned = findRunOuts(state.forecast, state.effectiveData, data.openHour * 60).find((r) => r.ingredientId === ingredientId);
    return planned?.runsOutLabel ?? "no run-out today";
  }
  if (state.stockouts.some((s) => s.ingredientId === ingredientId)) return "already out";
  const found = findRunOuts(state.forecast, state.effectiveData, state.now, state.orders).find((r) => r.ingredientId === ingredientId);
  return found?.runsOutLabel ?? "no run-out today";
}

function queueLabel(state: SimState, orderId: string): string {
  return state.queue.find((e) => e.orderId === orderId)?.label ?? "cooking";
}

function coverage(state: SimState, station: Skill, hour: number): string {
  const row = buildStaffingPlan(state.forecast, state.effectiveData).hours.find((h) => h.hour === hour);
  return row ? `${row.scheduled[station]} of ${row.required[station]}` : "covered";
}

/** The line shown after approval, e.g. "Pad Thai noodles run-out: 8:15pm → no run-out today". */
function beforeAfterLine(call: ToolCall, before: SimState, after: SimState, data: RestaurantData, morningView: boolean): string | undefined {
  switch (call.tool) {
    case "pauseItem":
    case "resumeItem": {
      const ingredientId = data.menu.find((m) => m.id === call.itemId)?.recipe[0]?.ingredientId;
      const ingredient = data.ingredients.find((i) => i.id === ingredientId);
      return ingredient ? `${ingredient.name} run-out: ${runOutLabel(before, ingredient.id, data, morningView)} → ${runOutLabel(after, ingredient.id, data, morningView)}` : undefined;
    }
    case "draftSupplierOrder": {
      if (!morningView) return "Drafted for tomorrow, so it doesn't change tonight's stock";
      const line = call.lines[0];
      const ingredient = data.ingredients.find((i) => i.id === line?.ingredientId);
      return ingredient ? `${ingredient.name} run-out: ${runOutLabel(before, ingredient.id, data, true)} → ${runOutLabel(after, ingredient.id, data, true)}` : undefined;
    }
    case "requestStaff": {
      const hour = Math.floor(call.startTime / 60);
      return `${SKILL_NAMES[call.station]} at ${formatTime(hour * 60)}: ${coverage(before, call.station, hour)} → ${coverage(after, call.station, hour)}`;
    }
    case "setBusyMode":
      return `New orders promised ${call.extraMinutes} minutes later until ${formatTime(call.untilTime)}`;
    case "holdOrder":
    case "fireOrder":
      return `Order ${orderLabel(call.orderId)}: ${queueLabel(before, call.orderId)} → ${queueLabel(after, call.orderId)}`;
    default:
      return undefined;
  }
}

function resultFor(call: ToolCall, data: RestaurantData): string {
  const text = describeCall(call, data);
  if (call.tool === "holdOrder") return `${text} for up to ${HOLD_MINUTES} minutes`;
  return text;
}

export type ApplyResult = { ok: true; control: SimControl; action: AppliedAction } | { ok: false; error: string };

/**
 * Validates a tool call against the current state and, if it's safe, adds it to the day.
 * Everything else (run-outs, prep, staffing, the queue) recomputes from there.
 */
export function applyToolCall(control: SimControl, call: ToolCall, by: ActionSource, now: Minutes, data: RestaurantData): ApplyResult {
  const before = getSimStateAt(control, data, now);
  const error = validateToolCall(call, before, data);
  if (error) return { ok: false, error };

  const action: AppliedAction = {
    id: `${actionId(call)}@${now}`,
    call,
    atMinute: now,
    by,
    result: resultFor(call, data),
    mockCalls: mockCallsFor(call, data),
  };
  const morningView = dayPhase(control, before) === "morning";
  // An order drafted before service can be picked up today. During service it's for tomorrow.
  if (call.tool === "draftSupplierOrder") action.stockArrivesAt = morningView ? 0 : null;

  const next: SimControl = { ...control, actions: [...(control.actions ?? []), action] };
  const after = getSimStateAt(next, data, now);
  const line = beforeAfterLine(call, before, after, data, morningView);
  const finished: AppliedAction = line ? { ...action, beforeAfter: line } : action;
  return { ok: true, action: finished, control: { ...control, actions: [...(control.actions ?? []), finished] } };
}
