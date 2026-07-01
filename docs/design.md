# Design

Fusion turns one hard prompt into one merged answer by running a panel of models
in parallel as read-only explorers, then aggregating their findings with a single
synthesizer model. Planning/analysis only — you (or an agent) act on the result.

## Shape
- One plugin, one tool (`fusion`), one command (`/fusion`), two prompts (explorer + aggregator).
- Engine (`src/fusion.ts`) is pure over the SDK client — testable, and callable by a future
  orchestrator. Plugin wiring (`src/index.ts`) is thin.

## One run
1. Trigger — `/fusion <prompt>` or an agent calls the `fusion` tool.
2. Read the panel (config) and the current session model (the synthesizer default).
3. Fan out — each panel model runs as an independent explorer child session (read-only,
   blind to the others), all in parallel.
4. Skip failures — an explorer that errors or hangs is dropped and reported; the run continues.
5. Aggregate once — the synthesizer merges all explorer outputs into the final answer.
   Lossless: keep every distinct point, flag disagreement, never summarize.
6. Return — the merged answer plus a footer linking each explorer's child session (raw
   audits stay in those sessions, not in the main context).

If synthesis fails, the raw explorer findings are returned instead (never re-run the panel).

## Config
Plugin options tuple in `opencode.json` (the only home for plugin config — a top-level key is
rejected):
```jsonc
["@carson2222/fusion", {
  "panel": ["openai/gpt-5.5#high", "anthropic/claude-opus-4-8#max", "google/gemini-3-pro"],
  "synthesizer": "anthropic/claude-opus-4-8#max"  // optional; default = current session model
}]
```
- `panel` (required) — `provider/model` strings; list length = explorer count.
- `#effort` (optional suffix) — a reasoning variant the model exposes (`#high`, `#max`, `#xhigh`…).
- `synthesizer` (optional) — aggregator model; defaults to the current session model.

## Invariants
- Provider-agnostic: panel members are opaque `provider/model` strings.
- Explorers are blind + parallel (that's where the diversity comes from) + read-only.
- Synthesizer = current session model (unless overridden).
- Aggregate, never summarize.

## Non-goals
No orchestrator, rounds, voting, persistence, budgeting, custom UI, or per-call knobs.
Added only when a concrete need shows up.
