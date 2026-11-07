// M4: voice commands in the kitchen. Pure, no React, so it's easy to test.
//
// The keyword rules here work offline. They turn what a cook says into a tool call
// shaped like the M1 tools (pauseItem, setBusyMode, markOrderReady), or a spoken
// answer ("what's next"). Anything the rules don't understand can go to the LLM via
// /api/voice, and that answer is checked with validateVoiceCall before it's used.
import { CHANNEL_NAMES, formatTime, orderLabel } from "./format";
import type { Channel, MenuItem, Minutes, OrderStatus, QueueEntry, RestaurantData, SimState } from "./types";

export type VoiceToolCall =
  | { tool: "pauseItem"; args: { itemId: string; channels: Channel[] } }
  | { tool: "setBusyMode"; args: { channel: Channel | "all"; extraMinutes: number; untilTime: Minutes } }
  | { tool: "markOrderReady"; args: { orderId: string } };

export type VoiceIntent =
  | { kind: "action"; call: VoiceToolCall; say: string }
  | { kind: "answer"; say: string }
  | { kind: "undo" }
  | { kind: "error"; say: string }
  /** No rule matched. `say` is a hint if a rule half-matched (e.g. an unknown item). */
  | { kind: "unknown"; say?: string };

/** Just enough state to check a call. The API route builds this on the server too. */
export interface VoiceValidationContext {
  menu: Pick<MenuItem, "id" | "name">[];
  now: Minutes;
  closeMinute: Minutes;
  orders: { id: string; status: OrderStatus; channel?: Channel }[];
  pausedItemIds?: string[];
}

export interface VoiceContext extends VoiceValidationContext {
  menu: MenuItem[];
  queue: QueueEntry[];
}

export const DELIVERY_CHANNELS: Channel[] = ["doordash", "appB"];
const ALL_CHANNELS: Channel[] = ["doordash", "appB", "direct"];
export const BUSY_MINUTES_MIN = 1;
export const BUSY_MINUTES_MAX = 30;
/** "add 10 minutes" lasts this long unless closing comes first. */
export const BUSY_WINDOW_MINUTES = 60;

/** Builds the voice context from the sim. readyIds = orders the kitchen marked ready by voice. */
export function buildVoiceContext(state: SimState, data: RestaurantData, readyIds: Set<string> = new Set()): VoiceContext {
  return {
    menu: data.menu,
    now: state.now,
    closeMinute: data.closeHour * 60,
    orders: state.orders.map((o) => ({
      id: o.id,
      channel: o.channel,
      status: readyIds.has(o.id) && (o.status === "queued" || o.status === "cooking") ? "ready" : o.status,
    })),
    queue: state.queue.filter((e) => !readyIds.has(e.orderId)),
    pausedItemIds: state.pausedItemIds,
  };
}

// ---------- Normalizing what the browser heard ----------

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

function wordsToDigits(text: string): string {
  const words = text.split(" ");
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (TENS[w] !== undefined) {
      const next = ONES[words[i + 1]];
      if (next !== undefined && next > 0 && next < 10) {
        out.push(String(TENS[w] + next));
        i++;
      } else out.push(String(TENS[w]));
    } else if (ONES[w] !== undefined) out.push(String(ONES[w]));
    else out.push(w);
  }
  return out.join(" ");
}

