// The only file that talks to an LLM. Server-side only: import it from /api routes,
// never from a client component, so the key can't reach the browser.
//
// Order: DEMO_OFFLINE=true uses the cache. Otherwise it makes a live call with a
// timeout and validates the result. Anything that fails falls back to the cache and
// then to the request's own fallback. runLLM never throws.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 20_000;

export type LLMJob = "invoice" | "recap" | "alertReason";

export interface LLMRequest<T> {
  job: LLMJob;
  /** Names the file in data/llm-cache used in offline mode. */
  cacheKey: string;
  instructions: string;
  /** Pre-computed JSON. For text jobs, the output may only use numbers from this. */
  input: unknown;
  /** Base64 data URL, for invoice photos. */
  imageDataUrl?: string;
  parse: (raw: string) => T;
  /** Return false to reject the output and use the fallback. */
  validate: (value: T) => boolean;
  fallback: () => T;
}

export interface LLMResult<T> {
  value: T;
  source: "live" | "cache" | "fallback";
}

export function llmStatus(): { offline: boolean; hasKey: boolean; model: string | null } {
  return {
    offline: process.env.DEMO_OFFLINE === "true",
    hasKey: Boolean(process.env.OPENROUTER_API_KEY),
    model: process.env.LLM_MODEL || null,
  };
}

function cachePath(key: string): string {
  return join(process.cwd(), "data", "llm-cache", `${key.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
}

function accept<T>(raw: string, request: LLMRequest<T>): T | null {
  try {
    const value = request.parse(raw);
    return request.validate(value) ? value : null;
  } catch {
    return null;
  }
}

async function fromCache<T>(request: LLMRequest<T>): Promise<T | null> {
  try {
    return accept(await readFile(cachePath(request.cacheKey), "utf8"), request);
  } catch {
    return null;
  }
}

/** Saves a good live answer for offline use. Hand-written cache files are never replaced. */
async function saveToCache(key: string, raw: string): Promise<void> {
  try {
    await writeFile(cachePath(key), raw, { flag: "wx" });
  } catch {
    // Already cached, or a read-only disk. Neither matters to the caller.
  }
}

async function callLive<T>(request: LLMRequest<T>, apiKey: string, model: string): Promise<string | null> {
  const prompt = `${request.instructions}\n\nJSON input:\n${JSON.stringify(request.input)}`;
  const content = request.imageDataUrl
    ? [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: request.imageDataUrl } },
      ]
    : prompt;
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content }],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`LLM ${request.job}: HTTP ${response.status}`);
      return null;
    }
    const body = await response.json();
    const text = body?.choices?.[0]?.message?.content;
    return typeof text === "string" ? text : null;
  } catch (error) {
    console.warn(`LLM ${request.job}: ${error instanceof Error ? error.name : "request failed"}`);
    return null;
  }
}

export async function runLLM<T>(request: LLMRequest<T>): Promise<LLMResult<T>> {
  const { offline, hasKey, model } = llmStatus();

  if (!offline && hasKey && model) {
    const raw = await callLive(request, process.env.OPENROUTER_API_KEY as string, model);
    if (raw !== null) {
      const value = accept(raw, request);
      if (value !== null) {
        await saveToCache(request.cacheKey, raw);
        return { value, source: "live" };
      }
      console.warn(`LLM ${request.job}: output failed validation`);
    }
  }

  const cached = await fromCache(request);
  if (cached !== null) return { value: cached, source: "cache" };
  return { value: request.fallback(), source: "fallback" };
}

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

function numbersIn(text: string): number[] {
  return (text.match(NUMBER) ?? []).map((n) => Number(n.replace(/,/g, ""))).filter(Number.isFinite);
}

/** True if the text contains any number that isn't in the input JSON. Rounded forms are allowed. */
export function hasInventedNumbers(text: string, input: unknown): boolean {
  const allowed = new Set<number>();
  for (const n of numbersIn(JSON.stringify(input))) {
    allowed.add(n);
    allowed.add(Math.round(n));
    allowed.add(Math.round(n * 10) / 10);
    allowed.add(Math.round(n * 100) / 100);
  }
  return numbersIn(text).some((n) => !allowed.has(n));
}
