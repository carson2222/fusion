# Internals

Verified OpenCode SDK behavior Fusion relies on. Probed against `@opencode-ai/sdk` 1.17.11.
Copy these shapes; don't reinvent them.

## Runtime
- The plugin loads TS source directly (no build step). After editing plugin/config, fully
  quit and restart OpenCode — config is read once at startup.
- Plugins have zero runtime deps: the host OpenCode provides `@opencode-ai/plugin` and
  `@opencode-ai/sdk` (dev-only here, for types).

## Fan-out (SDK, not the `task` tool)
The built-in `task` tool has no per-call `model` and doesn't reliably parallelize. Fan out with
the SDK instead:
```ts
const s = await client.session.create({ body: { parentID, title } })
const r = await client.session.prompt({
  path: { id: s.data.id },
  body: {
    model: { providerID, modelID },
    variant,                       // optional effort level (see below)
    system: "<explorer lens>",     // additive only — NOT authoritative
    tools: { write: false, ... },  // removes tools (verified)
    parts: [{ type: "text", text: "<task>" }],
  },
})
const out = (r.data.parts ?? []).filter(p => p.type === "text").map(p => p.text).join("")
```
- Parallelism is genuine via `Promise.all` (~1.5× for 3 calls, not 3× — independent run-locks).
- `body.system` is **additive to the base agent prompt, not authoritative** (a strict "reply X
  only" system was ignored). Put real instructions in `parts`; use `system` as a lens.

## Read-only guarantee = the tool block (prompt can't help)
Explorers run as the full `build` agent and inherit its toolset; weak models reach for whatever
exists. The ONLY guardrail is disabling tools per call. Observed in the wild: explorers called
`question` (blocked the whole panel on a dialog), `plan_exit` (dropped into plan mode + wrote a
file + blocked), and `fusion` on themselves (every panelist recursed). Block the FINITE set of
built-in action/control tools, keep read/research/MCP/web:
```
write, edit, patch, bash   mutate the worktree
question                   dialog — blocks the panel, masquerades as a result
task                       nested subagents
fusion                     self-recursion
plan_exit                  plan mode + dialog
todowrite                  noise
```
Add new built-in action tools here as they appear.

## Failure & recovery
- A failed model call returns **200 with the error on `r.data.info.error`** (not `r.error`) and
  empty `parts`. Check both.
- A client abort/timeout does **not** stop the server: it keeps generating and persists the
  finished assistant message. So on a synth timeout, poll the synth session for its completed
  message (`recoverSynthPlan`) instead of discarding the fan-out. Bail only on a hard model
  error (never completes) or a user cancel.
- If synthesis genuinely fails, return the raw explorer findings — never silently drop them and
  never re-run the panel (the expensive work already exists).
- A raw `Error`/`DOMException` `JSON.stringify`s to `"{}"` (non-enumerable props). Extract the
  message (`err.data?.message ?? err.message ?? err.name`) or failures read as opaque `{}`.
- Timeouts are generous backstops, not the primary control (explorers 15m, synth 30m).

## Effort variants (`#effort`)
- The prompt route accepts and persists a per-call `variant` (verified: no 400, round-trips onto
  the user message's `model.variant`). Unknown values fall back to the model default server-side,
  so a typo degrades, never crashes.
- Discover a model's variant ids via the **v2** catalog: `client.config.providers()` →
  `provider.models[id].variants` (a record keyed by id, e.g. `low/medium/high/xhigh/max`). The v1
  catalog omits variants.
- `#` is the panel-entry separator because it never appears in a model id — so `#effort` splits
  cleanly off the end even for multi-slash ids (`openrouter/anthropic/claude-x#high`).

## Synthesizer default
Current session model = the last assistant message's `info.{providerID, modelID}`
(`client.session.messages` → last `role:"assistant"`). Fall back to the first panel member.

## Misc
- Config lives in the plugin options tuple; a top-level `fusion` key in `opencode.json` is
  rejected (unknown root keys hard-fail).
- Plugins can't draw dialogs (pickers are core TUI) — config is file-only.
- Footer: wrap session ids/slugs in backticks. Ids contain underscores, which the markdown
  renderer otherwise eats as italics.
