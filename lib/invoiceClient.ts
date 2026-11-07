// Browser helper for the invoice scan route. Used by /close and /demo.
import type { Invoice, InvoiceSample } from "./types";

async function post(body: unknown): Promise<Invoice> {
  const response = await fetch("/api/invoice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Scan failed: ${response.status}`);
  return (await response.json()) as Invoice;
}

export function scanSample(sample: InvoiceSample): Promise<Invoice> {
  return post({ sample });
}

export function scanFile(file: File): Promise<Invoice> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file"));
    reader.onload = () => post({ imageDataUrl: reader.result }).then(resolve, reject);
    reader.readAsDataURL(file);
  });
}
