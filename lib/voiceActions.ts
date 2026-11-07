// The only place a voice command changes anything. It runs the same M1 tools as the agent,
// so voice gets the same validation, changes the day the same way, and shows up in the
// shared Action log marked "Voice".
import type { ApplyResult } from "./tools";
import type { AppliedAction, Minutes, SimState, ToolCall } from "./types";
import type { UseSim } from "./useSim";
import type { VoiceToolCall } from "./voice";

/** Voice calls carry `args`, and the tools take them flat. */
export function toToolCall(call: VoiceToolCall): ToolCall {
  return { tool: call.tool, ...call.args } as ToolCall;
}

/** Runs a call that voice has already validated. The tools validate it again. */
export function runVoiceCall(call: VoiceToolCall, sim: Pick<UseSim, "runTool">, transcript: string, viaAI = false): ApplyResult {
  return sim.runTool(toToolCall(call), "voice", viaAI ? { transcript, viaAI } : { transcript });
}

export function voiceActions(state: Pick<SimState, "actions">): AppliedAction[] {
  return state.actions.filter((a) => a.by === "voice");
}

/** Busy mode windows on right now, whoever turned them on. */
export function activeBusyModes(state: Pick<SimState, "actions">, now: Minutes) {
  return state.actions.flatMap((a) => (a.call.tool === "setBusyMode" && now < a.call.untilTime ? [a.call] : []));
}
