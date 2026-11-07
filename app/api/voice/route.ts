// Voice fallback: only used when the offline keyword rules (lib/voice.ts) don't match.
// The LLM may only CHOOSE one tool call; validateVoiceCall checks it against real
// state, and the client checks it again before using it. Offline → {call: null}.
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getData } from "@/data";
import { formatTime } from "@/lib/format";
import { runLLM } from "@/lib/llm";
import type { OrderStatus } from "@/lib/types";
import { validateVoiceCall, type VoiceToolCall, type VoiceValidationContext } from "@/lib/voice";

const INSTRUCTIONS = `You turn one short spoken kitchen command into at most ONE tool call for a restaurant app.
Tools:
- pauseItem {"itemId": a menu id, "channels": array of "doordash" | "appB" | "direct"}: stop selling an item. Use ["doordash","appB"] unless a channel is named.
- setBusyMode {"channel": "all" | "doordash" | "appB" | "direct", "extraMinutes": whole number 1 to 30}: add prep time to new orders for the next hour.
- markOrderReady {"orderId": an id from "orders"}: that order is cooked and ready.
Use only ids that appear in the JSON input, and only numbers the speaker said. Never invent anything.
If the command doesn't clearly match one tool, return {"tool": null}.
Respond with JSON only: {"tool": "<name>", "args": {...}} or {"tool": null}.`;

const STATUSES: OrderStatus[] = ["queued", "cooking", "ready", "pickedUp"];

type Choice = { tool: string | null; args?: unknown };

/** Caps keep a bad or hostile request from producing a huge (costly) LLM prompt. */
const MAX_BODY_BYTES = 32_000;
const MAX_TRANSCRIPT = 200;
const MAX_ORDERS = 300;
/** Order ids in this app look like "o12" or "r3" (see lib/format.ts orderLabel). */
const ORDER_ID = /^[or]\d{1,4}$/;

export async function POST(request: Request) {
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ call: null, source: "fallback" }, { status: 413 });
  let body: { transcript?: unknown; now?: unknown; orders?: unknown } = {};
  try {
    body = JSON.parse(raw);
  } catch {
    body = {};
  }
  const transcript = typeof body.transcript === "string" ? body.transcript.slice(0, MAX_TRANSCRIPT) : "";
  const data = getData();
  const closeMinute = data.closeHour * 60;
  const now = typeof body.now === "number" && Number.isFinite(body.now) ? Math.min(Math.max(body.now, 0), 24 * 60) : data.openHour * 60;
  const orders = (Array.isArray(body.orders) ? body.orders : [])
    .slice(0, MAX_ORDERS)
    .filter((o): o is { id: string; status: OrderStatus } =>
      typeof o === "object" && o !== null &&
      typeof (o as { id?: unknown }).id === "string" && ORDER_ID.test((o as { id: string }).id) &&
      STATUSES.includes((o as { status?: OrderStatus }).status as OrderStatus))
    .map((o) => ({ id: o.id, status: o.status }));

  if (!transcript) return NextResponse.json({ call: null, source: "fallback" });

  const ctx: VoiceValidationContext = { menu: data.menu.map(({ id, name }) => ({ id, name })), now, closeMinute, orders };
  const input = {
    transcript,
    now,
    nowLabel: formatTime(now),
    closeAt: closeMinute,
    menu: ctx.menu,
    orders: orders.filter((o) => o.status === "queued" || o.status === "cooking").map((o) => ({ id: o.id, status: o.status })),
  };

  const result = await runLLM<Choice>({
    job: "voice",
    // Keyed on the FULL input (like the other routes), so one saved answer can't be replayed
    // against a different board. Cached answers are re-validated against current state anyway.
    cacheKey: `voice-${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 16)}`,
    instructions: INSTRUCTIONS,
    input,
    parse: (raw) => {
      const value = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "")) as Choice;
      if (typeof value !== "object" || value === null) throw new Error("not an object");
      return value;
    },
    validate: (value) => value.tool === null || validateVoiceCall(value, ctx).ok,
    fallback: () => ({ tool: null }),
  });

  let call: VoiceToolCall | null = null;
  if (result.value.tool !== null) {
    const checked = validateVoiceCall(result.value, ctx);
    call = checked.ok ? checked.call : null;
  }
  return NextResponse.json({ call, source: result.source });
}
