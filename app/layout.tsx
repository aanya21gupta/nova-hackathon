import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { getData } from "@/data";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spine",
  description: "One forecast runs the whole restaurant day.",
};

const NAV = [
  { href: "/morning", label: "Morning" },
  { href: "/service", label: "Service" },
  { href: "/close", label: "Close" },
  { href: "/setup", label: "Setup" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  const restaurant = getData();
  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="bg-amber-200 px-4 py-1 text-center text-base">Prototype with synthetic data</div>
        <nav className="flex flex-wrap items-center gap-6 border-b border-neutral-300 px-4 py-3 text-2xl font-semibold">
          <Link href="/">{restaurant.name}</Link>
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="underline-offset-4 hover:underline">
              {item.label}
            </Link>
          ))}
        </nav>
        <main className="p-4">{children}</main>
      </body>
    </html>
  );
}
