"use client";
// Two series colors, checked with the dataviz palette validator against a light surface.
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatHour } from "@/lib/format";
import type { ComparisonRow } from "@/lib/compare";
import type { ActualHour, Forecast, Minutes } from "@/lib/types";

const REAL_COLOR = "#1f7fa8";
const PLAN_COLOR = "#d9683a";
const GRID_COLOR = "#ece9df";
const AXIS_TEXT = { fontSize: 15, fill: "#666a5f" };

function NumbersTable({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-3 text-lg">
      <summary className="cursor-pointer text-muted">See the numbers</summary>
      <div className="overflow-x-auto">
        <table className="mt-2 w-full text-left whitespace-nowrap tabular-nums">
          <thead>
            <tr className="border-b border-line">
              {headers.map((h) => (
                <th key={h} className="py-1 pr-4 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]} className="border-b border-line/60">
                {row.map((cell, index) => (
                  <td key={index} className="py-1 pr-4">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

interface BandTooltipProps {
  active?: boolean;
  payload?: { payload: { label: string; orders: number; low: number; high: number } }[];
}

function BandTooltip({ active, payload }: BandTooltipProps) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-xl border border-line bg-card px-3 py-2 text-base shadow-sm">
      <div className="font-semibold">{point.label}</div>
      <div>About {point.orders} orders</div>
      <div className="text-muted">Usually {point.low} to {point.high}</div>
    </div>
  );
}

/** Expected orders per hour. Only the busiest hour gets a number on it. */
export function HourlyForecastChart({ forecast }: { forecast: Forecast }) {
  const data = forecast.hourly.map((h) => ({
    label: formatHour(h.hour),
    orders: Math.round(h.orders),
    low: Math.round(h.low),
    high: Math.round(h.high),
  }));
  const busiest = Math.max(...data.map((d) => d.orders));

  return (
    <div>
      <div className="h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 24, right: 4, left: 4, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={GRID_COLOR} />
            <XAxis dataKey="label" tick={AXIS_TEXT} tickLine={false} axisLine={{ stroke: GRID_COLOR }} interval="preserveStartEnd" />
            <YAxis hide />
            <Tooltip content={<BandTooltip />} cursor={{ fill: "#f7f5ef" }} />
            <Bar dataKey="orders" name="Expected orders" fill={REAL_COLOR} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              <LabelList
                dataKey="orders"
                content={(props) => {
                  const { x, y, width, value } = props as unknown as { x: number; y: number; width: number; value: number };
                  if (value !== busiest) return null;
                  return (
                    <text x={x + width / 2} y={y - 8} textAnchor="middle" fontSize={17} fontWeight={600} fill="#23271f">
                      {value}
                    </text>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <NumbersTable headers={["Hour", "Expected", "Usually"]} rows={data.map((d) => [d.label, d.orders, `${d.low} to ${d.high}`])} />
    </div>
  );
}

function Key({ color, dashed, children }: { color: string; dashed?: boolean; children: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-base">
      <span className="w-6 border-t-[3px]" style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }} aria-hidden />
      {children}
    </span>
  );
}

/** Morning plan against real orders. An hour's real orders appear once the hour is over. */
export function PlanVsActualChart({
  baseForecast,
  forecast,
  actuals,
  now,
}: {
  baseForecast: Forecast;
  forecast: Forecast;
  actuals: ActualHour[];
  now: Minutes;
}) {
  const updated = forecast.scaledBy !== undefined;
  const data = baseForecast.hourly.map((h, index) => {
    const done = (h.hour + 1) * 60 <= now;
    return {
      label: formatHour(h.hour),
      plan: Math.round(h.orders),
      updatedPlan: updated ? Math.round(forecast.hourly[index].orders) : undefined,
      actual: done ? actuals[index]?.orders : undefined,
    };
  });
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1">
        <Key color={REAL_COLOR}>Real orders</Key>
        <Key color={PLAN_COLOR}>Morning plan</Key>
        {updated && <Key color={PLAN_COLOR} dashed>Updated plan</Key>}
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_COLOR} />
            <XAxis dataKey="label" tick={AXIS_TEXT} tickLine={false} axisLine={{ stroke: GRID_COLOR }} interval="preserveStartEnd" padding={{ left: 16, right: 16 }} />
            <YAxis tick={AXIS_TEXT} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
            <Tooltip contentStyle={{ fontSize: 16, borderRadius: 12, border: "1px solid #e5e1d6" }} />
            <Line dataKey="plan" name="Morning plan" stroke={PLAN_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
            {updated && (
              <Line dataKey="updatedPlan" name="Updated plan" stroke={PLAN_COLOR} strokeWidth={2} strokeDasharray="6 5" dot={false} isAnimationActive={false} />
            )}
            <Line dataKey="actual" name="Real orders" stroke={REAL_COLOR} strokeWidth={2} dot={{ r: 4, fill: REAL_COLOR, stroke: "#ffffff", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <NumbersTable
        headers={updated ? ["Hour", "Morning plan", "Updated plan", "Real orders"] : ["Hour", "Morning plan", "Real orders"]}
        rows={data.map((d) => (updated ? [d.label, d.plan, d.updatedPlan ?? "", d.actual ?? "–"] : [d.label, d.plan, d.actual ?? "–"]))}
      />
    </div>
  );
}

function Swatch({ color, children }: { color: string; children: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-base">
      <span className="size-3 rounded-sm" style={{ background: color }} aria-hidden />
      {children}
    </span>
  );
}

/** The minutes from the side-by-side table, as bars. Same axis, same unit. */
export function ComparisonChart({ rows }: { rows: ComparisonRow[] }) {
  const data = rows.map((row) => ({ label: row.label, without: row.without, with: row.with }));
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1">
        <Swatch color={PLAN_COLOR}>Without Spine</Swatch>
        <Swatch color={REAL_COLOR}>With Spine</Swatch>
      </div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 22, right: 4, left: 4, bottom: 0 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke={GRID_COLOR} />
            <XAxis dataKey="label" tick={AXIS_TEXT} tickLine={false} axisLine={{ stroke: GRID_COLOR }} interval={0} />
            <YAxis hide />
            <Tooltip formatter={(value) => [`${Number(value).toLocaleString("en-US")} minutes`]} contentStyle={{ fontSize: 16, borderRadius: 12, border: "1px solid #e5e1d6" }} cursor={{ fill: "#f7f5ef" }} />
            <Bar dataKey="without" name="Without Spine" fill={PLAN_COLOR} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              <LabelList dataKey="without" position="top" style={{ fontSize: 15, fill: "#23271f" }} formatter={(value) => Number(value).toLocaleString("en-US")} />
            </Bar>
            <Bar dataKey="with" name="With Spine" fill={REAL_COLOR} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              <LabelList dataKey="with" position="top" style={{ fontSize: 15, fill: "#23271f" }} formatter={(value) => Number(value).toLocaleString("en-US")} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
