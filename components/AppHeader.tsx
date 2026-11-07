"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatTime } from "@/lib/format";
import { useSim } from "@/lib/useSim";

const STEPS = [
  { key: "morning", href: "/morning", name: "Morning", detail: "Plan the day" },
  { key: "service", href: "/service", name: "Service", detail: "Run the rush" },
  { key: "close", href: "/close", name: "Close", detail: "See the results" },
] as const;

function PrototypeLabel({ dark }: { dark?: boolean }) {
  return <span className={`text-sm ${dark ? "text-neutral-400" : "text-muted"}`}>Prototype with synthetic data</span>;
}

/** The kitchen gets only a way back, so cooks see nothing but the queue. */
function KitchenBar() {
  return (
    <div className="flex items-center justify-between gap-4 bg-black px-4 py-2">
      <Link href="/service" className="text-base font-semibold text-neutral-200 hover:text-white">
        ← Back to Service
      </Link>
      <PrototypeLabel dark />
    </div>
  );
}

export function AppHeader() {
  const pathname = usePathname();
  const { state, phase, running } = useSim();

  if (pathname === "/service/kitchen") return <KitchenBar />;

  const needsAttention = state.alerts.filter((a) => a.severity !== "info").length;
  const clockNote = phase === "morning" ? "Not started" : phase === "close" ? "Closed" : running ? "Running" : "Paused";

  return (
    <>
      <header className="mx-auto max-w-5xl px-4 pt-3 pb-2">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="min-w-0">
            <div className="font-display text-2xl leading-tight font-semibold">Basil &amp; Rice</div>
            <PrototypeLabel />
          </Link>
          <div className="shrink-0 text-right" aria-label={`Restaurant clock: ${formatTime(state.now)}, ${clockNote}`}>
            <div className="text-2xl leading-tight font-semibold tabular-nums">{phase === "morning" ? "Saturday" : formatTime(state.now)}</div>
            <div className="flex items-center justify-end gap-1.5 text-sm text-muted">
              {running && <span className="size-2 animate-pulse rounded-full bg-basil" aria-hidden />}
              {clockNote}
            </div>
          </div>
        </div>
      </header>

      {/* Only the stepper stays pinned, so it doesn't take up the screen while scrolling. */}
      <div className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
        <nav aria-label="Parts of the day" className="mx-auto max-w-5xl px-4 py-2">
          <ol className="grid grid-cols-3 gap-1 rounded-2xl bg-line/60 p-1">
            {STEPS.map((step, index) => {
              const active = pathname === step.href;
              const showBadge = step.key === "service" && phase === "service" && needsAttention > 0;
              return (
                <li key={step.key}>
                  <Link
                    href={step.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex h-full items-center gap-2.5 rounded-xl px-2 py-2 transition-colors sm:px-3 ${
                      active ? "bg-basil text-white" : "hover:bg-card/70"
                    }`}
                  >
                    <span
                      className={`hidden size-8 shrink-0 items-center justify-center rounded-full text-base font-semibold sm:flex ${
                        active ? "bg-white/20" : "bg-card"
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 text-center sm:text-left">
                      <span className="block text-lg leading-tight font-semibold">{step.name}</span>
                      <span className={`hidden text-sm leading-tight sm:block ${active ? "text-white/80" : "text-muted"}`}>
                        {phase === step.key ? "Now" : step.detail}
                      </span>
                    </span>
                    {showBadge && (
                      <span
                        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-urgent text-sm font-bold text-white"
                        aria-label={`${needsAttention} alerts`}
                      >
                        {needsAttention}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
    </>
  );
}
