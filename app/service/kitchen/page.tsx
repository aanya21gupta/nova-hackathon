"use client";
// Cook-facing. Readable from across a room: huge type, high contrast, nothing else on screen.
import { CHANNEL_NAMES, formatTime, orderLabel } from "@/lib/format";
import type { MenuItem, QueueEntry, QueueLabel } from "@/lib/types";
import { useSim } from "@/lib/useSim";

const COLUMNS: { label: QueueLabel; limit: number; header: string; card: string }[] = [
  { label: "FIRE NOW", limit: 3, header: "bg-red-600 text-white", card: "border-red-500/80 bg-red-950/70" },
  { label: "UP NEXT", limit: 3, header: "bg-amber-400 text-black", card: "border-amber-400/60 bg-neutral-900" },
  { label: "HOLD", limit: 3, header: "bg-neutral-700 text-white", card: "border-neutral-700 bg-neutral-900" },
];

function itemName(menu: MenuItem[], id: string): string {
  return menu.find((m) => m.id === id)?.name ?? id;
}

/** FIRE NOW is the full card. The others stay compact so they fit on a laptop screen too. */
function OrderCard({ entry, menu, column, delayMinutes }: { entry: QueueEntry; menu: MenuItem[]; column: (typeof COLUMNS)[number]; delayMinutes?: number }) {
  const { runTool } = useSim();
  const fire = column.label === "FIRE NOW";
  const moveButton = "min-h-10 flex-1 rounded-lg bg-neutral-800 px-3 text-lg font-semibold text-white hover:bg-neutral-700";
  return (
    <div className={`rounded-2xl border-2 ${fire ? "p-4" : "px-4 py-2.5"} ${column.card}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={`font-bold tabular-nums ${fire ? "text-5xl" : "text-4xl"}`}>{orderLabel(entry.orderId)}</span>
        <span className="text-right text-2xl text-neutral-300 tabular-nums">
          {fire ? CHANNEL_NAMES[entry.order.channel] : `Start ${formatTime(entry.startAt)}`}
        </span>
      </div>
      <ul className={`font-semibold ${fire ? "mt-2 text-4xl leading-tight" : "mt-0.5 text-2xl"}`}>
        {entry.order.items.map((line) => (
          <li key={line.menuItemId}>{line.qty} × {itemName(menu, line.menuItemId)}</li>
        ))}
      </ul>
      {fire && <div className="mt-2 text-2xl text-neutral-200 tabular-nums">Ready by {formatTime(entry.readyAt)}</div>}
      {delayMinutes !== undefined && (
        <div className="mt-2 rounded-lg bg-sky-300 px-3 py-1 text-2xl font-bold text-black">Driver late +{delayMinutes} min</div>
      )}
      <div className="mt-2 flex gap-2">
        {fire ? (
          <>
            <button type="button" className={moveButton} onClick={() => runTool({ tool: "holdOrder", orderId: entry.orderId }, "owner")}>Hold</button>
            <button type="button" className={moveButton} onClick={() => runTool({ tool: "markOrderReady", orderId: entry.orderId }, "owner")}>Ready</button>
          </>
        ) : (
          <button type="button" className={moveButton} onClick={() => runTool({ tool: "fireOrder", orderId: entry.orderId }, "owner")}>Fire now</button>
        )}
      </div>
    </div>
  );
}

export default function KitchenPage() {
  const { state, data, running } = useSim();

  return (
    <div className="flex min-h-[calc(100vh-2.5rem)] flex-col bg-neutral-950 p-4 text-white">
      <header className="mb-3 flex items-baseline justify-between gap-4">
        <h1 className="text-6xl font-bold tabular-nums">{formatTime(state.now)}</h1>
        <div className="text-4xl font-semibold text-neutral-200 tabular-nums">
          {state.serviceOver ? "Closed" : `${state.cookingCount} cooking${running ? "" : " · paused"}`}
        </div>
      </header>
      <div className="grid flex-1 grid-cols-3 gap-4">
        {COLUMNS.map((column) => {
          // A delayed order goes first, so the cook can see why it moved, even when the column is full.
          const entries = state.queue
            .filter((e) => e.label === column.label)
            .sort((a, b) => Number(state.delayedOrders[b.orderId] !== undefined) - Number(state.delayedOrders[a.orderId] !== undefined));
          return (
            <section key={column.label} className="flex min-w-0 flex-col gap-3">
              <h2 className={`rounded-2xl px-4 py-2 text-center text-5xl font-bold ${column.header}`}>
                {column.label} <span className="tabular-nums">({entries.length})</span>
              </h2>
              {entries.length === 0 && <p className="p-4 text-center text-3xl text-neutral-400">Nothing here</p>}
              {entries.slice(0, column.limit).map((entry) => (
                <OrderCard key={entry.orderId} entry={entry} menu={data.menu} column={column} delayMinutes={state.delayedOrders[entry.orderId]} />
              ))}
              {entries.length > column.limit && (
                <p className="text-center text-3xl font-semibold text-neutral-300">+{entries.length - column.limit} more</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
