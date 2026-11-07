import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { getData } from "@/data";
import { matchIngredients, parseInvoice, validateInvoice } from "@/lib/invoice";
import { runLLM } from "@/lib/llm";
import type { Invoice, InvoiceSample } from "@/lib/types";

const SAMPLES: InvoiceSample[] = ["clean", "priceSpike", "badScan"];
const MAX_DATA_URL_LENGTH = 12 * 1024 * 1024;

const INSTRUCTIONS = `Read this supplier invoice photo and copy it into JSON.
Copy every number exactly as printed. Never correct arithmetic or fill in a number you can't read, even if something looks wrong: our code checks the math afterwards. If a number is unreadable, use null.
Set "confidence" from 0 to 1 for how clearly you could read the invoice.
Respond with JSON only: {"vendor": string, "date": "YYYY-MM-DD", "lines": [{"rawName": string, "qty": number, "unitPrice": number, "lineTotal": number}], "total": number, "confidence": number}`;

function hash(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function samplePath(sample: InvoiceSample): string {
  return join(process.cwd(), "public", "invoices", `${sample}.png`);
}

/** If an uploaded photo is one of our sample files, treat it as that sample. */
async function matchSample(imageDataUrl: string): Promise<InvoiceSample | null> {
  const base64 = imageDataUrl.split(",")[1];
  if (!base64) return null;
  const uploaded = hash(Buffer.from(base64, "base64"));
  for (const sample of SAMPLES) {
    try {
      if (hash(await readFile(samplePath(sample))) === uploaded) return sample;
    } catch {
      // A missing sample file just means no match.
    }
  }
  return null;
}

export async function POST(request: Request) {
  const body = (await request.json()) as { sample?: string; imageDataUrl?: string };

  let sample: InvoiceSample | null = null;
  let imageDataUrl: string;
  if (body.sample !== undefined) {
    if (!SAMPLES.includes(body.sample as InvoiceSample)) {
      return NextResponse.json({ error: "Unknown sample" }, { status: 400 });
    }
    sample = body.sample as InvoiceSample;
    imageDataUrl = `data:image/png;base64,${(await readFile(samplePath(sample))).toString("base64")}`;
  } else if (typeof body.imageDataUrl === "string" && body.imageDataUrl.startsWith("data:image/") && body.imageDataUrl.length <= MAX_DATA_URL_LENGTH) {
    imageDataUrl = body.imageDataUrl;
    sample = await matchSample(imageDataUrl);
  } else {
    return NextResponse.json({ error: "Please send an image under 8 MB" }, { status: 400 });
  }

  const key = sample ?? hash(imageDataUrl);
  const id = `scan-${key}`;

  const result = await runLLM<Invoice>({
    job: "invoice",
    cacheKey: `invoice-${key}`,
    instructions: INSTRUCTIONS,
    input: {},
    imageDataUrl,
    parse: (raw) => parseInvoice(raw, id),
    validate: (invoice) => invoice.lines.length > 0,
    // With no AI, an unknown photo is flagged for Mai rather than guessed at.
    fallback: () => ({ id, vendor: "Unknown vendor", date: "", lines: [], total: 0, confidence: 0, flags: [] }),
  });

  return NextResponse.json({ ...validateInvoice(matchIngredients(result.value, getData())), source: result.source });
}
