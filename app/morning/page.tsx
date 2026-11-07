"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionLog } from "@/components/ActionLog";
import { AgentPlans } from "@/components/AgentPlan";
import { HourlyForecastChart } from "@/components/charts";
import { Button, ButtonLink, Card, NextStep, Notice, Page, PageTitle } from "@/components/ui";
import { totalOrders } from "@/lib/forecast";
import { formatHour, formatMoney, formatTime, SKILL_NAMES } from "@/lib/format";
import { buildSupplierOrder, findRunOuts } from "@/lib/ordering";
import { buildPrepList } from "@/lib/prep";
import { buildStaffingPlan } from "@/lib/staffing";
import type { Forecast, RestaurantData, Skill } from "@/lib/types";
import { useSim } from "@/lib/useSim";

const ORDER_DAYS = 2;
const STATIONS: Skill[] = ["wok", "fryer", "packing", "register"];
const TABS = ["Prep", "Order", "Staff"] as const;
type Tab = (typeof TABS)[number];

function titleFromId(id: string): string {
  return id.split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

function shiftText(start: number, end: number): string {
  return `${formatTime(start)} to ${formatTime(end)}`;
}

function PrepTab({ forecast, data }: { forecast: Forecast; data: RestaurantData }) {
  const tasks = buildPrepList(forecast, data);
  const times = [...new Set(tasks.map((t) => t.dueBy))];
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {times.map((time) => (
        <div key={time}>
          <h3 className="text-lg font-semibold text-basil">Ready by {formatTime(time)}</h3>
          <ul className="mt-1 divide-y divide-line">
            {tasks.filter((t) => t.dueBy === time).map((task) => (
              <li key={task.ingredientId} className="flex items-baseline justify-between gap-4 py-2 text-xl">
                <span>{data.ingredients.find((i) => i.id === task.ingredientId)?.name}</span>
                <span className="font-semibold whitespace-nowrap tabular-nums">{task.qty} {task.unit}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function OrderTab({ forecast, data }: { forecast: Forecast; data: RestaurantData }) {
  const lines = buildSupplierOrder(forecast, data, ORDER_DAYS);
  const suppliers = [...new Set(lines.map((l) => l.supplierId))];
  const total = lines.reduce((sum, l) => sum + l.estimatedCost, 0);
  return (
    <div>
      <p className="text-lg text-muted">
        Enough for {ORDER_DAYS} days at today&apos;s pace, plus your safety stock. About {formatMoney(total)} in total.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
        {suppliers.map((supplier) => {
          const own = lines.filter((l) => l.supplierId === supplier);
          return (
            <div key={supplier}>
              <h3 className="flex justify-between gap-4 text-lg font-semibold text-basil">
                <span>{titleFromId(supplier)}</span>
                <span className="tabular-nums">{formatMoney(own.reduce((sum, l) => sum + l.estimatedCost, 0))}</span>
              </h3>
              <ul className="mt-1 divide-y divide-line">
                {own.map((line) => {
                  const ingredient = data.ingredients.find((i) => i.id === line.ingredientId);
                  return (
                    <li key={line.ingredientId} className="flex items-baseline justify-between gap-4 py-2 text-xl">
                      <span>{ingredient?.name}</span>
                      <span className="font-semibold whitespace-nowrap tabular-nums">
                        {line.qty}{ingredient?.unit === "each" ? "" : ` ${ingredient?.unit}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StaffTab({ forecast, data }: { forecast: Forecast; data: RestaurantData }) {
  const plan = buildStaffingPlan(forecast, data);
  const short = plan.hours.filter((h) => h.gaps.length > 0);
  return (
    <div>
      <p className="text-xl font-semibold">
        {short.length === 0
          ? "✓ Every station is covered all day."
          : `⚠ Short at ${short.map((h) => formatHour(h.hour)).join(", ")}.`}
      </p>
      <ul className="mt-3 divide-y divide-line">
        {data.staff.map((member) => (
          <li key={member.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
            <span className="text-xl">
              <span className="font-semibold">{member.name}</span>{" "}
              <span className="text-lg text-muted">{member.skills.map((s) => SKILL_NAMES[s]).join(", ")}</span>
            </span>
            <span className="text-lg tabular-nums">
              {member.availability.length === 0 ? "Off today" : member.availability.map((s) => shiftText(s.start, s.end)).join(", ")}
            </span>
          </li>
        ))}
      </ul>
      <details className="mt-3 text-lg">
        <summary className="cursor-pointer text-muted">See each hour</summary>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full text-left whitespace-nowrap tabular-nums">
            <thead>
              <tr className="border-b border-line">
                <th className="py-1 pr-4 font-semibold">Hour</th>
                {STATIONS.map((s) => (
                  <th key={s} className="py-1 pr-4 font-semibold">{SKILL_NAMES[s]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {plan.hours.map((h) => (
                <tr key={h.hour} className="border-b border-line/60">
                  <td className="py-1 pr-4">{formatHour(h.hour)}</td>
                  {STATIONS.map((s) => {
                    const gap = h.gaps.includes(s);
                    return (
                      <td key={s} className={`py-1 pr-4 ${gap ? "font-semibold text-urgent" : ""}`}>
                        {h.scheduled[s]} of {h.required[s]}{gap ? " ⚠" : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export default function MorningPage() {
  const { state, data, phase, start } = useSim();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("Prep");
  const { forecast, effectiveData } = state;
  const updated = forecast.scaledBy !== undefined;

  const peak = forecast.hourly.reduce((a, b) => (b.orders > a.orders ? b : a));
  const staffing = buildStaffingPlan(forecast, effectiveData);
  // Before a re-forecast this is the morning view. After one, it includes what's been used so far.
  const runOuts = (
    updated ? findRunOuts(forecast, effectiveData, state.now, state.orders) : findRunOuts(forecast, effectiveData, data.openHour * 60)
  ).filter((r) => r.runsOutAt !== null);
  const staffAlerts = state.alerts.filter((a) => a.kind === "understaffed");
  const hasAttention = updated || runOuts.length > 0 || staffing.risks.length > 0;

  return (
    <Page>
      <PageTitle eyebrow="Today's plan" title={`About ${Math.round(totalOrders(forecast))} orders today`}>
        Busiest around {formatHour(peak.hour)}, with about {Math.round(peak.orders)} orders that hour.
      </PageTitle>
      <ul className="-mt-2 flex flex-wrap gap-2" aria-label="Why this forecast">
        {forecast.modifiers.map((modifier) => (
          <li key={modifier} className="rounded-full bg-basil-soft px-3 py-1 text-base font-medium text-basil">{modifier}</li>
        ))}
      </ul>

      {hasAttention && (
        <section className="grid grid-cols-1 gap-3" aria-label="Needs your attention">
          {updated && forecast.reforecastAt !== undefined && (
            <Notice tone="warning">
              Updated at {formatTime(forecast.reforecastAt)}: orders are running{" "}
              {Math.round(Math.abs((forecast.scaledBy as number) - 1) * 100)}% {(forecast.scaledBy as number) > 1 ? "above" : "below"} plan.
              Everything below reflects that.
            </Notice>
          )}
          {runOuts.map((r) => (
            <Notice key={r.ingredientId} tone="urgent">
              {r.ingredientName} runs out around {r.runsOutLabel} at this pace.
            </Notice>
          ))}
          {staffAlerts.map((alert) => (
            <Notice key={alert.id} tone="warning">{alert.message}</Notice>
          ))}
          {staffing.risks.map((risk) => (
            <Notice key={risk.skill} tone="warning">{risk.message}</Notice>
          ))}
        </section>
      )}

      <AgentPlans kinds={["runOut"]} />

      <Card title="Orders by hour">
        <HourlyForecastChart forecast={forecast} />
      </Card>

      <Card>
        <div role="tablist" aria-label="Today's jobs" className="grid grid-cols-3 gap-1 rounded-xl bg-paper p-1">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => setTab(name)}
              className={`min-h-11 rounded-lg text-lg font-semibold transition-colors ${tab === name ? "bg-card shadow-sm" : "text-muted hover:text-ink"}`}
            >
              {name}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="mt-4">
          {tab === "Prep" && <PrepTab forecast={forecast} data={effectiveData} />}
          {tab === "Order" && <OrderTab forecast={forecast} data={effectiveData} />}
          {tab === "Staff" && <StaffTab forecast={forecast} data={effectiveData} />}
        </div>
      </Card>

      <ActionLog />

      <NextStep title={phase === "morning" ? "Ready to open?" : "Service has started"}>
        {phase === "morning" ? (
          <Button primary onClick={() => { start(); router.push("/service"); }}>Start service →</Button>
        ) : (
          <ButtonLink primary href="/service">Go to Service →</ButtonLink>
        )}
      </NextStep>
    </Page>
  );
}
