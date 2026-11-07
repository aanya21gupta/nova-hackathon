"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ActionLog } from "@/components/ActionLog";
import { AgentPlans } from "@/components/AgentPlan";
import { PlanVsActualChart } from "@/components/charts";
import { SpineChanged } from "@/components/SpineChanged";
import { Button, Card, NextStep, Notice, Page, PageTitle, Stat } from "@/components/ui";
import { closeBooks } from "@/lib/books";
import { compareDays } from "@/lib/compare";
import { CHANNEL_NAMES, formatMoney, formatTime, orderLabel } from "@/lib/format";
import { comparePrices } from "@/lib/invoice";
import { scanFile, scanSample } from "@/lib/invoiceClient";
import { templateRecap } from "@/lib/recap";
import type { DaySummary, Invoice, InvoiceSample, Recap } from "@/lib/types";
import { useSim } from "@/lib/useSim";

const SAMPLES: { sample: InvoiceSample; label: string }[] = [
  { sample: "clean", label: "Normal invoice" },
  { sample: "priceSpike", label: "Price went up" },
  { sample: "badScan", label: "Blurry invoice" },
];

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function useRecap(summary: DaySummary): { recap: Recap; loading: boolean } {
  const key = JSON.stringify(summary);
  const template = useMemo(() => templateRecap(JSON.parse(key) as DaySummary), [key]);
  const [result, setResult] = useState<{ key: string; recap: Recap } | null>(null);

  useEffect(() => {
    let stale = false;
    fetch("/api/recap", { method: "POST", headers: { "Content-Type": "application/json" }, body: key })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((recap: Recap) => {
        if (!stale) setResult({ key, recap });
      })
      .catch(() => {
        // The template recap is already on screen, so the page keeps working.
        if (!stale) setResult({ key, recap: template });
      });
    return () => {
      stale = true;
    };
  }, [key, template]);

  return result?.key === key ? { recap: result.recap, loading: false } : { recap: template, loading: true };
}

