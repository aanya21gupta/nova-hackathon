// Track C. Code finds the patterns in history; the LLM may cite them but never computes them.
import type { HistoricalOrder, Learning } from "./types";

/** e.g. "Home-game Saturdays ran above a normal Saturday 3 of 4 times". */
export function computeLearnings(history: HistoricalOrder[]): Learning[] {
  throw new Error("Not implemented (Track C): computeLearnings");
}
