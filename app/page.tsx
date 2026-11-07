import Link from "next/link";

const PHASES = [
  { href: "/morning", title: "Morning", detail: "What to prep, order and staff" },
  { href: "/service", title: "Service", detail: "How the rush is going" },
  { href: "/close", title: "Close", detail: "How the day went" },
];

export default function HomePage() {
  return (
    <div className="grid gap-4">
      {PHASES.map((phase) => (
        <Link key={phase.href} href={phase.href} className="rounded-xl border border-neutral-300 bg-white p-6">
          <div className="text-4xl font-bold">{phase.title}</div>
          <div className="text-2xl">{phase.detail}</div>
        </Link>
      ))}
    </div>
  );
}
