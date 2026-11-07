"use client";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui";
import { buildAgentContext, findSituations, rulePlan, type AgentPlanResult, type RejectedSuggestion, type Situation, type SituationKind } from "@/lib/agent";
import { CHANNEL_NAMES, formatTime } from "@/lib/format";
import { predictAction } from "@/lib/outcomes";
import { describeCall } from "@/lib/tools";
import type { Channel, PlannedAction, ToolCall } from "@/lib/types";
import { useSim } from "@/lib/useSim";

type LoadedPlan = AgentPlanResult & { source: "live" | "cache" | "fallback" };

/** Plans survive moving between pages, and the same plan isn't requested twice. */
const loadedPlans = new Map<string, LoadedPlan>();

function EditFields({ call, onChange }: { call: ToolCall; onChange: (next: ToolCall) => void }) {
  const { data } = useSim();
  const field = "min-h-11 rounded-lg border border-line bg-card px-3 text-lg";

  if (call.tool === "pauseItem") {
    const all: Channel[] = ["doordash", "appB", "direct"];
    return (
      <fieldset className="flex flex-wrap gap-4 text-lg">
        <legend className="sr-only">Channels</legend>
        {all.map((channel) => (
          <label key={channel} className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="size-5"
              checked={call.channels.includes(channel)}
              onChange={(e) =>
                onChange({ ...call, channels: e.target.checked ? [...call.channels, channel] : call.channels.filter((c) => c !== channel) })
              }
            />
            {CHANNEL_NAMES[channel]}
          </label>
        ))}
      </fieldset>
    );
  }
  if (call.tool === "setBusyMode") {
    return (
      <label className="flex items-center gap-2 text-lg">
        Extra minutes
        <input type="number" min={1} max={60} className={`${field} w-24`} value={call.extraMinutes} onChange={(e) => onChange({ ...call, extraMinutes: Number(e.target.value) })} />
      </label>
    );
  }
  if (call.tool === "requestStaff") {
    const options: number[] = [];
    for (let minute = call.startTime; minute < data.closeHour * 60; minute += 30) options.push(minute);
    return (
      <label className="flex items-center gap-2 text-lg">
        Start at
        <select className={field} value={call.startTime} onChange={(e) => onChange({ ...call, startTime: Number(e.target.value) })}>
          {options.map((minute) => (
            <option key={minute} value={minute}>{formatTime(minute)}</option>
          ))}
        </select>
      </label>
    );
  }
  if (call.tool === "draftSupplierOrder") {
    return (
      <div className="flex flex-wrap gap-4 text-lg">
        {call.lines.map((line, index) => (
          <label key={line.ingredientId} className="flex items-center gap-2">
            {data.ingredients.find((i) => i.id === line.ingredientId)?.name}
            <input
              type="number"
              min={1}
              className={`${field} w-28`}
              value={line.qty}
              onChange={(e) =>
                onChange({ ...call, lines: call.lines.map((l, i) => (i === index ? { ...l, qty: Number(e.target.value) } : l)) })
              }
            />
          </label>
        ))}
      </div>
    );
  }
  return <p className="text-lg text-muted">There&apos;s nothing to change on this one.</p>;
}

