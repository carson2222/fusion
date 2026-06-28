# AGENTS.md

## Status
V1 built and probe-tested (Bun + TypeScript). `PLAN.md` = design intent; `probes/FINDINGS.md`
= verified SDK call shapes. Deps installed (`@opencode-ai/plugin`, `@opencode-ai/sdk`).

## Layout & tests
- `src/` — the plugin: `index.ts` (tool wiring) · `fusion.ts` (engine: fan-out → aggregate) ·
  `prompts.ts` (explorer + aggregator — the weight-bearing piece) · `config.ts` (panel/synthesizer).
- `command/fusion.md` — optional `/fusion` command.
- `probes/` — capability probes + tests, run against a real server with **free** models:
  `bun probe.ts` / `bun probe2.ts` (SDK capabilities), `bun engine-test.ts` (engine end-to-end),
  `bun plugin-test.ts` (plugin layer); `probes/integration/` is a live `opencode run` load.
- Typecheck: `bunx tsc --noEmit`. No test runner — the probe/test scripts are the suite.

## What this repo is
A single **OpenCode plugin** (TypeScript) called **Fusion**: a `fusion` tool + `/fusion`
command that fans one hard prompt out to a panel of models running in parallel as
**read-only "explorer" child sessions**, then **aggregates** their findings into one plan
using the current session model. Planning only — explorers never write. Full design and
decisions are in `PLAN.md`.

## Governing constraint
Simplicity / 80-20. This project actively resists feature-bloat (no orchestrator, rounds,
budgeting, persistence, or custom UI in V1 — see `PLAN.md` Non-goals). Before adding any
knob or layer, ask "can we delete this?" Default to omitting.

## OpenCode plumbing gotchas (hard-earned — don't code these from memory)
- **Parallel multi-model uses the SDK, not the `task` tool.** Fan out with
  `client.session.create({ parentID })` + `client.session.prompt(...)` in `Promise.all`.
  The built-in `task` tool has no per-call `model` param and does not reliably run
  subagents in parallel — do not build the fan-out on it.
- **Per-explorer call:** `client.session.create({ parentID })` then `client.session.prompt`
  with body `model` ({providerID, modelID}), `tools` (disable `write`/`edit`/`patch` — verified
  to truly remove them), `parts` (the task), optional `system`/`agent`. Each explorer = its own
  child session, blind to the others. Parallelism is real via `Promise.all` (verified ~1.5× for
  3 calls, not 3×).
- **`body.system` is ADDITIVE to the base agent prompt — not a replacement, not authoritative**
  (verified: a strict "reply X only" system was ignored). Put real instructions in `parts`; use
  `system` as a lens only. Default agent when unset = `build` (full tools).
- **Synthesizer default = current session model.** Read it via
  `client.session.messages(id)` → last `role:"assistant"` message's `info.{providerID, modelID}`
  (the tool context does not hand it to you directly).
- **Config lives in the plugin options tuple:** `plugin: [["opencode-fusion", { panel: [...] }]]`.
  You cannot add a top-level `fusion` key to `opencode.json` (unknown root keys are rejected).
  Plugins auto-loaded from `.opencode/plugin/*` get no tuple options — reference by path in
  config if options are needed.
- **Plugins can't draw custom dialogs** (provider/MCP-style pickers are core TUI). Config is
  file-only; don't plan an interactive setup flow.
- **`/fusion` command currently uses prompt wording as a guardrail.** It tells the caller agent to
  return the tool result verbatim and not call `plan_exit`; this prevents plan-mode leakage in common
  runs but is not structural. Prefer a future first-class surface/direct-display path over adding more
  prompt hacks.
- **Explorers run as the full `build` agent — tool-disabling is the ONLY guardrail (prompt can't help).**
  They inherit build's god-mode toolset; weak models especially reach for whatever exists. Verified in
  the wild across runs: explorers called `question` (blocked the whole `Promise.all` on a dialog),
  `plan_exit` (dropped into plan mode + wrote a plan file + blocked on a dialog), and — worst —
  `fusion` ON THEMSELVES (every panelist recursed; deepseek 15×). `READONLY_TOOLS` must block ALL
  built-in ACTION/CONTROL tools: `write/edit/patch/bash` (mutate), `question` (dialog), `task` (subagent),
  `fusion` (self-recursion), `plan_exit` (plan mode), `todowrite` (noise). Keep read + research/MCP/web
  tools enabled (safe + useful, and they're the dynamically-growing set). The dangerous tools are
  OpenCode's FINITE built-ins, so this denylist is tractable — but add new built-in action tools here as
  they appear, or move explorers to a constrained read-only agent.
- **Stay provider-agnostic.** Never special-case a provider; panel entries are opaque strings
  the user already connected via `/connect`.

## Reference
- **Verified SDK call shapes (probed against 1.17.11): `probes/FINDINGS.md`** — copy these, don't reinvent.
- Plugin / custom-tool / SDK docs: https://opencode.ai/docs/plugins · /custom-tools · /sdk
- Canonical OpenCode source for behavior questions: github.com/anomalyco/opencode (mirror: sst/opencode)
