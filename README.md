# Spine

One forecast runs the whole restaurant day.

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

- **Happy path:** on `/morning`, approve the agent's rice order. Press "Start service", and set a speed on `/demo`. Watch `/service/kitchen`, then go to `/close`.
- **Rush:** press "Rush beats forecast" before 6:30pm. At 6:30pm, `/service` shows the agent's plan. Approve the steps and watch the run-out and staffing change.
- **Driver delay:** press the delay button during service and watch the order move on the kitchen screen. The agent also suggests what to do with the freed slot.
- **Invoices and payout gap:** use the buttons on `/demo`, then approve the agent's plan on `/close`.
- **AI guardrail:** press "Feed the agent a bad suggestion" before a plan appears, and watch Spine reject it.
- **What Spine changed:** at close, `/close` compares the day with the same day replayed without Spine.
