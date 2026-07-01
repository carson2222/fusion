// Config parsed from the plugin options tuple: [["@carson2222/fusion", { panel, synthesizer? }]].

export type Model = { providerID: string; modelID: string; variant?: string; slug: string }

export type FusionConfig = {
  panel: Model[]
  synthesizer?: Model
}

// Parse "provider/model" or "provider/model#effort". Split the optional effort off the END on
// "#" (never in a model id, so multi-slash ids survive), then provider/model on the FIRST "/".
// The variant is opaque; the server falls back to the model default if it's unknown.
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
  '  "plugin": [["@carson2222/fusion", { "panel": ["openai/gpt-5#high", "google/gemini-3-pro"] }]]'

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
