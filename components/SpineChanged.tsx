"use client";
import { ComparisonChart } from "@/components/charts";
import { Card } from "@/components/ui";
import { ASSUMPTIONS, FORMULA, type Comparison, type ComparisonRow } from "@/lib/compare";
import { formatMoney } from "@/lib/format";

function formatValue(row: ComparisonRow, value: number): string {
  if (row.unit === "money") return formatMoney(value);
  if (row.unit === "minutes") return `${value.toLocaleString("en-US")} min`;
  return value.toLocaleString("en-US");
}

export function SpineChanged({ comparison }: { comparison: Comparison }) {
  const { saved, rows, breakdown, usedSuggestedPlan, decisions } = comparison;
  const headline =
    saved >= 1
      ? `Spine ${usedSuggestedPlan ? "could have saved" : "saved"} about ${formatMoney(saved)}`
      : saved <= -1
        ? `Spine's changes cost about ${formatMoney(Math.abs(saved))}`
        : "About the same money either way";

  return (
    <Card title="What Spine changed today" note="The same day replayed twice, with the same customers.">
      <p className="font-display text-4xl font-semibold text-basil tabular-nums">{headline}</p>
      {usedSuggestedPlan && (
        <p className="mt-1 text-lg text-muted">You didn&apos;t approve anything today, so this shows Spine&apos;s suggested plan.</p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-lg whitespace-nowrap tabular-nums">
          <thead>
            <tr className="border-b border-line">
              <th className="py-1 pr-4 font-semibold">&nbsp;</th>
              <th className="py-1 pr-4 text-right font-semibold">Without Spine</th>
              <th className="py-1 text-right font-semibold">With Spine</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.label} className="border-b border-line/60" title={row.source}>
                <td className="py-1.5 pr-4">
                  {row.label}
                  <sup className="ml-0.5 text-muted">{index + 1}</sup>
                </td>
                <td className="py-1.5 pr-4 text-right">{formatValue(row, row.without)}</td>
                <td className="py-1.5 text-right font-semibold">{formatValue(row, row.with)}</td>
              </tr>
            ))}
            <tr>
              <td className="py-2 pr-4 font-semibold">Money kept</td>
              <td className="py-2 pr-4 text-right">{formatMoney(comparison.without.moneyKept)}</td>
              <td className="py-2 text-right font-semibold">{formatMoney(comparison.with.moneyKept)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <ComparisonChart rows={rows.filter((row) => row.unit === "minutes")} />
      </div>

      {breakdown.length > 0 && (
        <div className="mt-4">
          <h3 className="text-lg font-semibold">Where the {formatMoney(Math.abs(saved))} came from</h3>
          <ul className="mt-1 text-lg">
            {breakdown.map((row) => (
              <li key={row.label} className="flex justify-between gap-4 py-0.5 tabular-nums">
                <span>{row.label}</span>
                <span className="font-semibold">{row.amount > 0 ? "+" : "−"}{formatMoney(Math.abs(row.amount), 2)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {decisions.length > 0 && (
        <details className="mt-3 text-lg">
          <summary className="cursor-pointer text-muted">{usedSuggestedPlan ? "Spine's suggested plan" : "What you approved"}</summary>
          <ul className="mt-1 list-disc pl-6">
            {decisions.map((decision) => (
              <li key={decision}>{decision}</li>
            ))}
          </ul>
        </details>
      )}

      <details className="mt-3 text-base">
        <summary className="cursor-pointer text-lg text-muted">How this is worked out</summary>
        <p className="mt-2 font-semibold">{FORMULA}</p>
        <ol className="mt-2 list-decimal space-y-1 pl-6">
          {rows.map((row) => (
            <li key={row.label}>
              <span className="font-semibold">{row.label}:</span> {row.source}
            </li>
          ))}
        </ol>
        <h4 className="mt-3 font-semibold">Assumptions</h4>
        <ul className="mt-1 list-disc space-y-1 pl-6">
          {ASSUMPTIONS.map((assumption) => (
            <li key={assumption}>{assumption}</li>
          ))}
        </ul>
      </details>
    </Card>
  );
}
