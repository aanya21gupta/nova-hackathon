# Spine

One forecast runs the whole restaurant day. Hackathon prototype with synthetic data. Read `CLAUDE.md` first.

## Run

```
npm install
cp .env.example .env.local   # skip if you already have one; never commit it
npm run dev                  # http://localhost:3000
npm test
npm run typecheck
```

## Who owns what

Stay in your track's files to avoid merge conflicts. `lib/types.ts` is the only shared file: keep changes small and tell the others. Use a branch per track and merge to `main` often.

| Track | Lib | Data | Screens |
|---|---|---|---|
| **A: Plan** | `forecast` `prep` `ordering` `staffing` `alerts` | `data/seed.ts`, `data/generated/`, `data/index.ts` | `/morning` |
| **B: Service** | `simulator` `queue` `useSim` | (give rush and delay events to A) | `/service`, `/service/kitchen` |
| **C: Close + AI** | `books` `invoice` `learnings` `llm` | `data/invoices/`, `data/llm-cache/` | `/close`, `/demo`, `/api/*` |

Each `lib` file has the agreed function signatures and throws "Not implemented" until its track fills it in. Until the real seed lands, build against `data/fixtures.ts` through `getData()`.

## Checkpoint

At hour 4, merge everything and switch to real seed data. The happy path must run end to end before anyone starts on sad paths.
