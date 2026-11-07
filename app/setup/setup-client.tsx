"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";

const REQUIRED_COLUMNS = [
  "order_id",
  "placed_at",
  "channel",
  "item_name",
  "qty",
  "price",
  "ready_at",
  "picked_up_at",
] as const;

type SourceId = "pos" | "delivery" | "menu" | "invoices" | "staff" | "inventory";
type CsvRow = Record<(typeof REQUIRED_COLUMNS)[number], string>;

const SOURCES: { id: SourceId; title: string; subtitle: string; unlocks: string; connection: string; required?: boolean }[] = [
  { id: "pos", title: "POS / cashier system", subtitle: "Toast, Square or Clover", unlocks: "Forecast, live queue and sales", connection: "Connect an account or import a sales CSV", required: true },
  { id: "delivery", title: "Delivery apps", subtitle: "DoorDash and others", unlocks: "Channel mix and payout checks", connection: "Connect each delivery account" },
  { id: "menu", title: "Menu + recipes", subtitle: "One-time owner confirmation", unlocks: "Prep, ordering and food cost", connection: "AI drafts recipes from your menu; you confirm" },
  { id: "invoices", title: "Supplier invoices", subtitle: "Photos or PDFs", unlocks: "Current costs and price alerts", connection: "Upload an invoice photo" },
  { id: "staff", title: "Staff + schedule", subtitle: "CSV or scheduling app", unlocks: "Staffing plan and skill gaps", connection: "Import a CSV or connect scheduling" },
  { id: "inventory", title: "Inventory counts", subtitle: "Voice or manual entry", unlocks: "Run-out warnings", connection: "Speak or enter on-hand counts" },
];

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') { cell += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { cells.push(cell.trim()); cell = ""; }
    else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function parseCsv(text: string): { rows: CsvRow[]; missing: string[] } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { rows: [], missing: [...REQUIRED_COLUMNS] };
  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length) return { rows: [], missing };
  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(REQUIRED_COLUMNS.map((column) => [column, values[headers.indexOf(column)] ?? ""])) as CsvRow;
  });
  return { rows, missing: [] };
}

