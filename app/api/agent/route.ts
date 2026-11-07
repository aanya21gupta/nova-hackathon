import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { BAD_SUGGESTION, parseAgentPlan, rulePlan, validatePlan, type AgentContext, type AgentPlanResult } from "@/lib/agent";
import { runLLM } from "@/lib/llm";

const INSTRUCTIONS = `You are the action agent for a small restaurant. The owner is busy and isn't technical. Something needs attention, described in "situation".
Propose a plan of 2 to 4 actions using only these tools, or fewer if the situation only calls for fewer:
- pauseItem { itemId, channels: ("doordash"|"appB"|"direct")[], fromMinute? } Stop selling a dish on those channels. Prefer the latestSafePauseMinute from runOuts, because selling for longer loses fewer sales.
- resumeItem { itemId, channels }
- setBusyMode { channel: "doordash"|"appB"|"direct"|"all", extraMinutes, untilTime } Add prep time to new orders. Use suggestedBusyMinutes and closeMinute unless you have a reason not to.
- requestStaff { staffId, startTime, station, reason } Ask someone from staffOffShift to come in. Use startMinute from staffingGaps.
- draftSupplierOrder { supplierId, lines: [{ ingredientId, qty }] } qty must be suggestedOrderQty from runOuts.
- holdOrder { orderId }, fireOrder { orderId }, markOrderReady { orderId } Only orders in the queue.
- disputePayout { channel, orderIds } Only from payoutGaps.
- requestQuote { supplierId, ingredientId } Only from priceChanges.
Rules: use only ids and values found in the JSON. Each action needs one plain-English reason of one sentence, and every number in it must appear in the JSON. Never calculate a new number.
Times in the JSON ending in Minute are minutes since midnight, for tool arguments only. In reasons, use the labels like "8:15pm".
Respond with JSON only: {"plan": [{"tool": string, "args": object, "reason": string}]}`;

export async function POST(request: Request) {
  const { context, injectBadSuggestion } = (await request.json()) as { context: AgentContext; injectBadSuggestion?: boolean };
  const cacheKey = `plan-${createHash("sha256").update(JSON.stringify(context)).digest("hex").slice(0, 16)}`;
  const fallbackPlan = () => rulePlan(context).map((p) => ({ call: p.call, reason: p.reason }));

  const result = await runLLM<ReturnType<typeof parseAgentPlan>>({
    job: "agentPlan",
    cacheKey,
    instructions: INSTRUCTIONS,
    input: context,
    preferCache: true,
    parse: parseAgentPlan,
    // One bad suggestion doesn't sink a plan, but a plan with nothing usable does.
    validate: (suggestions) => validatePlan(suggestions, context).plan.length > 0,
    fallback: fallbackPlan,
  });

  const raw = injectBadSuggestion ? [...result.value, BAD_SUGGESTION] : result.value;
  const checked: AgentPlanResult = validatePlan(raw, context);
  return NextResponse.json({ ...checked, source: result.source });
}
