# AGENTS.md

## What this is
`@carson2222/fusion` — a single OpenCode plugin. A `fusion` tool + `/fusion` command that fans
one hard prompt out to a panel of models running in parallel as read-only explorer child
sessions, then aggregates their findings into one answer with the current session model.
Planning/analysis only — explorers never write.

## Governing constraint
Simplicity / 80-20. Actively resist feature-bloat (no orchestrator, rounds, budgeting,
persistence, custom UI, or per-call knobs). Before adding any knob or layer, ask "can we
delete this?" Default to omitting.

## Hard rules
- **Read-only is enforced by the tool block, not prompts.** Explorers run as `build` and inherit
  its full toolset; the only guardrail is disabling built-in action/control tools per call
  (`READONLY_TOOLS`). See `docs/internals.md`.
- **Provider-agnostic.** Panel entries are opaque `provider/model[#effort]` strings the user
  already connected. Never special-case a provider.
- **Don't code the SDK from memory.** The plumbing has hard-earned gotchas — read
  `docs/internals.md` before touching fan-out, failure handling, or effort variants.

## Layout & tests
- `src/` — `index.ts` (plugin wiring) · `fusion.ts` (engine: fan-out → aggregate) ·
  `prompts.ts` (explorer + aggregator) · `config.ts` (panel/synthesizer parse).
- `command/fusion.md` — the `/fusion` command.
- `probes/` — capability probes + tests, run against a real server with **free** models
  (`bun probes/*.ts`); `probes/integration/` is a live `opencode run` load.
- Typecheck: `bunx tsc --noEmit`. No test runner — the probe scripts are the suite.

## Docs
- `docs/design.md` — what it is, how a run works, invariants, non-goals.
- `docs/internals.md` — verified SDK shapes + gotchas (copy these, don't reinvent).
- OpenCode docs: https://opencode.ai/docs/plugins · /custom-tools · /sdk
- Canonical source: github.com/anomalyco/opencode (mirror: sst/opencode)
