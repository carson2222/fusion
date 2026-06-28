# opencode-fusion

Fan one hard prompt out to a **panel of models running in parallel** as read-only
**explorers**, then **aggregate** their findings into a single, lossless plan using your
current model. Planning only — explorers never touch your files. You (or any agent) execute
the plan afterward.

It's provider-agnostic: the panel is just `provider/model` strings, so it rides whatever you
already connected in OpenCode (subscriptions, local, OpenRouter…) instead of a metered API.

## Why
One model misses things on hard problems (security audits, architecture, subtle bugs). A panel
of independent models, merged without losing any distinct finding, misses far fewer. The merge
preserves minority insights and surfaces disagreement instead of averaging it away.

## Install
```jsonc
// opencode.json
{
  "plugin": [
    ["opencode-fusion", {
      "panel": ["openai/gpt-5", "google/gemini-3-pro", "opencode-go/glm-5.2"]
      // "synthesizer": "anthropic/claude-opus-4-8"   // optional; default = your current model
    }]
  ]
}
```
- **`panel`** (required) — the models that explore, as `provider/model` strings. Length = how
  many explorers run. Connect each via `/connect` the normal way; Fusion just uses the string.
- **`synthesizer`** (optional) — the model that aggregates. Defaults to whatever model you're
  currently driving the session with.

Optional `/fusion` command: copy `command/fusion.md` into `.opencode/command/` (or
`~/.config/opencode/command/`).

## Use
- **Manually:** `/fusion <your hard task>` — read the aggregated plan, then decide: execute,
  ask one model, or re-run.
- **From an agent:** the `fusion` tool is in the registry; an agent can call it when it hits
  something genuinely hard.

The result is the merged plan, with a footer linking each explorer's child session — open one
to read its full raw analysis (the raw audits stay out of your main context).

## Behavior / limits (V1)
- Explorers are **read-only and parallel** (they can't modify your tree; they run blind to each other).
- A failed or hung explorer is **skipped and reported** — the run continues on the rest.
- No rounds, no orchestration, no persistence, no budgeting. On purpose. See `PLAN.md`.