function RecapCard({ summary }: { summary: DaySummary }) {
  const { recap, loading } = useRecap(summary);
  return (
    <section className="rounded-2xl bg-basil p-6 text-white sm:p-7">
      <h2 className="font-display text-3xl font-semibold">Explain my day</h2>
      <p className="mt-3 text-xl leading-relaxed">{recap.text}</p>
      <h3 className="mt-5 text-lg font-semibold text-white/80">What to do next</h3>
      <ol className="mt-1 list-decimal space-y-1 pl-6 text-xl">
        {recap.recommendations.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ol>
      <p className="mt-4 text-sm text-white/70">
        {loading ? "Checking for a fuller recap…" : recap.source === "fallback" ? "Written from today's numbers." : "Written by AI from today's numbers."}
      </p>
    </section>
  );
}

export default function ClosePage() {
  const { control, state, data, jumpTo, fire, reset } = useSim();
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const books = useMemo(() => closeBooks(state, data), [state, data]);
  // The replay only makes sense for a whole day.
  const comparison = useMemo(() => (state.serviceOver ? compareDays(control, data) : null), [state.serviceOver, control, data]);
  const summary = useMemo<DaySummary>(
    () =>
      comparison
        ? {
            ...books,
            spine: {
              saved: comparison.saved,
              usedSuggestedPlan: comparison.usedSuggestedPlan,
              lostSalesWithout: comparison.without.lostSales,
              lostSalesWith: comparison.with.lostSales,
              foodWaitWithout: comparison.without.foodWaitMinutes,
              foodWaitWith: comparison.with.foodWaitMinutes,
              lateOrdersWithout: comparison.without.lateOrders,
              lateOrdersWith: comparison.with.lateOrders,
            },
          }
        : books,
    [books, comparison],
  );
  const totalArrived = summary.payouts.reduce((sum, p) => sum + p.actualNet, 0);

  async function scan(run: () => Promise<Invoice>) {
    setScanning(true);
    setScanError(null);
    try {
      fire({ type: "invoice", invoice: await run() });
    } catch {
      setScanError("That scan didn't work. Please try again.");
    } finally {
      setScanning(false);
    }
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setScanError("Please choose a photo of the invoice.");
    if (file.size > MAX_UPLOAD_BYTES) return setScanError("That photo is too large. Please use one under 8 MB.");
    void scan(() => scanFile(file));
  }

  return (
    <Page>
      <PageTitle eyebrow={state.serviceOver ? "How the day went" : "The day so far"} title={`You sold ${formatMoney(summary.totalRevenue)}`}>
        {summary.actualOrders} orders. The plan was {summary.forecastOrders}.
      </PageTitle>

      {!state.serviceOver && (
        <Notice tone="info" action={<Button primary onClick={() => jumpTo(data.closeHour * 60)}>Close the day now</Button>}>
          It&apos;s {formatTime(state.now)}, so these numbers are the day so far.
        </Notice>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Food cost" value={`${summary.foodCostPercent}%`} detail={`${formatMoney(summary.foodCost)} of ingredients`} />
        <Stat label="Labor" value={`${summary.laborPercent}%`} detail={`${formatMoney(summary.laborCost)} in wages`} />
        <Stat label="Money arriving" value={formatMoney(totalArrived)} detail="After delivery fees" />
      </div>

      <AgentPlans kinds={["payoutGap", "priceSpike"]} />

      {comparison && <SpineChanged comparison={comparison} />}

      {/* Only after close: a recap of half a day would mislead, and each change would be a paid AI call. */}
      {state.serviceOver ? (
        <RecapCard summary={summary} />
      ) : (
        <Card title="Explain my day" note="Your recap will be ready once the day is closed." >
          <span className="sr-only">Not ready yet</span>
        </Card>
      )}

      {summary.payoutGaps.map((gap) => (
        <Notice key={gap.channel} tone="urgent">
          {CHANNEL_NAMES[gap.channel]} paid {formatMoney(gap.gap, 2)} less than expected. Orders that don&apos;t match:{" "}
          {gap.mismatchedOrderIds.map(orderLabel).join(", ")}.
        </Notice>
      ))}

      <Card title="Money from each channel">
        <ul className="divide-y divide-line">
          {summary.payouts.map((p) => {
            const short = p.actualNet < p.expectedNet;
            return (
              <li key={p.channel} className="flex flex-wrap items-baseline justify-between gap-x-4 py-3">
                <div>
                  <div className="text-xl font-semibold">{CHANNEL_NAMES[p.channel]}</div>
                  <div className="text-base text-muted tabular-nums">
                    {formatMoney(p.grossSales)} sales − {formatMoney(p.fees)} fees = {formatMoney(p.expectedNet)} expected
                  </div>
                </div>
                <div className={`text-2xl font-semibold tabular-nums ${short ? "text-urgent" : ""}`}>
                  {short && "⚠ "}{formatMoney(p.actualNet)}
                  <span className="ml-1.5 text-base font-normal text-muted">{short ? "arrived, short" : "arrived"}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="Scan an invoice" note="Take a photo, or try one of the samples.">
        <div className="flex flex-wrap gap-3">
          <label className="inline-flex min-h-12 cursor-pointer items-center rounded-xl bg-basil px-5 py-2 text-lg font-semibold text-white hover:bg-basil/90">
            Choose a photo
            <input type="file" accept="image/*" className="sr-only" disabled={scanning} onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {SAMPLES.map((s) => (
            <Button key={s.sample} disabled={scanning} onClick={() => scan(() => scanSample(s.sample))}>{s.label}</Button>
          ))}
        </div>
        {scanning && <p className="mt-3 text-xl">Reading the invoice…</p>}
        {scanError && <p className="mt-3 text-xl font-semibold text-urgent">{scanError}</p>}

        {state.invoices.length > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-3">
            {state.invoices.map((invoice) => {
              const changes = comparePrices(invoice, data);
              if (invoice.flags.length > 0) {
                return (
                  <Notice key={invoice.id} tone="urgent">
                    {invoice.vendor}: please check this one. We didn&apos;t use it.
                    <ul className="mt-2 list-disc pl-6 text-lg font-normal">
                      {invoice.flags.map((flag) => (
                        <li key={flag}>{flag}</li>
                      ))}
                    </ul>
                  </Notice>
                );
              }
              if (changes.length === 0) {
                return (
                  <Notice key={invoice.id} tone="good">
                    {invoice.vendor}: {formatMoney(invoice.total, 2)}. It adds up, and prices match last time.
                  </Notice>
                );
              }
              return (
                <Notice key={invoice.id} tone="warning">
                  {invoice.vendor}: {formatMoney(invoice.total, 2)}. It adds up, but a price changed.
                  <ul className="mt-2 list-disc pl-6 text-lg font-normal">
                    {changes.map((change) => (
                      <li key={change.ingredientId}>
                        {change.ingredientName} went from {formatMoney(change.oldPrice, 2)} to {formatMoney(change.newPrice, 2)} ({change.percentChange > 0 ? "+" : ""}{change.percentChange}%).{" "}
                        {change.affectedDishes
                          .map((d) => `${d.name} ${d.marginChangePerDish < 0 ? "loses" : "gains"} ${formatMoney(Math.abs(d.marginChangePerDish), 2)}`)
                          .join(", ")}{" "}
                        a plate.
                      </li>
                    ))}
                  </ul>
                </Notice>
              );
            })}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card title="Top sellers">
          <ul className="text-xl">
            {summary.bestItems.map((item) => (
              <li key={item.menuItemId} className="flex justify-between gap-3 py-1">
                <span>{item.name}</span>
                <span className="font-semibold tabular-nums">{item.sold} sold</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Slowest sellers">
          <ul className="text-xl">
            {summary.worstItems.map((item) => (
              <li key={item.menuItemId} className="flex justify-between gap-3 py-1">
                <span>{item.name}</span>
                <span className="font-semibold tabular-nums">{item.sold} sold</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Plan and real orders">
        <PlanVsActualChart baseForecast={state.baseForecast} forecast={state.baseForecast} actuals={state.actuals} now={state.now} />
      </Card>

      <ActionLog />

      <NextStep title={state.serviceOver ? "That's the day" : "Still in service"} back={{ href: "/service", label: "Back to Service" }}>
        <Button onClick={() => { reset(); router.push("/"); }}>Start a new day</Button>
      </NextStep>
    </Page>
  );
}
