import Link from "next/link";
import type { ReactNode } from "react";

/** The same width and spacing on every owner page. */
export function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto grid max-w-5xl grid-cols-1 gap-5 px-4 py-6">{children}</div>;
}

export function PageTitle({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <header>
      <p className="text-lg font-medium text-basil">{eyebrow}</p>
      <h1 className="font-display text-4xl leading-tight font-semibold sm:text-5xl">{title}</h1>
      {children && <div className="mt-2 text-xl text-muted">{children}</div>}
    </header>
  );
}

export function Card({ title, note, children }: { title?: string; note?: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-line bg-card p-5 sm:p-6">
      {title && <h2 className="font-display text-2xl font-semibold">{title}</h2>}
      {note && <p className="mt-0.5 text-lg text-muted">{note}</p>}
      <div className={title || note ? "mt-3" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-card p-5">
      <div className="text-lg text-muted">{label}</div>
      <div className="font-display text-4xl font-semibold tabular-nums">{value}</div>
      {detail && <div className="mt-1 text-base text-muted">{detail}</div>}
    </div>
  );
}

type Tone = "urgent" | "warning" | "info" | "good";

const TONES: Record<Tone, { box: string; text: string; label: string }> = {
  urgent: { box: "bg-urgent-soft border-urgent/25", text: "text-urgent", label: "⚠ Act now" },
  warning: { box: "bg-caution-soft border-caution/25", text: "text-caution", label: "! Heads up" },
  info: { box: "bg-note-soft border-note/25", text: "text-note", label: "i Note" },
  good: { box: "bg-basil-soft border-basil/25", text: "text-basil", label: "✓ Good" },
};

/** Tone is always shown with a label as well as a color. */
export function Notice({ tone, children, action }: { tone: Tone; children: ReactNode; action?: ReactNode }) {
  const style = TONES[tone];
  return (
    <div className={`rounded-2xl border p-4 sm:px-5 ${style.box}`}>
      <div className={`text-base font-semibold ${style.text}`}>{style.label}</div>
      <div className="text-xl leading-snug font-semibold">{children}</div>
      {action && <div className="mt-3 flex flex-wrap items-center gap-3">{action}</div>}
    </div>
  );
}

const BUTTON = "inline-flex min-h-12 items-center justify-center rounded-xl px-5 py-2 text-lg font-semibold transition-colors";
const PRIMARY = "bg-basil text-white hover:bg-basil/90";
const SECONDARY = "border border-line bg-card text-ink hover:bg-paper";

export function Button({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${BUTTON} ${primary ? PRIMARY : SECONDARY} disabled:cursor-not-allowed disabled:opacity-45`}
    >
      {children}
    </button>
  );
}

export function ButtonLink({ href, children, primary }: { href: string; children: ReactNode; primary?: boolean }) {
  return (
    <Link href={href} className={`${BUTTON} ${primary ? PRIMARY : SECONDARY}`}>
      {children}
    </Link>
  );
}

/** Ends every page the same way: where you came from, and what to do next. */
export function NextStep({ back, title, children }: { back?: { href: string; label: string }; title: string; children: ReactNode }) {
  return (
    <nav aria-label="Next step" className="mt-2 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-basil-soft p-5">
      <div>
        <div className="font-display text-2xl font-semibold">{title}</div>
        {back && (
          <Link href={back.href} className="text-lg text-muted underline underline-offset-4 hover:text-ink">
            ← {back.label}
          </Link>
        )}
      </div>
      <div className="flex flex-wrap gap-3">{children}</div>
    </nav>
  );
}
