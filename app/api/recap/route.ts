import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { hasInventedNumbers, runLLM } from "@/lib/llm";
import { templateRecap } from "@/lib/recap";
import type { DaySummary, Recap } from "@/lib/types";

const INSTRUCTIONS = `You write the end-of-day recap for Mai, who owns a small Thai takeout restaurant. She isn't technical and reads this on her feet.
Use only the JSON input. Every number you write must appear in the JSON exactly or rounded. Never calculate a new number, and never predict a number.
The "spine" field, if present, compares today with the same day replayed without Spine. Mention the "saved" amount once. If "usedSuggestedPlan" is true, nothing was approved, so say it's what Spine's plan could have kept, not what it did keep.
The "actionsTaken" field lists what was approved today. Don't recommend doing something that's already on it.
The "learnings" field holds patterns already computed from past weeks. Use them to support your advice when they're relevant.
"lostOrders" already includes "cancelledOrders". Never add them together or call the cancelled ones "another": say e.g. "14 orders were lost, and 9 of those were cancelled and refunded".
Write money with two decimals, like $74.40. Write order ids with a # instead of the leading "o", so o97 becomes #97.
Write 3 to 5 short sentences in plain English, with no jargon. Mention anything that went wrong: stockouts, price changes and which dishes they hurt, payout gaps and the specific orders, flagged invoices.
Then give 1 to 3 concrete things Mai should do.
Respond with JSON only: {"text": string, "recommendations": string[]}`;

export async function POST(request: Request) {
  const summary = (await request.json()) as DaySummary;
  const cacheKey = `recap-${createHash("sha256").update(JSON.stringify(summary)).digest("hex").slice(0, 16)}`;

  const result = await runLLM<Omit<Recap, "source">>({
    job: "recap",
    cacheKey,
    instructions: INSTRUCTIONS,
    input: summary,
    parse: (raw) => {
      const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""));
      return { text: String(parsed.text), recommendations: (parsed.recommendations as unknown[]).map(String) };
    },
    validate: (value) =>
      value.text.length > 0 &&
      value.recommendations.length >= 1 &&
      value.recommendations.length <= 3 &&
      !hasInventedNumbers(`${value.text} ${value.recommendations.join(" ")}`, summary),
    fallback: () => templateRecap(summary),
  });

  return NextResponse.json({ text: result.value.text, recommendations: result.value.recommendations, source: result.source } satisfies Recap);
}
