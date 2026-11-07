import { describe, expect, it } from "vitest";
import { getData } from "@/data";
import { DEFAULT_CONTROL, getSimStateAt, makeRushTrigger } from "@/lib/simulator";
import type { SimControl } from "@/lib/types";
import {
  buildVoiceContext, matchMenuItem, mockCallsFor, normalizeTranscript, parseVoiceCommand, validateVoiceCall, type VoiceContext,
} from "@/lib/voice";

const data = getData();
const AT_630 = 18 * 60 + 30;

function ctxAt(minute: number, control: SimControl = DEFAULT_CONTROL): VoiceContext {
  return buildVoiceContext(getSimStateAt(control, data, minute), data);
}
const ctx = ctxAt(AT_630);

describe("normalizing speech", () => {
  it("turns number words and 86 variants into digits", () => {
    expect(normalizeTranscript("Eighty-six the Pad Thai!")).toBe("86 the pad thai");
    expect(normalizeTranscript("86'd spring rolls")).toBe("86 spring rolls");
    expect(normalizeTranscript("eighty sixed tom yum")).toBe("86 tom yum");
    expect(normalizeTranscript("Add ten minutes")).toBe("add 10 minutes");
    expect(normalizeTranscript("order twenty three ready")).toBe("order 23 ready");
  });
});

describe("fuzzy menu matching", () => {
  it.each([
    ["pad thai", "pad-thai"],
    ["pad tie", "pad-thai"],
    ["pad thai noodles", "pad-thai"],
    ["thai tea", "thai-tea"],
    ["the spring rolls", "spring-rolls"],
    ["rolls", "spring-rolls"],
    ["tom yum", "tom-yum"],
    ["fried rice", "fried-rice"],
    ["green curry", "green-curry"],
  ])("%s → %s", (phrase, id) => {
    expect(matchMenuItem(phrase, data.menu)?.item.id).toBe(id);
  });

  it("returns null for something not on the menu", () => {
    expect(matchMenuItem("cheeseburger", data.menu)).toBeNull();
  });

  it("won't guess between two equally close dishes", () => {
    expect(matchMenuItem("thai", data.menu)).toBeNull();
  });
});

