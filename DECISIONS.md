# Decisions

Running log of choices and assumptions. Add a line whenever CLAUDE.md doesn't cover something.

- **LLM role:** code computes every number and every past pattern; the LLM only explains and advises. We read section 6's "make their predictions" as advice based on the JSON, not new numbers. Any number in LLM text that isn't in the input JSON triggers the templated fallback.
- **"Previous learnings":** `lib/learnings.ts` computes patterns from the 8 weeks of history in code, and they go into the recap JSON.
- **Simulator state:** every tab derives state from `getSimState(control, data, nowMs)`, with `control` in `localStorage`. There's no server state. All screens must run in one browser on one machine, which is fine for a recorded demo.
- **Data:** a fixed-seed script writes committed JSON to `data/generated/`. No SQLite.
- **Time:** integer minutes since midnight on one fixed date, Saturday 2026-11-07.
- **LLM provider:** assumed OpenAI, based on the key in `.env.local`. Called with `fetch`, so there's no SDK. Model comes from `LLM_MODEL`.
- **Scope, given under 12 hours:** photo invoices only, no PDF. Ask Spine and cross-training suggestions are skipped.
