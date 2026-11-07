import { describe, expect, it } from "vitest";
import { getData } from "@/data";
import { DEFAULT_CONTROL, getSimStateAt, makeRushTrigger } from "@/lib/simulator";
import { compareDays } from "@/lib/compare";
import { applyToolCall } from "@/lib/tools";
import type { ActionSource, AppliedAction, SimControl, ToolCall } from "@/lib/types";
import {
  buildVoiceContext, matchMenuItem, normalizeTranscript, parseVoiceCommand, validateVoiceCall, type VoiceContext, type VoiceToolCall,
} from "@/lib/voice";
import { activeBusyModes, runVoiceCall, toToolCall, voiceActions } from "@/lib/voiceActions";

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
    const applied = applyToolCall(DEFAULT_CONTROL, { tool: "pauseItem", itemId: "pad-thai", channels: ["doordash", "appB"] }, "voice", AT_630, data);
    if (!applied.ok) throw new Error(applied.error);
    expect(parseVoiceCommand("86 pad thai", ctxAt(AT_630, applied.control)).kind).toBe("error");
  });

  it("can 86 something now even if a pause is scheduled for later", () => {
    const scheduled = applyToolCall(DEFAULT_CONTROL, { tool: "pauseItem", itemId: "pad-thai", channels: ["doordash", "appB"], fromMinute: 19 * 60 + 50 }, "agent", AT_630, data);
    if (!scheduled.ok) throw new Error(scheduled.error);
    const intent = parseVoiceCommand("86 pad thai", ctxAt(AT_630, scheduled.control));
    expect(intent.kind).toBe("action");
    if (intent.kind !== "action") return;
    const now = applyToolCall(scheduled.control, toToolCall(intent.call), "voice", AT_630, data);
    expect(now.ok).toBe(true);
    if (now.ok) expect(getSimStateAt(now.control, data, AT_630).pausedItems[0].fromMinute).toBe(AT_630);
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

describe("voice runs the same tools as the agent", () => {
  const rush: SimControl = { ...DEFAULT_CONTROL, startMinute: AT_630, triggers: [makeRushTrigger(1020)] };

  // A stand-in for the app's runTool, which keeps the result the way the app would.
  function fakeSim(start: SimControl) {
    const box = { control: start };
    const sim = {
      runTool: (call: ToolCall, by: ActionSource, details?: Pick<AppliedAction, "transcript" | "viaAI">) => {
        const result = applyToolCall(box.control, call, by, AT_630, data, details);
        if (result.ok) box.control = result.control;
        return result;
      },
    };
    return { box, sim };
  }

  function actionFor(words: string, control: SimControl) {
    const intent = parseVoiceCommand(words, ctxAt(AT_630, control));
    if (intent.kind !== "action") throw new Error(`"${words}" was understood as ${intent.kind}`);
    return intent.call;
  }

  it('"86 pad thai" changes the run-out and logs it as voice', () => {
    const { box, sim } = fakeSim(rush);
    const result = runVoiceCall(actionFor("86 pad thai", rush), sim, "86 pad thai");
    expect(result.ok && result.action.beforeAfter).toBe("Pad Thai noodles run-out: 8:15pm → no run-out today");
    const [logged] = voiceActions(getSimStateAt(box.control, data, AT_630));
    expect(logged).toMatchObject({ by: "voice", transcript: "86 pad thai" });
    expect(logged.mockCalls[0]).toContain("DoorDash Merchant API (mock)");
  });

  it('"add 10 minutes" really moves new orders', () => {
    const { box, sim } = fakeSim(rush);
    expect(runVoiceCall(actionFor("add 10 minutes", rush), sim, "add 10 minutes").ok).toBe(true);
    const later = AT_630 + 15;
    const before = getSimStateAt(rush, data, later);
    const after = getSimStateAt(box.control, data, later);
    const order = before.orders.find((o) => o.placedAt > AT_630) as (typeof before.orders)[number];
    expect(after.orders.find((o) => o.id === order.id)?.targetReadyAt).toBe(order.targetReadyAt + 10);
    expect(activeBusyModes(after, later)).toHaveLength(1);
  });

  it('"order N ready" takes it off the queue', () => {
    const entry = getSimStateAt(rush, data, AT_630).queue[0];
    const number = entry.orderId.replace("o", "");
    const { box, sim } = fakeSim(rush);
    expect(runVoiceCall(actionFor(`order ${number} ready`, rush), sim, "ready").ok).toBe(true);
    const state = getSimStateAt(box.control, data, AT_630);
    expect(state.queue.some((e) => e.orderId === entry.orderId)).toBe(false);
    expect(state.orders.find((o) => o.id === entry.orderId)?.status).toBe("ready");
  });

  it("the tools still reject a bad call, even if voice let it through", () => {
    const { sim } = fakeSim(rush);
    const bad = { tool: "pauseItem", args: { itemId: "lobster", channels: ["doordash"] } } as VoiceToolCall;
    expect(runVoiceCall(bad, sim, "86 lobster").ok).toBe(false);
  });

  it("a voice action counts as approved in What Spine changed", () => {
    const { box, sim } = fakeSim(rush);
    runVoiceCall(actionFor("86 pad thai", rush), sim, "86 pad thai");
    const comparison = compareDays(box.control, data);
    expect(comparison.usedSuggestedPlan).toBe(false);
    expect(comparison.decisions).toHaveLength(1);
  });
});
