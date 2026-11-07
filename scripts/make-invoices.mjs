// Draws the three sample invoices into public/invoices. Run once with:
//   node scripts/make-invoices.mjs
// Uses sharp, which comes with Next.js. The matching correct readings are in data/llm-cache.
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const money = (n) => `$${n.toFixed(2)}`;

const INVOICES = {
  clean: {
    vendor: "Valley Meats",
    lines: [
      ["Chicken thighs, boneless", "40 lb", 3.5, 140],
      ["Ground pork", "10 lb", 3.2, 32],
    ],
    total: 172,
  },
  priceSpike: {
    vendor: "Valley Meats",
    lines: [
      ["Chicken thighs, boneless", "40 lb", 4.27, 170.8],
      ["Ground pork", "10 lb", 3.2, 32],
    ],
    total: 202.8,
  },
  badScan: {
    vendor: "Thai Harvest Supply",
    lines: [
      ["Jasmine rice", "50 lb", 1.6, 80],
      ["Pad Thai noodles", "20 lb", 3.4, 68],
      ["Curry base", "8 qt", 11, 98], // Should be 88.00.
    ],
    total: 240, // The lines add up to 246.00.
    blur: 1.6,
    rotate: -1.5,
  },
};

function svg(invoice) {
  const rows = invoice.lines
    .map(([name, qty, unit, total], i) => {
      const y = 300 + i * 56;
      return `<text x="60" y="${y}">${name}</text><text x="520" y="${y}">${qty}</text><text x="660" y="${y}">${money(unit)}</text><text x="820" y="${y}">${money(total)}</text>`;
    })
    .join("");
  const totalY = 300 + invoice.lines.length * 56 + 40;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${totalY + 90}">
    <rect width="100%" height="100%" fill="#fbfaf5"/>
    <g font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#1a1a1a">
      <text x="60" y="90" font-size="48" font-weight="700">${invoice.vendor}</text>
      <text x="60" y="140">INVOICE · Date: 2026-11-07 · Bill to: Basil &amp; Rice</text>
      <g font-weight="700"><text x="60" y="230">Item</text><text x="520" y="230">Qty</text><text x="660" y="230">Unit price</text><text x="820" y="230">Total</text></g>
      <line x1="60" x2="940" y1="250" y2="250" stroke="#1a1a1a" stroke-width="2"/>
      ${rows}
      <line x1="60" x2="940" y1="${totalY - 40}" y2="${totalY - 40}" stroke="#1a1a1a" stroke-width="2"/>
      <text x="660" y="${totalY}" font-weight="700">TOTAL</text><text x="820" y="${totalY}" font-weight="700">${money(invoice.total)}</text>
    </g></svg>`;
}

await mkdir("public/invoices", { recursive: true });
for (const [name, invoice] of Object.entries(INVOICES)) {
  let image = sharp(Buffer.from(svg(invoice)));
  if (invoice.rotate) image = image.rotate(invoice.rotate, { background: "#8a8a84" });
  if (invoice.blur) image = image.blur(invoice.blur);
  await image.png().toFile(`public/invoices/${name}.png`);
  console.log(`Wrote public/invoices/${name}.png`);
}
