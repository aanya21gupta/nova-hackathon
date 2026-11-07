import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { hasInventedNumbers, runLLM } from "@/lib/llm";
import type { Alert } from "@/lib/types";

const INSTRUCTIONS = `Explain in one short plain-English sentence why this alert appeared, for a busy restaurant owner who isn't technical.
Use only the JSON input. Every number you write must appear in it. Never calculate a new number.
Respond with JSON only: {"reason": string}`;

export async function POST(request: Request) {
  const { alert } = (await request.json()) as { alert: Alert };
  const input = { message: alert.message, facts: alert.facts, reason: alert.reason };
  const cacheKey = `reason-${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 16)}`;

  const result = await runLLM<string>({
    job: "alertReason",
    cacheKey,
    instructions: INSTRUCTIONS,
    input,
    parse: (raw) => String(JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "")).reason),
    validate: (reason) => reason.length > 0 && !hasInventedNumbers(reason, input),
    fallback: () => alert.reason ?? alert.message,
  });

  return NextResponse.json({ reason: result.value, source: result.source });
}
