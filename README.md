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
| `/service` | Mai: the agent's plan, alerts, plan against real orders, action log |
| `/service/kitchen` | Cooks: FIRE NOW, UP NEXT, HOLD |
| `/close` | Mai: the day's money, What Spine changed today, Explain my day, invoice scanning |
| `/demo` | The presenter: clock, sad paths, reset. Not in the stepper. There is a small link at the bottom of the home page |

## Run the demo

Open `/demo` in one tab and the screen you're showing in another. They stay in sync, as long as they're in the same browser. Press **Reset** between runs.

- **Happy path:** on `/morning`, approve the agent's rice order. Press "Start service", and set a speed on `/demo`. Watch `/service/kitchen`, then go to `/close`.
- **Rush:** press "Rush beats forecast" before 6:30pm. At 6:30pm, `/service` shows the agent's plan. Approve the steps and watch the run-out and staffing change.
- **Driver delay:** press the delay button during service and watch the order move on the kitchen screen. The agent also suggests what to do with the freed slot.
- **Invoices and payout gap:** use the buttons on `/demo`, then approve the agent's plan on `/close`.
- **AI guardrail:** press "Feed the agent a bad suggestion" before a plan appears, and watch Spine reject it.
- **What Spine changed:** at close, `/close` compares the day with the same day replayed without Spine.

## Use your own data

The fake data is in `data/fake.ts`. To replace it, change `getData()` in `data/index.ts` to return your dataset in the shape of `RestaurantData` in `lib/types.ts`. Nothing else reads the data directly. `tests/story.test.ts` checks the demo's story numbers against the fake data, so expect those tests to need re-tuning.

## AI

Set `OPENROUTER_API_KEY` and `LLM_MODEL` in `.env.local`. With `DEMO_OFFLINE=true`, or with no key or model, the app never calls the network and uses saved answers and templates. `/demo` shows which mode it's in.

To record for an offline demo, run each scenario once online. Good answers are saved to `data/llm-cache/`.

The invoice images come from `node scripts/make-invoices.mjs`.
