"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PlanVsActualChart } from "@/components/charts";
import { Button, ButtonLink, Card, NextStep, Notice, Page, PageTitle, Stat } from "@/components/ui";
import { expectedBetween } from "@/lib/forecast";
import { formatTime } from "@/lib/format";
import type { Alert } from "@/lib/types";
import { useSim } from "@/lib/useSim";

const SEVERITY_ORDER: Alert["severity"][] = ["urgent", "warning", "info"];

function AlertRow({ alert, paused, onPause, canPause }: { alert: Alert; paused: boolean; onPause: () => void; canPause: boolean }) {
  const [reason, setReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function explain() {
    setLoading(true);
    try {
      const response = await fetch("/api/alert-reason", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alert }),
      });
      const body = await response.json();
      setReason(body.reason ?? alert.reason ?? null);
    } catch {
      setReason(alert.reason ?? null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Notice
      tone={alert.severity}
      action={
        <>
          {canPause &&
            (paused ? (
              <span className="text-lg font-semibold">✓ Marked as paused (prototype: nothing is sent to the apps)</span>
            ) : (
              <Button primary onClick={onPause}>Pause it</Button>
            ))}
          {reason === null ? (
            <button type="button" onClick={explain} disabled={loading} className="min-h-11 text-lg text-muted underline underline-offset-4 hover:text-ink">
              {loading ? "Checking…" : "Why?"}
            </button>
          ) : (
            <span className="text-lg font-normal">{reason}</span>
          )}
        </>
      }
    >
      {alert.message}
    </Notice>
  );
}

export default function ServicePage() {
  const { state, data, phase, running, start, jumpTo, fire } = useSim();
  const router = useRouter();
  const open = data.openHour * 60;
  const expected = Math.round(expectedBetween(state.baseForecast, open, state.now));
  const counts = [
    { label: "FIRE NOW", count: state.queue.filter((e) => e.label === "FIRE NOW").length, color: "text-urgent" },
    { label: "UP NEXT", count: state.queue.filter((e) => e.label === "UP NEXT").length, color: "text-caution" },
    { label: "HOLD", count: state.queue.filter((e) => e.label === "HOLD").length, color: "text-muted" },
  ];
  const alerts = [...state.alerts].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

  if (phase === "morning") {
    return (
      <Page>
        <PageTitle eyebrow="Service" title="Dinner service hasn't started">
          When you start, orders begin coming in and the kitchen screen starts sequencing them.
        </PageTitle>
        <NextStep title="Ready to open?" back={{ href: "/morning", label: "Check today's plan first" }}>
          <Button primary onClick={start}>Start service</Button>
        </NextStep>
      </Page>
    );
  }

  return (
    <Page>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle
          eyebrow={state.serviceOver ? "Service is over" : running ? "Service is running" : "Service is paused"}
          title={formatTime(state.now)}
        />
        <div className="flex flex-wrap gap-3">
          {!running && !state.serviceOver && <Button primary onClick={start}>Resume</Button>}
          <ButtonLink href="/service/kitchen">Open kitchen screen</ButtonLink>
        </div>
      </div>

      <section className="grid grid-cols-1 gap-3" aria-label="Alerts">
        {alerts.length === 0 && <Notice tone="good">Everything is on track.</Notice>}
        {alerts.map((alert) => {
          const canPause = alert.kind === "pauseItem";
          const menuItemId = alert.id.replace("pause-", "");
          return (
            <AlertRow
              key={alert.id}
              alert={alert}
              canPause={canPause}
              paused={canPause && state.pausedItemIds.includes(menuItemId)}
              onPause={() => fire({ type: "pauseItem", menuItemId })}
            />
          );
        })}
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Stat label="Orders so far" value={String(state.orders.length)} detail={`The plan said about ${expected} by now`} />
        <Link href="/service/kitchen" className="rounded-2xl border border-line bg-card p-5 transition-colors hover:border-basil/50">
          <div className="flex justify-between text-lg text-muted">
            <span>In the kitchen</span>
            <span className="text-base underline underline-offset-4">Open →</span>
          </div>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {counts.map((c) => (
              <div key={c.label}>
                <div className={`font-display text-4xl font-semibold tabular-nums ${c.color}`}>{c.count}</div>
                <div className="text-sm font-semibold tracking-wide text-muted">{c.label}</div>
              </div>
            ))}
          </div>
        </Link>
      </div>

      <Card title="Plan and real orders" note="Real orders appear once each hour is over.">
        <PlanVsActualChart baseForecast={state.baseForecast} forecast={state.forecast} actuals={state.actuals} now={state.now} />
      </Card>

      <NextStep title={state.serviceOver ? "Service is done" : `Last orders at ${formatTime(data.closeHour * 60)}`} back={{ href: "/morning", label: "Back to today's plan" }}>
        {state.serviceOver ? (
          <ButtonLink primary href="/close">See how the day went →</ButtonLink>
        ) : (
          <Button onClick={() => { jumpTo(data.closeHour * 60); router.push("/close"); }}>Close the day now →</Button>
        )}
      </NextStep>
    </Page>
  );
}
