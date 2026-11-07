/**
 * Download the third-party datasets we calibrate against into data/external/.
 * The raw files are NOT committed (licences + size). Anyone can re-fetch them:
 *
 *   npx tsx scripts/fetch-data.ts          # skip files that already exist
 *   npx tsx scripts/fetch-data.ts --force  # re-download everything
 *
 * Sources & licences (credit these in the README / deck):
 *  - Pizza Place Sales: Rdatasets gt::pizzaplace — public domain.
 *      Ingredients per pizza: https://vincentarelbundock.github.io/Rdatasets/doc/gt/pizzaplace.html
 *  - DoorDash delivery durations (early 2015, noise added by DoorDash):
 *      Kaggle dharun4772/doordash-eta-prediction lists MIT; we fetch an identical GitHub mirror.
 *      Timestamps are UTC; stores were in US/Pacific.
 *  - Open-Meteo historical weather — CC BY 4.0, free for non-commercial use, no API key.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.join(__dirname, "..", "data", "external");

// Weather location for the fictional restaurant. Change freely.
const CITY = { name: "pittsburgh", lat: 40.44, lon: -80.0, tz: "America/New_York", year: 2025 };

const SOURCES = [
  {
    file: "pizzaplace.csv",
    url: "https://vincentarelbundock.github.io/Rdatasets/csv/gt/pizzaplace.csv",
    note: "public domain",
  },
  {
    file: "doordash_historical_data.csv",
    url: "https://raw.githubusercontent.com/dklim-git/DoorDash-Project/master/historical_data.csv",
    note: "MIT per Kaggle listing; DoorDash added noise",
  },
  {
    file: `openmeteo_${CITY.name}_${CITY.year}.json`,
    url:
      `https://archive-api.open-meteo.com/v1/archive?latitude=${CITY.lat}&longitude=${CITY.lon}` +
      `&start_date=${CITY.year}-01-01&end_date=${CITY.year}-12-31` +
      `&hourly=precipitation,rain,temperature_2m&timezone=${encodeURIComponent(CITY.tz)}`,
    note: "CC BY 4.0 (Open-Meteo)",
  },
];

async function main() {
  const force = process.argv.includes("--force");
  mkdirSync(OUT, { recursive: true });
  // Keep raw third-party data out of git no matter what the repo's .gitignore says.
  writeFileSync(path.join(OUT, ".gitignore"), "# raw downloads — never commit (licences + size)\n*\n");

  for (const s of SOURCES) {
    const dest = path.join(OUT, s.file);
    if (existsSync(dest) && !force) {
      console.log(`✓ ${s.file} already present (${(statSync(dest).size / 1e6).toFixed(1)} MB) — skipping`);
      continue;
    }
    process.stdout.write(`↓ ${s.file} [${s.note}] … `);
    const res = await fetch(s.url);
    if (!res.ok) throw new Error(`${s.file}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
  }
  console.log(`\nDone → ${OUT}\nNext: npx tsx scripts/calibrate.ts`);
}

main().catch((err) => {
  console.error(`fetch-data failed: ${err.message}`);
  process.exit(1);
});
