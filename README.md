# Spine

One forecast runs the whole restaurant day. Hackathon prototype with synthetic data. Read `CLAUDE.md` first, and `DECISIONS.md` for the choices made since.

## Run

```
npm install
cp .env.example .env.local   # skip if you already have one; never commit it
npm run dev                  # http://localhost:3000
npm test
npm run typecheck
```

## Screens

| URL | Who it's for |
|---|---|
| `/morning` | Mai: forecast, warnings, prep list, supplier order, staffing |
| `/service` | Mai: live status, alerts, plan against real orders |
| `/service/kitchen` | Cooks: FIRE NOW, UP NEXT, HOLD |
| `/close` | Mai: the day's money, Explain my day, invoice scanning |
| `/demo` | The presenter: clock, sad paths, reset. Not in the stepper. There is a small link at the bottom of the home page |

## Run the demo

Open `/demo` in one tab and the screen you're showing in another. They stay in sync, as long as they're in the same browser.

- **Happy path:** on `/morning`, press "I'll pick up 50 lb today" for the rice warning. Press "Start service" at the bottom of the page. On `/demo`, set a speed. Watch `/service/kitchen`, then `/close`.
- **Rush:** press "Rush beats forecast" before 6:30pm. At 6:30pm, `/service` warns about noodles, Pad Thai and packing.
- **Driver delay:** press the delay button during service and watch the order on the kitchen screen.
- **Invoices:** use the buttons on `/demo` or `/close`.
- **Payout gap:** press it on `/demo`, and see `/close`.
- Press **Reset** between runs.

## Use your own data

The fake data is in `data/fake.ts`. To replace it, change `getData()` in `data/index.ts` to return your dataset in the shape of `RestaurantData` in `lib/types.ts`. Nothing else reads the data directly. `tests/story.test.ts` checks the demo's story numbers against the fake data, so expect those tests to need re-tuning.

## AI

Set `OPENROUTER_API_KEY` and `LLM_MODEL` in `.env.local`. With `DEMO_OFFLINE=true`, or with no key or model, the app never calls the network and uses saved answers and templates. `/demo` shows which mode it's in.

To record for an offline demo, run each scenario once online. Good answers are saved to `data/llm-cache/`.

The invoice images come from `node scripts/make-invoices.mjs`.
