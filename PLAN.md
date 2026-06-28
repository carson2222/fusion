# Fusion — V1 Plan

## TL;DR
A small OpenCode plugin. You give it one hard prompt; it fans that prompt out to a
panel of models running **in parallel as independent read-only explorers**, then
**aggregates** everything into one lossless plan using your **current** model.
Planning only — you (or any agent) execute afterward. Provider-agnostic,
config-file simple, no orchestration.

## Goal
Turn a single hard prompt into one comprehensive plan/audit that contains *every*
model's findings — so nothing tricky gets missed — without bloating your main
session or locking you to metered API pricing (it rides whatever you already
connected in OpenCode).

## How it works (one run)
1. **Trigger** — `/fusion <prompt>` (manual) or an agent calls the `fusion` tool.
2. **Read** the panel from config (list of `provider/model` strings) + the current
   session model (used for aggregation).
3. **Fan out** — each panel model spawns as an independent **explorer** child
   session (full investigation: read / search / lsp; **writes disabled**), all in
   parallel, blind to each other.
4. **Skip failures** — a member errors → dropped and noted in the result.
5. **Aggregate** — one internal call with your current model merges all explorer
   outputs into the final plan. Lossless: keep every finding, flag disagreement,
   never summarize. Output = whatever the prompt asked for.
6. **Return** — the plan, with explorer child-session ids linked underneath (raw
   audits stay preserved by OpenCode, *not* dumped into your context).

## What it is
- **One plugin.**
- **One tool:** `fusion` (arg: `prompt`; optional: panel / return overrides).
- **One command:** `/fusion` (thin wrapper over the tool).
- **Two prompts:** explorer (investigate, surface the weird stuff, no writes) +
  aggregator (the lossless merge — the one piece that carries the weight).

## Config & flags (V1)
**Channel:** the plugin **options tuple** in `opencode.json`. That's the only native
home for arbitrary plugin config — a top-level `fusion` key is rejected (OpenCode
hard-rejects unknown root keys).

```jsonc
"plugin": [
  ["opencode-fusion", {
    "panel": ["openai/gpt-5", "google/gemini-3-pro", "opencode/glm-4.7"]
    // "synthesizer": "anthropic/claude-opus-4"   // optional; default = current session model
  }]
]
```

- **`panel`** — *required.* Model strings that run as explorers. List length = explorer
  count (no separate count knob). May repeat a model for self-consistency.
- **`synthesizer`** — *optional.* Aggregator model. Default = current session model.

**Per-call flag:** just the **prompt** (`/fusion <prompt>` or `fusion({ prompt })`). The
output shape (audit/plan/answer) is written *in* the prompt — no `return` flag.

**Internal defaults (not knobs):** explorers read-only + blind + parallel; a hung explorer
is dropped after an internal timeout (~5 min), an errored one is skipped — both reported.

**Cut on purpose (80/20):** parallelism caps · token/cost tracking · retries · per-call
panel/synth overrides · return-format option · explorer prompt/tool customization ·
agent-name members. Add only when a concrete need shows up.

## What we build (devs)
- Plugin scaffold (TS) that reads config (plugin options or a `.fusion` file).
- Fan-out via `client.session.create` + `client.session.prompt` in `Promise.all`,
  each with: panel `model`, explorer `system` prompt, `tools` write-disabled.
- Current-model read (off the calling message, same way the built-in `task` tool does).
- Internal aggregation call + the return shape (plan + explorer session refs).
- The two prompts.

## What users do
- Enable the plugin (config entry, or drop the file in `.opencode/plugin/`).
- Set `panel` = a list of model strings, once. (Connecting those models in OpenCode
  is the normal `/connect` flow — the tool doesn't care how; it just uses the string.)
- Run `/fusion <hard task>`. Read the plan. Decide next: execute / ask one model /
  re-fuse.

## Build order
- **Phase 1 — Engine.** Plugin + `fusion` tool: config read, current-model read,
  parallel fan-out to explorer child sessions, skip-on-fail, internal aggregate,
  return plan + session refs. *This is the MVP.*
- **Phase 2 — Surface + prompts.** `/fusion` command; tune explorer + aggregator
  prompts; optional one-line `AGENTS.md`/skill hint so agents self-serve on hard
  subproblems.
- **Phase 3 — Knobs.** Optional flags (override synthesizer model, per-call panel,
  return format); failure summary in the output header.

## Non-goals (V1)
- No orchestrator (separate thing, later — core is written so it can call this).
- No persistent / iterative workspace (later).
- No multi-round debate or voting.
- No budgeting / token / cost tracking.
- No custom UI/dialogs — config file only (plugins can't draw dialogs anyway).
- Explorers never write to your tree.

## Known Issues / Future Work
- `/fusion` currently relies on command wording to stop the caller agent from treating the aggregated
  answer as an OpenCode plan artifact and triggering `plan_exit`. This is a prompt-level workaround,
  not a structural fix. Future direction: expose Fusion through a surface that returns/display tool
  output directly or uses first-class subagent/task UI semantics instead of asking the active agent to
  relay the result.

## Invariants
- **Provider-agnostic:** panel members are opaque `provider/model` strings.
- **Blind + parallel** explorers (that's where the diversity comes from).
- **Synthesizer = current session model** (you now; an orchestrator later — same rule).
- **Aggregate, never summarize.**
