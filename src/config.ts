// Fusion config — parsed from the plugin options tuple:
//   "plugin": [["opencode-fusion", { panel: [...], synthesizer?: "..." }]]
// Kept deliberately tiny (PLAN.md: panel required, synthesizer optional).

export type Model = { providerID: string; modelID: string; variant?: string; slug: string }

export type FusionConfig = {
  panel: Model[]
  synthesizer?: Model
}

// Parse a panel entry of the form "provider/model" or "provider/model#effort".
// The optional "#effort" suffix names a per-model reasoning VARIANT (effort level) the
// model exposes — e.g. "anthropic/claude-opus-4-8#max", "openai/gpt-5.5#xhigh". We split
// the effort off the END on "#" (which never appears in a model id, so multi-slash model
// ids like "openrouter/anthropic/claude-x" stay intact), then split provider/model on the
// FIRST slash. The variant string is passed through opaquely; the server validates it and
// falls back to the model's default if it's unknown (so a typo degrades, never crashes).
// `slug` keeps the full original (incl. "#effort") so the footer shows the effort in use.
export function parseModelSlug(raw: string): Model {
  const hash = raw.lastIndexOf("#")
  const variant = hash > -1 ? raw.slice(hash + 1).trim() || undefined : undefined
  const id = hash > -1 ? raw.slice(0, hash) : raw
  const i = id.indexOf("/")
  if (i <= 0 || i === id.length - 1) {
    throw new Error(`Fusion: invalid model "${raw}" — expected "provider/model" or "provider/model#effort".`)
  }
  return { providerID: id.slice(0, i), modelID: id.slice(i + 1), variant, slug: raw }
}

const CONFIG_HINT =
  'Fusion: set a "panel" in the plugin options, e.g.\n' +
  '  "plugin": [["opencode-fusion", { "panel": ["openai/gpt-5#high", "google/gemini-3-pro"] }]]'

export function parseConfig(options: Record<string, unknown> | undefined): FusionConfig {
  const panelRaw = options?.panel
  if (!Array.isArray(panelRaw) || panelRaw.length === 0 || !panelRaw.every((x) => typeof x === "string")) {
    throw new Error(CONFIG_HINT)
  }
  const panel = (panelRaw as string[]).map(parseModelSlug)

  const synthRaw = options?.synthesizer
  if (synthRaw !== undefined && typeof synthRaw !== "string") {
    throw new Error('Fusion: "synthesizer" must be a "provider/model" string if set.')
  }
  const synthesizer = typeof synthRaw === "string" ? parseModelSlug(synthRaw) : undefined

  return { panel, synthesizer }
}
