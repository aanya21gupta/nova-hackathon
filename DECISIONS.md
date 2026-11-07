# Decisions

Running log of choices and assumptions. Add a line whenever CLAUDE.md doesn't cover something.

## AI
- **LLM role:** code computes every number and every past pattern; the LLM only explains and advises. We read section 6's "make their predictions" as advice based on the JSON, not new numbers. Any number in LLM text that isn't in the input JSON triggers the fallback.
- **"Previous learnings":** `lib/learnings.ts` computes patterns from the 8 weeks of history in code, and they go into the recap JSON.
- **Provider:** OpenRouter, called with `fetch`, so there's no SDK. The model comes from `LLM_MODEL`. Without a key and a model, the app uses saved answers and templates.
- **Saved answers:** a good live answer is saved to `data/llm-cache/`, keyed by a hash of its input, and is what `DEMO_OFFLINE=true` replays. Run each scenario once online to record it. Saved answers still go through the number check. The three sample invoice readings are hand-written and never overwritten.

- **Model comparison (one run each, on our clean synthetic images):** `openai/gpt-6-luna` and `anthropic/claude-sonnet-5.5` both read all three samples correctly and both kept the bad scan's wrong totals, so the code's checks caught them. Neither rated the blurred scan as hard to read, so the "hard to read" flag only appears with the saved reading. The arithmetic flags fire either way.

- **The recap runs only after close.** A recap of part of a day compares it with the whole day's plan and misleads, and it would make a paid call every time the numbers changed.

## Simulator
- **State:** every tab derives state from `getSimState(control, data, nowMs)`, with `control` in `localStorage`. There's no server state. All screens must run in one browser on one machine, which is fine for a recorded demo.
- **Order status** comes from the clock: an order is on the queue until 3 minutes after its start time, then cooking until its ready time. There's no "started" button for cooks.
- **The clock starts at 5pm**, with lunch already in the past, so the demo gets straight to the rush.
- **Time:** integer minutes since midnight on one fixed date, Saturday 2026-11-07.

## Forecast
- **Baseline** averages same-weekday days with no tags, because counting home-game days and then multiplying for the game would apply the effect twice.
- **Re-forecast checks every 30 minutes**, not every minute, so "runs out by 8:15" doesn't shift on screen. It always compares with the morning forecast, so scaling never compounds. It ignores windows with under 10 expected orders, where a difference is just small-number noise.
- **Rush timing:** the rush starts at 5:30pm so that the last hour is 35% over at the 6:30pm check. Firing it any time before 6:30pm gives the same story, which may add a few orders retroactively.

## Stock and staffing
- **Supplier order** multiplies today's forecast by the number of days (2), rather than forecasting each day separately.
- **Stockouts don't stop sales in the simulator.** An item that ran out keeps selling, and the stockout is reported.
- **Picking up extra stock** is a Morning button we added so the happy path can resolve the rice warning. It's what connects the morning warning to a clean close.
- **Pausing an item** is only recorded. It doesn't change orders, and the screen says nothing is sent to the apps.
- **Staffing:** one person covers one station per hour. Dev isn't off on the demo Saturday, because Dev is the only wok cook and the kitchen couldn't run; the risk message says there's no backup instead.

## Books
- **Payouts:** fee rates come from the payout reports. Expected payout is worked out from the day's real orders, so it stays right when a rush adds orders. A payout gap removes specific orders from what arrives.
- **Flagged invoices** never change prices.

## Data
- **Fake data** is in `data/fake.ts`, generated with a fixed seed when the module loads. To use a real dataset, change `getData()` in `data/index.ts` and match `RestaurantData` in `lib/types.ts`. It runs in the browser too, so a very large JSON file will slow page load.
- **Sample invoice images** live in `public/invoices/` rather than `data/invoices/`, so the app can serve them.

## Design
- **Look:** warm paper background, basil green accent, Fraunces for headings and Figtree for text, loaded with `next/font`. Fonts download at build time and are then served by the app, so a demo with Wi-Fi off still works once it's built.
- **Navigation:** the day is the map. Every owner page shows the Morning, Service, Close stepper and the clock, and ends with a button to the next step. The kitchen screen has only a link back to Service, because cooks shouldn't see anything else.

## Scope, given under 12 hours
- Photo invoices only, no PDF.
- Ask Spine and cross-training suggestions are skipped.
- The app is light theme only.

## M3: Forecast that measures and improves itself
- Walk-forward backtest over the last 28 days (lib/backtest.ts). Each day uses only earlier days; a test proves cutting history after a day doesn't change that day's forecasts.
- Error metric: mean absolute error in orders per hour (also shown as % of average hourly orders). Mai-friendly: "±1.0 orders an hour".
- Forecast (b) is exactly buildForecast() on earlier days (tested). (c) = same baseline × learned multipliers (day of week, home game, rain), nudged nightly by exponential smoothing at rate 0.2.
- The learner starts from the configured home-game multiplier, not from scratch: starting from ×1 was tried and ended worse (+19% after 4 games). With synthetic data whose patterns don't drift, (c) ≈ (b); the card says so honestly. Learning matters with real data that changes.
- The live forecast is NOT switched to learned multipliers, so the demo story numbers (tests/story.test.ts) stay fixed.