function ActionCard({ planned, done, doneLine }: { planned: PlannedAction; done: boolean; doneLine?: string }) {
  const { control, state, data, runTool, skipAction } = useSim();
  const [call, setCall] = useState<ToolCall>(planned.call);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tested before it's shown: a replay of the day with and without this action.
  const callKey = JSON.stringify(call);
  const prediction = useMemo(
    () => (done ? null : predictAction(control, call, state.now, data)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [callKey, done, control.actions.length, control.triggers.length],
  );

  if (done) {
    return (
      <li className="rounded-xl bg-basil-soft p-4">
        <div className="text-lg font-semibold">✓ {describeCall(call, data)}</div>
        {doneLine && <div className="text-lg text-basil">{doneLine}</div>}
      </li>
    );
  }

  return (
    <li className="rounded-xl border border-line bg-paper p-4">
      <div className="text-xl font-semibold">{describeCall(call, data)}</div>
      <p className="mt-1 text-lg text-muted">{planned.reason}</p>
      {prediction && (
        <p className="mt-1 text-base font-medium text-basil">Tested in a replay of today: {prediction.summary}</p>
      )}
      {editing && (
        <div className="mt-3">
          <EditFields call={call} onChange={setCall} />
        </div>
      )}
      {error && <p className="mt-2 text-lg font-semibold text-urgent">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-3">
        <Button
          primary
          onClick={() => {
            const result = runTool(call, "agent");
            setError(result.ok ? null : result.error);
          }}
        >
          Approve
        </Button>
        <Button onClick={() => setEditing(!editing)}>{editing ? "Done editing" : "Edit"}</Button>
        <Button onClick={() => skipAction(planned.id)}>Skip</Button>
      </div>
    </li>
  );
}

function Rejected({ items }: { items: RejectedSuggestion[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3 rounded-xl border border-urgent/25 bg-urgent-soft p-4">
      <div className="text-lg font-semibold text-urgent">⚠ Spine rejected {items.length} AI {items.length === 1 ? "suggestion" : "suggestions"}</div>
      <ul className="mt-1 space-y-1 text-lg">
        {items.map((item) => (
          <li key={item.suggestion}>
            {item.why}
            <div className="font-mono text-sm break-words text-muted">{item.suggestion}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SituationPlan({ situation, showBadSuggestion }: { situation: Situation; showBadSuggestion: boolean }) {
  const { control, state, data, phase, runTool } = useSim();
  const inject = showBadSuggestion && control.triggers.some((t) => t.type === "badSuggestion");
  // Different keys for morning and service, because the facts behind them differ.
  const key = `${situation.id}|${inject}|${phase === "morning"}`;
  const [loaded, setLoaded] = useState<LoadedPlan | null>(loadedPlans.get(key) ?? null);

  useEffect(() => {
    const saved = loadedPlans.get(key);
    if (saved) {
      setLoaded(saved);
      return;
    }
    let stale = false;
    const context = buildAgentContext(situation, state, data, { morningView: phase === "morning" });
    const finish = (result: LoadedPlan) => {
      loadedPlans.set(key, result);
      if (!stale) setLoaded(result);
    };
    fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context, injectBadSuggestion: inject }),
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then(finish)
      // Even if the server is unreachable, the rule-based plan works in the browser.
      .catch(() => finish({ plan: rulePlan(context), rejected: [], source: "fallback" }));
    return () => {
      stale = true;
    };
    // The plan is made once per situation. Approval checks it against the state at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const applied = new Map(state.actions.map((a) => [a.id.split("@")[0], a]));
  const rows = (loaded?.plan ?? []).filter((p) => !control.skipped.includes(p.id));
  const open = rows.filter((p) => !applied.has(p.id));
  if (loaded && rows.length === 0 && loaded.rejected.length === 0) return null;

  return (
    <section className="rounded-2xl border-2 border-basil bg-card p-5" aria-label="Agent plan">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold tracking-wide text-basil uppercase">Agent plan</p>
          <h2 className="font-display text-2xl font-semibold">{situation.title}</h2>
        </div>
        {open.length > 1 && (
          <Button primary onClick={() => open.forEach((p) => runTool(p.call, "agent"))}>Approve all</Button>
        )}
      </div>
      {!loaded ? (
        <p className="mt-3 text-lg text-muted">Working out a plan…</p>
      ) : (
        <>
          <ol className="mt-3 grid grid-cols-1 gap-3">
            {rows.map((p) => (
              <ActionCard key={p.id} planned={p} done={applied.has(p.id)} doneLine={applied.get(p.id)?.beforeAfter} />
            ))}
          </ol>
          <Rejected items={loaded.rejected} />
          <p className="mt-3 text-sm text-muted">
            {loaded.source === "fallback" ? "Plan built from Spine's rules." : "Plan chosen by AI."} Every number comes from Spine&apos;s own calculations, and nothing happens until you approve it.
          </p>
        </>
      )}
    </section>
  );
}

/** Shows a plan for each situation that needs one. `kinds` limits it for a given page. */
export function AgentPlans({ kinds }: { kinds?: SituationKind[] }) {
  const { state, data } = useSim();
  const situations = findSituations(state, data).filter((s) => !kinds || kinds.includes(s.kind));
  return (
    <>
      {situations.map((situation, index) => (
        <SituationPlan key={situation.id} situation={situation} showBadSuggestion={index === 0} />
      ))}
    </>
  );
}
