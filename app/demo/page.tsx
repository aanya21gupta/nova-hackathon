"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Button, Card, Notice, Page, PageTitle } from "@/components/ui";
import { formatTime, orderLabel } from "@/lib/format";
import { scanSample } from "@/lib/invoiceClient";
import { DEMO_JUMP_MINUTE, DRIVER_DELAY_MINUTES, makeRushTrigger, pickDelayTarget } from "@/lib/simulator";
import type { InvoiceSample } from "@/lib/types";
import { useSim } from "@/lib/useSim";

const SPEEDS = [1, 2, 5, 10];
const JUMPS: { label: string; minute: number }[] = [
  { label: "5:00pm", minute: 17 * 60 },
  // At 6:20pm a delivery order is on FIRE NOW, and the 6:30pm rush check is 10 minutes away.
  { label: "6:20pm", minute: DEMO_JUMP_MINUTE },
  { label: "9:00pm (close)", minute: 21 * 60 },
];

interface LLMStatus {
  offline: boolean;
  hasKey: boolean;
  model: string | null;
}

function aiStatusText(status: LLMStatus | null): string {
  if (!status) return "Checking…";
  if (status.offline) return "Offline: saved answers and templates only (DEMO_OFFLINE=true).";
  if (!status.hasKey) return "Off: OPENROUTER_API_KEY isn't set, so saved answers and templates are used.";
  if (!status.model) return "Off: LLM_MODEL isn't set, so saved answers and templates are used.";
  return `Live: ${status.model}. Falls back to saved answers and templates if a call fails.`;
}

function Trigger({ children, note }: { children: ReactNode; note: string }) {
  return (
    <div className="flex flex-col items-start gap-1 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap gap-3">{children}</div>
      <p className="text-base text-muted">{note}</p>
    </div>
  );
}

export default function DemoPage() {
  const { state, control, running, start, pause, setSpeed, jumpTo, fire, reset } = useSim();
  const [status, setStatus] = useState<LLMStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => setStatus(null));
  }, []);

  const rushOn = control.triggers.some((t) => t.type === "rush");
  const gapOn = control.triggers.some((t) => t.type === "payoutGap");
  const badOn = control.triggers.some((t) => t.type === "badSuggestion");
  const delayTarget = pickDelayTarget(state);

  function delayDriver() {
    if (!delayTarget) return;
    const label = state.queue.find((e) => e.orderId === delayTarget)?.label;
    fire({ type: "driverDelay", atMinute: state.now, orderId: delayTarget, delayMinutes: DRIVER_DELAY_MINUTES });
    setMessage(`Order ${orderLabel(delayTarget)}'s driver is ${DRIVER_DELAY_MINUTES} minutes late. It was on ${label} and moves to HOLD.`);
  }

  async function scan(sample: InvoiceSample) {
    try {
      fire({ type: "invoice", invoice: await scanSample(sample) });
      setMessage("Invoice scanned. See the Close screen.");
    } catch {
      setMessage("The invoice scan failed. Is the app still running?");
    }
  }

  return (
    <Page>
      <PageTitle eyebrow="Demo controls" title={formatTime(state.now)}>
        {running ? `Running: 1 second = ${control.speed} minute${control.speed > 1 ? "s" : ""}` : "Paused"}
      </PageTitle>

      {message && <Notice tone="info">{message}</Notice>}

      <Card title="Clock">
        <div className="flex flex-wrap gap-3">
          {running ? <Button onClick={pause}>Pause</Button> : <Button primary onClick={start}>Start</Button>}
          {SPEEDS.map((speed) => (
            <Button key={speed} primary={control.speed === speed} onClick={() => setSpeed(speed)}>{speed}x</Button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          {JUMPS.map((jump) => (
            <Button key={jump.minute} onClick={() => jumpTo(jump.minute)}>Jump to {jump.label}</Button>
          ))}
        </div>
      </Card>

      <Card title="Sad paths">
        <div className="grid grid-cols-1 gap-4">
          <Trigger note="Orders run 35% over from 5:30pm. Spine catches it at the 6:30pm check. Works best if you fire it before 6:30pm.">
            <Button disabled={rushOn} onClick={() => fire(makeRushTrigger(state.now))}>{rushOn ? "✓ Rush is on" : "Rush beats forecast"}</Button>
          </Trigger>
          <Trigger note={`Adds ${DRIVER_DELAY_MINUTES} minutes to a delivery order. Watch it move on the kitchen screen.`}>
            <Button disabled={!delayTarget} onClick={delayDriver}>
              {delayTarget ? `Delay the driver for ${orderLabel(delayTarget)}` : "No delivery order is waiting"}
            </Button>
          </Trigger>
          <Trigger note="Results show on the Close screen.">
            <Button onClick={() => scan("priceSpike")}>Invoice: chicken up 22%</Button>
            <Button onClick={() => scan("badScan")}>Invoice: blurry, doesn&apos;t add up</Button>
          </Trigger>
          <Trigger note="DoorDash leaves three orders out of its payout. Shows on the Close screen once the clock has passed those orders.">
            <Button disabled={gapOn} onClick={() => fire({ type: "payoutGap" })}>{gapOn ? "✓ Payout gap is on" : "Payout gap"}</Button>
          </Trigger>
        </div>
      </Card>

      <Card title="AI guardrail">
        <Trigger note="The next agent plan includes a made-up dish and made-up numbers. Watch Spine reject it on screen. Press this before the rush or a run-out plan appears.">
          <Button disabled={badOn} onClick={() => fire({ type: "badSuggestion" })}>{badOn ? "✓ Bad suggestion is on" : "Feed the agent a bad suggestion"}</Button>
        </Trigger>
      </Card>

      <Card title="Open a screen" note="Opens in a new tab and stays in sync with these controls.">
        <div className="flex flex-wrap gap-5 text-xl underline underline-offset-4">
          <Link href="/morning" target="_blank">Morning</Link>
          <Link href="/service" target="_blank">Service</Link>
          <Link href="/service/kitchen" target="_blank">Kitchen</Link>
          <Link href="/close" target="_blank">Close</Link>
        </div>
      </Card>

      <Card title="AI status">
        <p className="text-lg">{aiStatusText(status)}</p>
      </Card>

      <div>
        <Button onClick={() => { reset(); setMessage(null); }}>Reset the whole demo</Button>
      </div>
    </Page>
  );
}
