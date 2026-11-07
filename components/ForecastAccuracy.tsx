"use client";
// M3: how good is the forecast, and what did it learn last night? Every number comes
// from lib/backtest.ts, which tests each past day using only the days before it.
import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui";
import { BACKTEST_DAYS, LEARNING_RATE, learnedLines, runBacktest } from "@/lib/backtest";
import type { RestaurantData } from "@/lib/types";

const SERIES = [
  { key: "naive", name: "Same as last week", color: "#8a8f84", dashed: true },
  { key: "current", name: "Today's forecast", color: "#d9683a", dashed: false },
  { key: "learning", name: "Learning forecast", color: "#1f7fa8", dashed: false },
] as const;

const cache = new WeakMap<RestaurantData, ReturnType<typeof runBacktest>>();

export function ForecastAccuracy({ data }: { data: RestaurantData }) {
  const result = useMemo(() => {
    let r = cache.get(data);
    if (!r) {
      r = runBacktest(data);
      cache.set(data, r);
    }
    return r;
  }, [data]);
  const lines = learnedLines(result);
  const better = Math.round((1 - result.mae.current / result.mae.naive) * 100);
  const best = SERIES.reduce((a, b) => (result.mae[b.key] < result.mae[a.key] ? b : a));

  return (
    <Card
      title="How good is this forecast?"
      note={`Tested on the last ${BACKTEST_DAYS / 7} weeks: each day forecast using only what Spine knew the night before.`}
    >
      <p className="text-xl font-semibold">
        Spine&apos;s forecast is {better}% closer than &ldquo;same as last week&rdquo;.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {SERIES.map((s) => (
          <div
            key={s.key}
            className={`rounded-xl border p-4 ${s.key === best.key ? "border-basil bg-basil-soft" : "border-line"}`}
            title={`Average miss per hour over ${result.days.length} days × ${result.days[0]?.actual.length ?? 0} hours = ${result.mae[s.key].toFixed(2)} orders`}
          >
            <div className="flex items-center gap-2 text-base text-muted">
              <span className="inline-block h-0.5 w-5" style={{ background: s.color, borderTop: s.dashed ? `2px dashed ${s.color}` : undefined }} />
              {s.name}
            </div>
            <div className="font-display text-3xl font-semibold tabular-nums">±{result.mae[s.key].toFixed(1)}</div>
            <div className="text-base text-muted">orders an hour ({Math.round(result.maePercent[s.key])}% off)</div>
          </div>
        ))}
      </div>

      <div className="mt-4 h-52 w-full" aria-label="Forecast error by week">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={result.weekly} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid stroke="#ece9df" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 15, fill: "#666a5f" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 15, fill: "#666a5f" }} tickLine={false} axisLine={false} domain={[0, "auto"]} tickFormatter={(v: number) => v.toFixed(1)} />
            <Tooltip formatter={(v) => [`±${Number(v).toFixed(2)} orders/hour`]} />
            {SERIES.map((s) => (
              <Line key={s.key} dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={3} strokeDasharray={s.dashed ? "6 5" : undefined} dot={{ r: 4 }} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-base text-muted">Average miss per hour, by week (lower is better).</p>

      <div className="mt-4 rounded-xl bg-note-soft p-4">
        <div className="text-base font-semibold text-note">Last night Spine learned:</div>
        <ul className="mt-1 space-y-1 text-lg">
          {lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </div>

      <details className="mt-3 text-base text-muted">
        <summary className="cursor-pointer">How this works</summary>
        <p className="mt-1">
          Each night Spine compares its forecast to what really happened and nudges its multipliers
          (day of week, home games, rain) {Math.round(LEARNING_RATE * 100)}% of the way toward what it saw.
          &ldquo;Same as last week&rdquo; just repeats last week&apos;s orders for each hour. Synthetic data:
          its patterns don&apos;t drift, so the learning forecast mostly confirms today&apos;s settings.
        </p>
      </details>
    </Card>
  );
}
