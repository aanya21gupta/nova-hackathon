# Project context: "Spine" — one data spine for a small restaurant

> This file is the standing context for any coding agent working in this repo. Read it fully before making changes. When a decision isn't covered here, choose the simplest option that keeps the demo working, and note it in `DECISIONS.md`.

## 1. What this is

A hackathon prototype for the **DoorDash x Nova Hackathon** (November 2026), built by three first-year CS students in a short time window.

**One-line pitch:** One forecast runs the whole restaurant day: it plans the morning, paces the kitchen during the rush, and closes the books at night, explaining everything in plain English.

**Target prize track:** "Most Creative Solution" (rewards multi-pain-point systems and novel uses of AI), with "Best Merchant Experience" as a secondary fit.

**Required deliverables:** a live demo (a video recording is allowed) showing a **happy path and a sad path**, plus a slide deck. Mocks may fill gaps, but the core loop must actually run.

## 2. The user (design every screen for her)

**Mai, owner of "Basil & Rice"** (fictional), a small Thai takeout restaurant.
- 6 staff and roughly 120–220 orders a day.
- Orders arrive from three channels: DoorDash, other delivery apps (one generic "App B"), and phone/walk-in.
- She currently plans prep from gut feel, orders from suppliers by eyeballing the walk-in, and does her books on Sunday nights from a folder of receipts.
- She is not technical, and she is on her feet all day, so the UI must be glanceable, use big text, and contain no jargon.

**Secondary user: the line cook.** They see only the "Fire Now" kitchen screen during service.

## 3. The core idea: the spine

Every module reads from one shared forecast and one shared data model. That shared core is the product. The modules are views on it.

```
                ┌───────────────────────────┐
  history ───►  │  FORECAST (orders/hour,    │ ◄── re-forecast mid-service
  weather/event │  per item, per channel)    │     when actuals drift
                └─────────────┬─────────────┘
        ┌──────────────┬──────┴───────┬─────────────────┐
        ▼              ▼              ▼                 ▼
   PREP LIST     SUPPLIER ORDER   STAFFING PLAN    FIRE-NOW QUEUE
   (morning)     (morning)        (morning)        (during service)
        └──────────────┴──────┬───────┴─────────────────┘
                              ▼
                 CLOSE THE BOOKS + "EXPLAIN MY DAY"
                 (after service: actual vs. forecast,
                  food cost, payouts, invoices, advice)
```

The day has three phases, and the app is organized around them: **Morning → Service → Close.**

## 4. Modules and their logic

All numeric logic is **deterministic code**. The LLM never invents numbers (see section 6).

### 4.1 Forecast
- Input: ~8 weeks of synthetic order history, plus simple modifiers for weather (rain → delivery share up) and local events (home game → evening spike).
- Method: baseline = average orders for the same weekday and hour across history. Apply multiplicative modifiers. Split into menu items by historical item mix, and into channels by channel mix.
- Output: expected orders per hour, per item, per channel, with a low/high band (e.g. ±1 standard deviation).
- **Re-forecast:** during service, if actual orders over the last 60 minutes differ from forecast by more than 20%, scale the remaining hours' forecast by the observed ratio and push updates to every downstream module.
- Keep it explainable. It should be easy to explain to a judge. 

### 4.2 Prep list (morning)
- For each menu item, look up its recipe (ingredients and quantities) and multiply by the forecasted count to get ingredient needs.
- Subtract what's already prepped; output tasks such as "Prep 4 qt curry base by 10:30" ordered by when they're needed.

### 4.3 Supplier order (morning)
- Projected usage for the next N days (from the forecast) + par buffer − current on-hand = order quantity, rounded to supplier pack sizes.
- Flag items that will run out today ("Jasmine rice runs out around 7:40pm at forecast pace").

### 4.4 Staffing plan (morning)
- Convert forecasted orders per hour into required staff per hour using an orders-per-labor-hour ratio per station.
- Each staff member has skills (wok, fryer, packing, register). Check that every open hour has at least one person per required skill.
- Flag single points of failure: "Only Dev can run the wok, and he's off Saturday." Suggest a cross-training pair.

### 4.5 Fire-now queue (during service)
- Every incoming order has items with prep times and a target ready time: the driver's ETA for delivery orders, or the quoted time for pickup.
- **Start time = ready time − prep time − packing buffer.** The queue sorts by start time and shows cooks "FIRE NOW", "UP NEXT", and "HOLD".
- When a driver's ETA changes, recompute and reshuffle. The goal is food that's neither late nor sitting out.
- Run it from a **service simulator** that replays a dinner rush at adjustable speed (e.g. 1 real second = 1 simulated minute).

### 4.6 Close the books + "Explain my day" (after service)
- Revenue by channel, delivery commissions/fees, and expected payout per channel (synthetic payout reports).
- **Invoice intake:** upload a photo or PDF of a supplier invoice → the LLM extracts line items into JSON (vendor, item, quantity, unit price) → code validates the arithmetic and compares unit prices against the last invoice.
- Food cost % for the day = cost of ingredients used (from recipes × items sold × latest unit prices) / food revenue.
- **Explain my day:** code computes a structured summary (forecast vs. actual, best/worst items, cost changes, payout gaps, stockouts, labor %). The LLM turns that summary into a short plain-English recap with 1–3 concrete recommendations.

## 5. Demo scenarios (build toward these first)

The demo is **one simulated Saturday** at Basil & Rice, walked through Morning → Service → Close. The team will present it as a story.

