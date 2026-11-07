// Track C. The only file that talks to an LLM. Server-side only: import it from
// /api routes, never from a client component, so the key can't reach the browser.
// Order: cached response if DEMO_OFFLINE=true, else live call with a timeout,
// then validation, then the fallback on any failure. This must never throw.

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

export async function runLLM<T>(request: LLMRequest<T>): Promise<LLMResult<T>> {
  throw new Error("Not implemented (Track C): runLLM");
}

/** True if the text contains any number that isn't in the input JSON. */
export function hasInventedNumbers(text: string, input: unknown): boolean {
  throw new Error("Not implemented (Track C): hasInventedNumbers");
}