describe("keyword rules", () => {
  it('"86 pad thai" pauses it on both delivery apps', () => {
    const intent = parseVoiceCommand("86 pad thai", ctx);
    expect(intent).toMatchObject({ kind: "action", call: { tool: "pauseItem", args: { itemId: "pad-thai", channels: ["doordash", "appB"] } } });
    expect(intent.kind === "action" && intent.say).toBe("Pad Thai is off delivery.");
  });

  it('"eighty six the spring rolls" works too', () => {
    expect(parseVoiceCommand("eighty six the spring rolls", ctx)).toMatchObject({ kind: "action", call: { args: { itemId: "spring-rolls" } } });
  });

  it('"86 pad tie on doordash" only pauses DoorDash', () => {
    expect(parseVoiceCommand("86 pad tie on doordash", ctx)).toMatchObject({
      kind: "action",
      call: { tool: "pauseItem", args: { itemId: "pad-thai", channels: ["doordash"] } },
    });
  });

  it("won't pause something already paused", () => {
    const paused = ctxAt(AT_630, { ...DEFAULT_CONTROL, triggers: [{ type: "pauseItem", menuItemId: "pad-thai" }] });
    expect(parseVoiceCommand("86 pad thai", paused).kind).toBe("error");
  });

  it('"add ten minutes" turns on busy mode for an hour', () => {
    expect(parseVoiceCommand("add ten minutes", ctx)).toMatchObject({
      kind: "action",
      call: { tool: "setBusyMode", args: { channel: "all", extraMinutes: 10, untilTime: AT_630 + 60 } },
    });
  });

  it("busy mode never runs past closing", () => {
    const late = ctxAt(20 * 60 + 30);
    expect(parseVoiceCommand("add 5 minutes", late)).toMatchObject({ call: { args: { untilTime: data.closeHour * 60 } } });
  });

  it('"add 45 minutes" is rejected', () => {
    expect(parseVoiceCommand("add 45 minutes", ctx)).toMatchObject({ kind: "error" });
  });

  it('"order <n> ready" marks a queued order ready', () => {
    const target = ctx.queue[0];
    expect(target).toBeDefined();
    const n = target.orderId.slice(1);
    expect(parseVoiceCommand(`order ${n} ready`, ctx)).toMatchObject({
      kind: "action",
      call: { tool: "markOrderReady", args: { orderId: target.orderId } },
      say: `Order ${n} is ready.`,
    });
  });

  it('"order r <n> is done" finds rush orders', () => {
    const rush = ctxAt(AT_630, { ...DEFAULT_CONTROL, triggers: [makeRushTrigger(AT_630 - 60)] });
    const open = rush.orders.find((o) => o.id.startsWith("r") && (o.status === "queued" || o.status === "cooking"));
    expect(open).toBeDefined();
    expect(parseVoiceCommand(`order r ${open!.id.slice(1)} is done`, rush)).toMatchObject({
      kind: "action",
      call: { tool: "markOrderReady", args: { orderId: open!.id } },
    });
  });

  it("rejects unknown or finished orders", () => {
    expect(parseVoiceCommand("order 999 ready", ctx)).toEqual({ kind: "error", say: "I can't find order 999." });
    const done = ctx.orders.find((o) => o.status === "pickedUp")!;
    expect(parseVoiceCommand(`order ${done.id.slice(1)} ready`, ctx).kind).toBe("error");
  });

  it('"what\'s next" reads the next two FIRE NOW tickets', () => {
    const fire = ctx.queue.filter((e) => e.label === "FIRE NOW");
    const intent = parseVoiceCommand("What's next?", ctx);
    expect(intent.kind).toBe("answer");
    const say = intent.kind === "answer" ? intent.say : "";
    if (fire.length >= 2) {
      expect(say).toContain(`Fire order ${fire[0].orderId.slice(1)}:`);
      expect(say).toContain(`Then order ${fire[1].orderId.slice(1)}:`);
    } else {
      expect(say.length).toBeGreaterThan(0);
    }
  });

  it("undo and gibberish", () => {
    expect(parseVoiceCommand("never mind", ctx)).toEqual({ kind: "undo" });
    expect(parseVoiceCommand("the walk in fridge is humming again", ctx)).toEqual({ kind: "unknown" });
    expect(parseVoiceCommand("86 the cheeseburgers", ctx)).toMatchObject({ kind: "unknown", say: expect.stringContaining("menu") });
  });
});

describe("validating LLM tool calls", () => {
  it("accepts a good call and fills in the busy-mode end time", () => {
    expect(validateVoiceCall({ tool: "setBusyMode", args: { channel: "all", extraMinutes: 8 } }, ctx)).toEqual({
      ok: true,
      call: { tool: "setBusyMode", args: { channel: "all", extraMinutes: 8, untilTime: AT_630 + 60 } },
    });
  });

  it.each([
    ["an unknown tool", { tool: "deleteMenu", args: {} }],
    ["a made-up item", { tool: "pauseItem", args: { itemId: "lobster", channels: ["doordash"] } }],
    ["a bad channel", { tool: "pauseItem", args: { itemId: "pad-thai", channels: ["ubereats"] } }],
    ["too many minutes", { tool: "setBusyMode", args: { channel: "all", extraMinutes: 90 } }],
    ["fractional minutes", { tool: "setBusyMode", args: { channel: "all", extraMinutes: 2.5 } }],
    ["an end time in the past", { tool: "setBusyMode", args: { channel: "all", extraMinutes: 5, untilTime: AT_630 - 10 } }],
    ["an end time after close", { tool: "setBusyMode", args: { channel: "all", extraMinutes: 5, untilTime: 23 * 60 } }],
    ["a made-up order", { tool: "markOrderReady", args: { orderId: "o9999" } }],
    ["no args", { tool: "pauseItem" }],
    ["not an object", "86 pad thai"],
  ])("rejects %s", (_, raw) => {
    expect(validateVoiceCall(raw, ctx).ok).toBe(false);
  });
});

describe("mock outside calls", () => {
  it("are labeled as mocks", () => {
    const calls = mockCallsFor({ tool: "pauseItem", args: { itemId: "pad-thai", channels: ["doordash", "appB"] } }, ctx);
    expect(calls.map((c) => c.system)).toEqual(["DoorDash Merchant API (mock)", "App B API (mock)"]);
  });
});