**Happy path**
1. Morning: Mai opens the app and sees the forecast (Saturday + home game = busy evening), a prep list, a supplier order, and a staffing plan.
2. Service: the simulator runs the rush, and the kitchen screen calmly sequences orders.
3. Close: the books close automatically and "Explain my day" summarizes it.

**Sad paths (judges explicitly asked for these; each must be triggerable from a demo control panel)**
- **Rush beats forecast:** at 6:30pm, orders run 35% above forecast. The system re-forecasts, warns "Pad thai noodles will run out by 8:15," suggests pausing that item on delivery apps, and flags that packing is understaffed.
- **Driver delay:** a driver's ETA jumps +12 minutes. The queue moves that order from FIRE NOW to HOLD so the food isn't sitting.
- **Invoice price spike / bad scan:** an uploaded invoice shows chicken thighs up 22%, and the recap says how much that hurts margin on the affected dishes. A blurry or inconsistent invoice (line totals don't sum) is flagged for Mai to check rather than silently accepted.
- **Payout gap:** a delivery payout is lower than expected sales minus fees, and the recap lists the specific orders that don't match.

## 6. AI usage rules (important)

- **Code computes, the LLM explains.** Every number shown to the user comes from deterministic code. LLM prompts receive JSON and must use the information in that file to make their predictions. 
- LLM jobs in this app: (1) invoice photo → structured JSON, (2) "Explain my day" recap (that uses previous learnings on resturant data), (3) one-line reasons on alerts ("why is this flagged?"), (4) optional: a small "Ask Spine" chat over the day's computed data.
- Every LLM call must have a **non-AI fallback** (templated text or a pre-recorded response) so the live demo can't die on a network or API failure. Add a `DEMO_OFFLINE=true` mode that uses cached responses.
- API keys are read from environment variables only. Never commit keys.

## 7. Tech stack (default; change only with a reason recorded in DECISIONS.md)

- **Next.js (App Router) + TypeScript + Tailwind**, a single app in one repo.
- **Data:** seeded JSON files or SQLite via a lightweight library. No external database or auth.
- **LLM:** one provider behind a single `lib/llm.ts` wrapper (so it can be swapped or mocked).
- **Charts:** Recharts.
- No real POS, DoorDash, or supplier integrations. Everything is synthetic data, generated by a seed script, that *looks* like real exports. Label the app clearly as a prototype with synthetic data.

## 8. Suggested structure

```
/app
  /morning        forecast, prep list, supplier order, staffing
  /service        owner view + /service/kitchen (cook-facing Fire Now screen)
  /close          books, invoice upload, "Explain my day"
  /demo           control panel: sim clock, speed, sad-path triggers, reset
/lib
  forecast.ts  prep.ts  ordering.ts  staffing.ts  queue.ts  books.ts
  simulator.ts    replays orders on a simulated clock
  llm.ts          wrapper + cached/offline responses
  types.ts        shared data model
/data
  seed.ts         generates history, menu, recipes, staff, suppliers, invoices, payouts
  /invoices       sample invoice images (clean, price spike, blurry/inconsistent)
/tests            unit tests for forecast, queue, and books math
DECISIONS.md      running log of choices and assumptions
```

## 9. Shared data model (sketch; refine in `lib/types.ts`)

- `MenuItem { id, name, price, prepMinutes, station, recipe: {ingredientId, qty, unit}[] }`
- `Ingredient { id, name, unit, onHand, parLevel, packSize, supplierId, lastUnitPrice }`
- `Order { id, channel: 'doordash'|'appB'|'direct', placedAt, items: {menuItemId, qty}[], targetReadyAt, driverEtaAt?, status }`
- `StaffMember { id, name, skills: string[], hourlyRate, availability }`
- `Forecast { date, hourly: {hour, orders, low, high, byItem, byChannel}[], modifiers: string[] }`
- `Invoice { id, vendor, date, lines: {ingredientId?, rawName, qty, unitPrice, lineTotal}[], total, confidence, flags: string[] }`
- `Payout { channel, date, grossSales, fees, expectedNet, actualNet }`

## 10. Priorities and scope discipline

Build in this order; each milestone should leave the app demoable.
1. **Seed data + forecast + Morning screen** (static is fine).
2. **Simulator + Fire-now queue + kitchen screen** (the most visual part of the demo).
3. **Close screen + Explain my day** (with offline fallback).
4. **Sad-path triggers in /demo**, plus re-forecast propagation across modules.
5. **Invoice photo upload** (LLM extraction + validation).
6. Polish: big-text kitchen view, phone-sized owner view, transitions.
7. Stretch only if everything above is solid: "Ask Spine" chat, staffing cross-training suggestions.

Rules:
- A working, reliable demo beats more features. Don't start a milestone until the previous one runs end to end.
- Prefer fake-but-consistent data over half-built real integrations.
- Keep the math simple and explainable. A judge should be able to follow any number back to its source.
- Write small unit tests for the forecast, queue ordering, and books math. These are where silent bugs ruin a demo.

## 11. Pitch framing (for consistency between app copy and the deck)

- **Problem:** small restaurants run on 3–5% margins and make every decision from disconnected sources and gut feel.
- **Insight:** the morning plan, the dinner rush, and the books are all the same question ("how busy will we be, and what does that cost?") asked at different times of day.
- **Positioning vs. existing tools:** xtraCHEF (Toast) and MarginEdge handle invoices and food cost, and Loop AI handles delivery payout reconciliation. They're mostly built for larger or multi-location operators, priced per tool per location, need POS integrations, and show dashboards rather than advice. Spine is one connected loop for a small independent, works from photos and exports, and tells the owner what to do.