export default function SetupClient({ restaurantName, menu }: { restaurantName: string; menu: { id: string; name: string }[] }) {
  const [connected, setConnected] = useState<SourceId[]>(["menu", "invoices"]);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("spine:connected-sources");
    if (saved) setConnected(JSON.parse(saved) as SourceId[]);
  }, []);

  const setSourceConnected = (id: SourceId) => {
    const next = Array.from(new Set([...connected, id]));
    setConnected(next);
    localStorage.setItem("spine:connected-sources", JSON.stringify(next));
  };

  const menuNames = useMemo(() => new Set(menu.map((item) => item.name.toLowerCase())), [menu]);
  const unmatched = useMemo(() => Array.from(new Set(rows.filter((row) => !menuNames.has(row.item_name.toLowerCase())).map((row) => row.item_name))).filter(Boolean), [rows, menuNames]);
  const dates = rows.map((row) => new Date(row.placed_at)).filter((date) => !Number.isNaN(date.valueOf())).sort((a, b) => +a - +b);

  const chooseCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const result = parseCsv(await file.text());
    setFileName(file.name);
    setLoaded(false);
    if (result.missing.length) {
      setRows([]);
      setError(`Missing required columns: ${result.missing.join(", ")}`);
      return;
    }
    setError(result.rows.length ? "" : "The file has headers but no order rows.");
    setRows(result.rows);
  };

  const loadOrders = () => {
    localStorage.setItem("spine:pos-order-history", JSON.stringify(rows));
    setSourceConnected("pos");
    setLoaded(true);
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-8 pb-12">
      <header className="rounded-2xl bg-basil p-7 text-white">
        <div className="text-sm font-semibold uppercase tracking-[.18em] text-white/80">Connect your restaurant</div>
        <h1 className="mt-2 font-display text-4xl font-semibold">Set up {restaurantName}</h1>
        <p className="mt-2 max-w-3xl text-lg text-white/85">Bring the systems you already use. Each connection turns on another part of the operating plan.</p>
        <div className="mt-5 inline-flex rounded-full bg-white px-4 py-2 font-semibold text-basil">Minimum to start: POS sales export + menu</div>
      </header>

      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div><h2 className="font-display text-3xl font-semibold">Data sources</h2><p className="text-muted">{connected.length} of {SOURCES.length} connected</p></div>
          <div className="text-right text-sm text-muted">Connect buttons load demo data<br />No external accounts are changed</div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {SOURCES.map((source) => {
            const isConnected = connected.includes(source.id);
            return (
              <article key={source.id} className="rounded-2xl border border-line bg-card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xl font-semibold">{source.title}</h3>
                      {source.required && <span className="rounded bg-urgent-soft px-2 py-1 text-xs font-bold text-urgent">REQUIRED</span>}
                    </div>
                    <p className="text-sm text-muted">{source.subtitle}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-bold ${isConnected ? "bg-basil-soft text-basil" : "bg-paper text-muted"}`}>{isConnected ? "✓ Connected" : "Not connected"}</span>
                </div>
                <div className="mt-5 rounded-xl bg-paper p-3 text-sm"><span className="font-bold">Unlocks:</span> {source.unlocks}</div>
                <p className="mt-3 text-sm text-muted">{source.connection}</p>
                {source.id === "pos" ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <a href="#pos-import" className="inline-block rounded-lg bg-basil px-4 py-2 font-semibold text-white hover:bg-basil/90">Import POS CSV</a>
                    <button onClick={() => setSourceConnected("pos")} disabled={isConnected} className="rounded-lg border border-line bg-card px-4 py-2 font-semibold hover:bg-paper disabled:border-neutral-200 disabled:text-neutral-400">{isConnected ? "Demo data loaded" : "Connect demo POS"}</button>
                  </div>
                ) : (
                  <button onClick={() => setSourceConnected(source.id)} disabled={isConnected} className="mt-4 rounded-lg bg-basil px-4 py-2 font-semibold text-white hover:bg-basil/90 disabled:cursor-default disabled:bg-neutral-200 disabled:text-muted">{isConnected ? "Demo data loaded" : `Connect ${source.title} · demo`}</button>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section id="pos-import" className="rounded-2xl border border-line bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><div className="text-sm font-semibold uppercase tracking-wider text-muted">POS / cashier system</div><h2 className="font-display text-3xl font-semibold">Import a sales export</h2><p className="mt-1 text-muted">Use the template, then upload a CSV from Toast, Square, Clover or another POS.</p></div>
          <a download href="/pos-sales-template.csv" className="rounded-lg border border-line bg-card px-4 py-2 font-semibold hover:bg-paper">Download CSV template</a>
        </div>
        <label className="mt-6 flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-line p-7 text-center hover:border-basil">
          <span className="text-lg font-bold">Choose POS sales CSV</span><span className="text-sm text-muted">Required columns are validated before anything loads.</span>
          <input type="file" accept=".csv,text/csv" onChange={chooseCsv} className="sr-only" />
        </label>
        {fileName && <p className="mt-2 text-sm text-muted">Selected: {fileName}</p>}
        {error && <div className="mt-4 rounded-xl bg-urgent-soft p-4 font-semibold text-urgent">{error}</div>}
        {rows.length > 0 && (
          <div className="mt-5 grid gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-paper p-4"><div className="text-sm text-muted">Rows</div><div className="text-2xl font-bold">{rows.length}</div></div>
              <div className="rounded-xl bg-paper p-4"><div className="text-sm text-muted">Date range</div><div className="font-bold">{dates.length ? `${dates[0].toLocaleDateString()} – ${dates[dates.length - 1].toLocaleDateString()}` : "No valid dates"}</div></div>
              <div className={`rounded-xl p-4 ${unmatched.length ? "bg-caution-soft" : "bg-basil-soft"}`}><div className="text-sm text-muted">Menu matching</div><div className="font-bold">{unmatched.length ? `${unmatched.length} unmatched item${unmatched.length === 1 ? "" : "s"}` : "All items matched"}</div></div>
            </div>
            {unmatched.length > 0 && <div className="rounded-xl border border-caution/25 bg-caution-soft p-4"><div className="font-bold">Not found on the menu</div><p>{unmatched.join(", ")}</p><p className="mt-1 text-sm text-muted">These rows will be retained for review and won’t be assigned to a recipe.</p></div>}
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-paper"><tr>{["Order", "Placed", "Channel", "Item", "Qty", "Price"].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{rows.slice(0, 5).map((row, index) => <tr key={`${row.order_id}-${index}`} className="border-t border-neutral-200"><td className="p-3">{row.order_id}</td><td className="p-3">{row.placed_at}</td><td className="p-3">{row.channel}</td><td className="p-3">{row.item_name}</td><td className="p-3">{row.qty}</td><td className="p-3">{row.price}</td></tr>)}</tbody></table>
            </div>
            <div className="flex items-center gap-4"><button onClick={loadOrders} className="rounded-lg bg-basil px-5 py-3 font-semibold text-white hover:bg-basil/90">Load {rows.length} rows as order history</button>{loaded && <span className="font-bold text-basil">✓ Order history loaded</span>}</div>
          </div>
        )}
      </section>
    </div>
  );
}
