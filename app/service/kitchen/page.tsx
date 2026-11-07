"use client";
// Cook-facing. Readable from across a room: huge type, high contrast, nothing else on screen.
import { CHANNEL_NAMES, formatTime, orderLabel } from "@/lib/format";
import type { MenuItem, QueueEntry, QueueLabel } from "@/lib/types";
import { useSim } from "@/lib/useSim";
import { activeBusyModes, readyByVoice, useVoiceLog } from "@/lib/voiceActions";
import { VoiceControl } from "@/components/VoiceControl";

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
  const fire = column.label === "FIRE NOW";
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
    </div>
  );
}

export default function KitchenPage() {
  const { state, data, running } = useSim();
  // M4: voice actions. Orders marked ready by voice leave the board (see lib/voiceActions.ts).
  const voice = useVoiceLog();
  const readyIds = readyByVoice(voice.log, state.now);
  const busy = activeBusyModes(voice.log, state.now);
  const cooking = state.orders.filter((o) => o.status === "cooking" && !readyIds.has(o.id)).length;
  const paused = state.pausedItemIds.map((id) => itemName(data.menu, id));

  return (
    <div className="flex min-h-[calc(100vh-2.5rem)] flex-col bg-neutral-950 p-4 text-white">
      <header className="mb-3 flex items-baseline justify-between gap-4">
        <h1 className="text-6xl font-bold tabular-nums">{formatTime(state.now)}</h1>
        <div className="text-4xl font-semibold text-neutral-200 tabular-nums">
          {state.serviceOver ? "Closed" : `${cooking} cooking${running ? "" : " · paused"}`}
        </div>
      </header>
      {(paused.length > 0 || busy.length > 0) && (
        <div className="mb-3 flex flex-wrap gap-3 text-3xl font-bold">
          {paused.length > 0 && <div className="rounded-xl bg-fuchsia-300 px-4 py-1.5 text-black">86&apos;d on delivery: {paused.join(", ")}</div>}
          {busy.map((b, i) => (
            <div key={i} className="rounded-xl bg-sky-300 px-4 py-1.5 text-black tabular-nums">
              Busy mode +{b.extraMinutes} min until {formatTime(b.untilTime)}
            </div>
          ))}
        </div>
      )}
      <div className="grid flex-1 grid-cols-3 gap-4">
        {COLUMNS.map((column) => {
          // A delayed order goes first, so the cook can see why it moved, even when the column is full.
          const entries = state.queue
            .filter((e) => !readyIds.has(e.orderId))
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
      <VoiceControl log={voice.log} add={voice.add} clear={voice.clear} />
    </div>
  );
}
