"use client";
import Link from "next/link";
import { useMemo } from "react";
import { ButtonLink, Page, PageTitle } from "@/components/ui";
import { closeBooks } from "@/lib/books";
import { totalOrders } from "@/lib/forecast";
import { formatMoney, formatTime } from "@/lib/format";
import { useSim } from "@/lib/useSim";

const HERO = {
  morning: { eyebrow: "Saturday", title: "Good morning, Mai", text: "Start with today's plan.", href: "/morning", action: "See today's plan" },
  service: { eyebrow: "Saturday", title: "Service is underway", text: "See how the rush is going.", href: "/service", action: "Go to Service" },
  close: { eyebrow: "Saturday", title: "That's a wrap, Mai", text: "Your books are ready.", href: "/close", action: "See how the day went" },
};

export default function HomePage() {
  const { state, data, phase } = useSim();
  const summary = useMemo(() => closeBooks(state, data), [state, data]);
  const hero = HERO[phase];
  const needsAttention = state.alerts.filter((a) => a.severity !== "info").length;

  const steps = [
    {
      key: "morning",
      href: "/morning",
      name: "Morning",
      question: "What should I get ready?",
      status: `About ${Math.round(totalOrders(state.forecast))} orders expected`,
    },
    {
      key: "service",
      href: "/service",
      name: "Service",
      question: "How is the rush going?",
      status:
        phase === "morning"
          ? "Starts when you're ready"
          : state.serviceOver
            ? `${state.orders.length} orders served`
            : `${formatTime(state.now)} · ${needsAttention === 0 ? "on track" : `${needsAttention} ${needsAttention === 1 ? "alert" : "alerts"}`}`,
    },
    {
      key: "close",
      href: "/close",
      name: "Close",
      question: "How did the day go?",
      status: state.serviceOver ? `${formatMoney(summary.totalRevenue)} sold` : "Ready after service",
    },
  ];

  return (
    <Page>
      <PageTitle eyebrow={hero.eyebrow} title={hero.title}>
        {hero.text}
      </PageTitle>
      <div>
        <ButtonLink primary href={hero.href}>{hero.action} →</ButtonLink>
      </div>

      <ol className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
        {steps.map((step, index) => {
          const current = phase === step.key;
          return (
            <li key={step.key}>
              <Link
                href={step.href}
                className={`flex h-full flex-col rounded-2xl border bg-card p-5 transition-colors hover:border-basil/50 ${current ? "border-basil ring-1 ring-basil" : "border-line"}`}
              >
                <div className="flex min-h-7 items-center justify-between text-base text-muted">
                  <span>Step {index + 1}</span>
                  {current && <span className="rounded-full bg-basil-soft px-2.5 py-0.5 font-semibold text-basil">Now</span>}
                </div>
                <div className="mt-1 font-display text-3xl font-semibold">{step.name}</div>
                <div className="text-lg text-muted">{step.question}</div>
                <div className="mt-4 border-t border-line pt-3 text-lg font-semibold">{step.status}</div>
              </Link>
            </li>
          );
        })}
      </ol>

      <p className="text-right text-sm">
        <Link href="/demo" className="text-muted underline underline-offset-4">Demo controls</Link>
      </p>
    </Page>
  );
}
