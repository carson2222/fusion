# Probe findings — verified OpenCode SDK patterns for Fusion

Harness: `bun probe.ts` / `bun probe2.ts` (standalone, `@opencode-ai/sdk@1.17.11`,
`createOpencode()` boots the real runtime with your auth/models). Free models used, $0.

## Results
| Risk | Verdict |
|---|---|
| R0 connect client→server | PASS (`createOpencode()` → `{ client, server }`) |
| R1 child session + prompt returns text | PASS |
| R2 `Promise.all` parallel | PASS — 3 calls in 28.7s vs 18.6s single (1.54×, not 3×) |
| R3 `tools:{write,edit,patch:false}` | PASS — asked to write a file → no file, no tool-call parts |
| R4 read current model | PASS — `session.messages` → last assistant `info.{providerID,modelID}` |
| R5 `system` override authority | WEAK — additive, not authoritative (see below) |

## Exact call shapes (copy these — do not refactor signatures)
```ts
// create child session
const s = await client.session.create({ body: { parentID, title } })
const id = s.data.id

// one explorer turn (per-call model + read-only + lens)
const r = await client.session.prompt({
  path: { id },
  body: {
    model: { providerID, modelID },            // opaque panel string, split on first "/"
    tools: { write: false, edit: false, patch: false }, // (+ bash:false for pure-read)
    system: "<explorer lens — additive only>",
    parts: [{ type: "text", text: "<the task>" }],
  },
})
const out = (r.data.parts ?? []).filter(p => p.type === "text").map(p => p.text).join("")
// r.data.info.{providerID,modelID,agent,cost,tokens,finish} also available

// read current/session model (synthesizer default)
const m = await client.session.messages({ path: { id } })
const lastAssistant = [...m.data].reverse().find(x => x.info?.role === "assistant")
// lastAssistant.info.providerID / .modelID
```

## Behavioral facts (these shaped the design)
- **`body.system` is ADDITIVE to the base agent prompt and not authoritative.** A strict
  "reply X only" system was ignored in favor of base agent + task. Put real instructions in
  `parts`; treat `system` as a lens. Don't expect it to override base behavior.
- **`agent` is honored per call** (`agent:"explore"` → `info.agent==="explore"`). Persona +
  permissions steerable. Default when unset = `build` (full tools).
- **`tools` map removes tools** (verified: no write happened, no tool-call parts emitted).
- **Parallel is genuine** via `Promise.all` of `session.prompt` — children have independent
  run-locks; no cross-session blocking.
- **Response is blocking** and returns `{ info: AssistantMessage, parts: Part[] }`; text =
  `parts` where `type==="text"`. Part stream also includes `step-start/reasoning/step-finish`.
- **Explorers auto-get repo/environment context** (saw `AGENTS.md`/`PLAN.md`) — good, they can
  investigate the real codebase without us wiring anything.

## Open decision (explorer tools)
- **Pure-read (recommended V1):** `tools:{ write,edit,patch,bash: false }` → read/grep/glob/
  list/webfetch/lsp only. Parallel-safe (no tree mutation possible), simple. Proven to yield
  strong audits.
- **Full-minus-writes:** keep `bash` on for running tests/commands during investigation — more
  power, but bash can mutate the shared cwd and parallel bash isn't isolated. Later opt-in knob.

## Not yet probed (fold into Phase 1)
- Injected `client` inside a real plugin tool + reentrancy (calling `session.prompt` from
  within a tool while the parent turn holds its run-lock). Source says child run-locks are
  independent → expected fine; the first Phase-1 tool run is the real test.
