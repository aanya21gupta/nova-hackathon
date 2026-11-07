// Checks AI text for numbers it was never given. Safe to use in server and browser code.
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
