"use client";
import { Button, Card } from "@/components/ui";
import { formatTime } from "@/lib/format";
import type { ActionSource } from "@/lib/types";
import { useSim } from "@/lib/useSim";

const SOURCE: Record<ActionSource, string> = {
  agent: "Agent, you approved",
  owner: "You",
  voice: "Voice",
};

export function ActionLog() {
  const { state, runTool } = useSim();
  if (state.actions.length === 0) return null;

  return (
    <Card title="Action log" note="Everything Spine changed today. Calls to outside systems are simulated.">
      <ol className="divide-y divide-line">
        {[...state.actions].reverse().map((action) => {
          const { call } = action;
          const canResume =
            call.tool === "pauseItem" && state.pausedItems.some((p) => p.itemId === call.itemId && call.channels.some((c) => p.channels.includes(c)));
          return (
            <li key={action.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 flex-1 basis-72">
                <div className="text-lg font-semibold">{action.result}</div>
                {action.beforeAfter && <div className="text-lg text-basil">{action.beforeAfter}</div>}
                <div className="text-base text-muted">
                  {formatTime(action.atMinute)} · {SOURCE[action.by]}
                </div>
                {action.mockCalls.map((line) => (
                  <div key={line} className="mt-1 rounded-lg bg-paper px-2 py-1 font-mono text-sm break-words text-muted">
                    {line}
                  </div>
                ))}
              </div>
              {canResume && call.tool === "pauseItem" && (
                <Button onClick={() => runTool({ tool: "resumeItem", itemId: call.itemId, channels: call.channels }, "owner")}>Put it back</Button>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