/** "Eighty-six'd the Pad Thai!" → "86 the pad thai" */
export function normalizeTranscript(text: string): string {
  let t = text.toLowerCase().replace(/['’]/g, "").replace(/[-_]/g, " ").replace(/[^a-z0-9\s]/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/\beighty six(?:ed|d)\b/g, "86");
  t = wordsToDigits(t);
  t = t.replace(/\b86(?:ed|d|s)\b/g, "86");
  return t.replace(/\s+/g, " ").trim();
}

// ---------- Fuzzy menu matching ----------

const FILLER = new Set([
  "the", "a", "an", "on", "off", "of", "for", "from", "please", "now", "tonight", "today", "all", "item", "items",
  "delivery", "deliveries", "apps", "app", "b", "doordash", "door", "dash", "menu", "channels", "channel", "everywhere",
  "right", "away", "were", "we", "are", "out",
]);
/** Words too common on this menu to identify a dish on their own. */
const GENERIC = new Set(["thai"]);

function bigrams(s: string): string[] {
  const compact = s.replace(/\s+/g, "");
  const grams: string[] = [];
  for (let i = 0; i < compact.length - 1; i++) grams.push(compact.slice(i, i + 2));
  return grams;
}

/** Dice similarity on letter pairs: 1 = identical, 0 = nothing in common. */
export function similarity(a: string, b: string): number {
  const ga = bigrams(a);
  const gb = bigrams(b);
  if (ga.length === 0 || gb.length === 0) return a === b ? 1 : 0;
  const pool = [...gb];
  let common = 0;
  for (const g of ga) {
    const at = pool.indexOf(g);
    if (at >= 0) {
      common++;
      pool.splice(at, 1);
    }
  }
  return (2 * common) / (ga.length + gb.length);
}

function variants(item: Pick<MenuItem, "id" | "name">): string[] {
  const name = item.name.toLowerCase();
  const set = new Set([name, item.id.replace(/-/g, " "), name.replace(/\bthai\b/g, "").trim(), name.replace(/\bsoup\b/g, "").trim()]);
  return [...set].filter(Boolean);
}

const MATCH_THRESHOLD = 0.5;

/** "pad tie" → Pad Thai, "thai tea" → Thai Iced Tea. Null if nothing is close enough. */
export function matchMenuItem<T extends Pick<MenuItem, "id" | "name">>(phrase: string, menu: T[]): { item: T; score: number } | null {
  const words = phrase.split(" ").filter((w) => w && !FILLER.has(w));
  const cleaned = words.join(" ");
  if (!cleaned) return null;
  let best: { item: T; score: number } | null = null;
  let runnerUp = 0;
  for (const item of menu) {
    let score = 0;
    for (const v of variants(item)) {
      score = Math.max(score, similarity(cleaned, v));
      const vWords = v.split(" ");
      const shared = words.filter((w) => vWords.includes(w) && !GENERIC.has(w));
      // Every word said is in the name, or the whole name was said ("pad thai noodles").
      if (shared.length > 0 && (words.every((w) => vWords.includes(w)) || vWords.every((w) => words.includes(w)))) {
        score = Math.max(score, 0.85);
      }
    }
    if (!best || score > best.score) {
      runnerUp = best?.score ?? 0;
      best = { item, score };
    } else runnerUp = Math.max(runnerUp, score);
  }
  // Too close to call ("thai" could be Pad Thai or Thai Iced Tea): ask again rather than guess.
  if (best && best.score - runnerUp < 0.02) return null;
  return best && best.score >= MATCH_THRESHOLD ? best : null;
}

// ---------- Words for the screen and for speaking ----------

function itemName(menu: Pick<MenuItem, "id" | "name">[], id: string): string {
  return menu.find((m) => m.id === id)?.name ?? id;
}

function channelText(channels: Channel[]): string {
  if (channels.length === DELIVERY_CHANNELS.length && DELIVERY_CHANNELS.every((c) => channels.includes(c))) return "DoorDash and App B";
  const names = channels.map((c) => CHANNEL_NAMES[c]);
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "#12" → "order 12", "#R3" → "order R3". Reads well out loud. */
export function spokenOrder(orderId: string): string {
  return `order ${orderLabel(orderId).replace("#", "")}`;
}

/** For the log and the Undo toast. */
export function describeVoiceCall(call: VoiceToolCall, menu: Pick<MenuItem, "id" | "name">[]): string {
  switch (call.tool) {
    case "pauseItem":
      return `Paused ${itemName(menu, call.args.itemId)} on ${channelText(call.args.channels)}`;
    case "setBusyMode":
      return `Busy mode: +${call.args.extraMinutes} min on ${call.args.channel === "all" ? "all new orders" : `${CHANNEL_NAMES[call.args.channel]} orders`} until ${formatTime(call.args.untilTime)}`;
    case "markOrderReady":
      return `Marked order ${orderLabel(call.args.orderId)} ready`;
  }
}

/** One short sentence to say out loud. */
export function confirmationFor(call: VoiceToolCall, menu: Pick<MenuItem, "id" | "name">[]): string {
  switch (call.tool) {
    case "pauseItem": {
      const onDelivery = call.args.channels.every((c) => DELIVERY_CHANNELS.includes(c)) && call.args.channels.length === 2;
      return `${itemName(menu, call.args.itemId)} is off ${onDelivery ? "delivery" : channelText(call.args.channels)}.`;
    }
    case "setBusyMode":
      return `Added ${call.args.extraMinutes} minutes to new orders until ${formatTime(call.args.untilTime)}.`;
    case "markOrderReady":
      return `${spokenOrder(call.args.orderId).replace(/^o/, "O")} is ready.`;
  }
}

export interface MockCall {
  system: string;
  message: string;
}

const API_FOR: Record<Channel, string> = {
  doordash: "DoorDash Merchant API (mock)",
  appB: "App B API (mock)",
  direct: "In-store POS (mock)",
};

/** The outside-world calls this WOULD make. Nothing is sent in the prototype. */
export function mockCallsFor(call: VoiceToolCall, ctx: Pick<VoiceValidationContext, "menu" | "orders">): MockCall[] {
  switch (call.tool) {
    case "pauseItem":
      return call.args.channels.map((c) => ({ system: API_FOR[c], message: `pause item "${itemName(ctx.menu, call.args.itemId)}"` }));
    case "setBusyMode":
      return (call.args.channel === "all" ? ALL_CHANNELS : [call.args.channel]).map((c) => ({
        system: API_FOR[c],
        message: `add ${call.args.extraMinutes} min prep time until ${formatTime(call.args.untilTime)}`,
      }));
    case "markOrderReady": {
      const order = ctx.orders.find((o) => o.id === call.args.orderId);
      if (order?.channel && order.channel !== "direct") {
        return [{ system: API_FOR[order.channel], message: `order ${orderLabel(order.id)} ready for pickup` }];
      }
      return [{ system: "SMS (mock)", message: `text customer: order ${orderLabel(call.args.orderId)} is ready` }];
    }
  }
}

/** Pausing and busy mode reach customers, so they get a 5-second Undo first. */
export function isCustomerFacing(call: VoiceToolCall): boolean {
  return call.tool === "pauseItem" || call.tool === "setBusyMode";
}

// ---------- Validation (for anything not built by the rules, e.g. the LLM) ----------

export type VoiceValidation = { ok: true; call: VoiceToolCall } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function validateVoiceCall(raw: unknown, ctx: VoiceValidationContext): VoiceValidation {
  if (!isObject(raw) || !isObject(raw.args)) return { ok: false, error: "Not a tool call." };
  const { tool, args } = raw;
  switch (tool) {
    case "pauseItem": {
      const item = ctx.menu.find((m) => m.id === args.itemId);
      if (!item) return { ok: false, error: `There's no menu item "${String(args.itemId)}".` };
      const channels = Array.isArray(args.channels) && args.channels.length > 0 ? args.channels : null;
      if (!channels || !channels.every((c) => ALL_CHANNELS.includes(c as Channel))) {
        return { ok: false, error: "Channels must be doordash, appB and/or direct." };
      }
      if (ctx.pausedItemIds?.includes(item.id)) return { ok: false, error: `${item.name} is already paused.` };
      return { ok: true, call: { tool, args: { itemId: item.id, channels: ALL_CHANNELS.filter((c) => channels.includes(c)) } } };
    }
    case "setBusyMode": {
      const channel = args.channel ?? "all";
      if (channel !== "all" && !ALL_CHANNELS.includes(channel as Channel)) return { ok: false, error: "Unknown channel." };
      const extra = args.extraMinutes;
      if (typeof extra !== "number" || !Number.isInteger(extra) || extra < BUSY_MINUTES_MIN || extra > BUSY_MINUTES_MAX) {
        return { ok: false, error: `I can add ${BUSY_MINUTES_MIN} to ${BUSY_MINUTES_MAX} minutes.` };
      }
      const until = args.untilTime ?? Math.min(ctx.now + BUSY_WINDOW_MINUTES, ctx.closeMinute);
      if (typeof until !== "number" || !Number.isFinite(until) || until <= ctx.now || until > ctx.closeMinute) {
        return { ok: false, error: "Busy mode has to end after now and by closing time." };
      }
      return { ok: true, call: { tool, args: { channel: channel as Channel | "all", extraMinutes: extra, untilTime: Math.round(until) } } };
    }
    case "markOrderReady": {
      const order = ctx.orders.find((o) => o.id === args.orderId);
      if (!order) return { ok: false, error: `I can't find order ${String(args.orderId)}.` };
      if (order.status === "ready" || order.status === "pickedUp") {
        return { ok: false, error: `${spokenOrder(order.id).replace(/^o/, "O")} is already done.` };
      }
      return { ok: true, call: { tool, args: { orderId: order.id } } };
    }
    default:
      return { ok: false, error: `Unknown tool "${String(tool)}".` };
  }
}

// ---------- The keyword rules ----------

function channelsSaid(text: string): Channel[] | null {
  const said: Channel[] = [];
  if (/\bdoor ?dash\b/.test(text)) said.push("doordash");
  if (/\bapp ?b\b/.test(text)) said.push("appB");
  if (/\b(phone|walk ?in|direct|in store)\b/.test(text)) said.push("direct");
  return said.length > 0 ? said : null;
}

function itemsText(entry: QueueEntry, menu: MenuItem[]): string {
  const parts = entry.order.items.map((l) => `${l.qty > 1 ? `${l.qty} ` : ""}${itemName(menu, l.menuItemId)}`);
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function whatsNext(ctx: VoiceContext): string {
  const fire = ctx.queue.filter((e) => e.label === "FIRE NOW").slice(0, 2);
  if (fire.length === 0) {
    const next = ctx.queue.find((e) => e.label === "UP NEXT") ?? ctx.queue[0];
    return next
      ? `Nothing to fire right now. Next is ${spokenOrder(next.orderId)} at ${formatTime(next.startAt)}.`
      : "Nothing to fire right now.";
  }
  const [first, second] = fire;
  const head = `Fire ${spokenOrder(first.orderId)}: ${itemsText(first, ctx.menu)}.`;
  return second ? `${head} Then ${spokenOrder(second.orderId)}: ${itemsText(second, ctx.menu)}.` : `${head} Nothing else is due yet.`;
}

function orderIdFrom(spoken: string): string {
  const compact = spoken.replace(/\s+/g, "");
  return compact.startsWith("r") ? compact : `o${compact}`;
}

export function parseVoiceCommand(transcript: string, ctx: VoiceContext): VoiceIntent {
  const text = normalizeTranscript(transcript);
  if (!text) return { kind: "unknown" };

  if (/^(undo|cancel|never ?mind|scratch that)\b/.test(text) || /\bundo (that|it)\b/.test(text)) return { kind: "undo" };

  if (/\b(whats|what is|whos|who is) (next|up)\b|\bnext (ticket|tickets|order|orders)\b/.test(text)) {
    return { kind: "answer", say: whatsNext(ctx) };
  }

  const busy = text.match(/\b(?:add|plus|give me|busy mode)\s+(\d+)\s*(?:more\s+|extra\s+)?(?:min|mins|minute|minutes)\b/);
  if (busy) {
    const said = channelsSaid(text);
    const raw = {
      tool: "setBusyMode",
      args: { channel: said && said.length === 1 ? said[0] : "all", extraMinutes: Number(busy[1]), untilTime: Math.min(ctx.now + BUSY_WINDOW_MINUTES, ctx.closeMinute) },
    };
    const checked = validateVoiceCall(raw, ctx);
    return checked.ok ? { kind: "action", call: checked.call, say: confirmationFor(checked.call, ctx.menu) } : { kind: "error", say: checked.error };
  }

  const ready = text.match(/(?:\b(?:order|number|ticket)\s+(?:number\s+)?)?\b(r\s?\d+|\d+)\s+(?:is\s+)?(?:ready|done|up)\b/);
  if (ready && !/\b86\b/.test(text)) {
    const spoken = ready[1].replace(/\s+/g, "").toUpperCase();
    const checked = validateVoiceCall({ tool: "markOrderReady", args: { orderId: orderIdFrom(ready[1]) } }, ctx);
    if (!checked.ok) return { kind: "error", say: checked.error.startsWith("I can't find") ? `I can't find order ${spoken}.` : checked.error };
    return { kind: "action", call: checked.call, say: confirmationFor(checked.call, ctx.menu) };
  }

  const pause =
    text.match(/\b(?:86|pause)\s+(.+)$/) ?? text.match(/\btake\s+(.+?\boff\b.*)$/) ?? text.match(/\b(?:were|we are) out of\s+(.+)$/);
  if (pause) {
    const phrase = pause[1];
    const match = matchMenuItem(phrase, ctx.menu);
    if (!match) return { kind: "unknown", say: `I couldn't find "${phrase.trim()}" on the menu.` };
    const said = channelsSaid(phrase);
    const checked = validateVoiceCall({ tool: "pauseItem", args: { itemId: match.item.id, channels: said ?? DELIVERY_CHANNELS } }, ctx);
    return checked.ok ? { kind: "action", call: checked.call, say: confirmationFor(checked.call, ctx.menu) } : { kind: "error", say: checked.error };
  }

  return { kind: "unknown" };
}
