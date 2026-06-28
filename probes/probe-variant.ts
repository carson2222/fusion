// Probe: does the (v1) prompt route accept a per-call `variant` (effort level), and what
// variant ids does each panel model actually expose? Gates the `#effort` suffix feature.
// Run: bun probes/probe-variant.ts   (writes report-variant.json + prints it)
//
// - Catalog read uses the v2 client (v1 catalog omits `variants`); $0, read-only.
// - Route-acceptance gate prompts a FREE model only; $0.
import { createOpencode } from "@opencode-ai/sdk"
import { createOpencodeClient as createV2 } from "@opencode-ai/sdk/v2"
import { writeFileSync } from "node:fs"

// Free models for the $0 acceptance gate (independent of the paid panel).
const FREE_CANDIDATES = [
  "opencode/deepseek-v4-flash-free",
  "opencode/mimo-v2.5-free",
  "opencode/grok-4.3-mini-free",
  "opencode/big-pickle",
]

// The user's real panel — we want each model's available effort variants.
const PANEL_SLUGS = [
  "opencode-go/glm-5.2",
  "opencode-go/kimi-k2.7-code",
  "opencode-go/deepseek-v4-pro",
  "opencode-go/qwen3.7-plus",
  "opencode-go/mimo-v2.5-pro",
  "anthropic/claude-opus-4-8",
  "openai/gpt-5.5",
  "xai/grok-4.3",
]

// Effort ordering for picking a sensible "max" from opaque variant ids.
const EFFORT_ORDER = ["minimal", "none", "low", "medium", "high", "max", "xhigh", "ultra", "extreme"]
function pickMax(ids: string[] | undefined): string | undefined {
  const real = (ids ?? []).filter((x) => x.toLowerCase() !== "default")
  if (!real.length) return undefined
  const ranked = real.filter((x) => EFFORT_ORDER.includes(x.toLowerCase()))
  if (ranked.length)
    return ranked.sort((a, b) => EFFORT_ORDER.indexOf(a.toLowerCase()) - EFFORT_ORDER.indexOf(b.toLowerCase())).at(-1)
  return real.at(-1)
}

const text = (parts: any[] = []) => parts.filter((p) => p?.type === "text").map((p) => p.text).join("").trim()
const report: any = { startedAt: new Date().toISOString(), steps: {} }

const wd = setTimeout(() => {
  report.timedOut = true
  try { writeFileSync("report-variant.json", JSON.stringify(report, null, 2)) } catch {}
  console.error("WATCHDOG TIMEOUT")
  process.exit(2)
}, 180_000)

const { client, server } = await createOpencode({ hostname: "127.0.0.1", port: 0 })
report.serverUrl = server.url
console.log("server up ->", server.url)

try {
  // 1) Catalog: read every connected model's variant ids (v2 surface).
  const catalog: Record<string, string[]> = {}
  try {
    const v2: any = createV2({ baseUrl: server.url })
    const provs: any = await v2.config.providers()
    report.steps.catalog = { providersResponseKeys: Object.keys(provs?.data ?? {}) }
    const providerList: any[] = provs?.data?.providers ?? provs?.data ?? []
    for (const p of providerList) {
      for (const [modelID, m] of Object.entries<any>(p?.models ?? {})) {
        const ids = Object.keys(m?.variants ?? {})
        if (ids.length) catalog[`${p.id}/${modelID}`] = ids
      }
    }
    report.steps.catalog.modelsWithVariants = catalog
    report.steps.catalog.providerCount = providerList.length
  } catch (e: any) {
    report.steps.catalog = { error: e?.message ?? String(e) }
  }

  // What we actually care about: the panel + a suggested "max" for each.
  report.panel = PANEL_SLUGS.map((slug) => {
    const variants = catalog[slug]
    return {
      slug,
      variants: variants ?? null, // null = model not found OR no variants exposed
      suggestedMax: pickMax(variants),
    }
  })

  // 2) Route-acceptance gate: send `variant` to a FREE model; confirm no 400 and that the
  //    server stored it on the user message's model. (Proves the v1 route carries variant.)
  const root = await client.session.create({ body: { title: "variant-probe-root" } })
  const rootId = (root.data as any).id
  let gateDone = false
  for (const slug of FREE_CANDIDATES) {
    const [providerID, ...rest] = slug.split("/")
    const modelID = rest.join("/")
    const k = await client.session.create({ body: { parentID: rootId, title: "gate-" + slug } })
    const id = (k.data as any)?.id
    if (!id) continue
    const r: any = await client.session
      .prompt({
        path: { id },
        body: {
          model: { providerID, modelID },
          variant: "high", // <-- the field under test (v1 type omits it; server should accept)
          tools: { write: false, edit: false, patch: false, bash: false },
          parts: [{ type: "text", text: "Reply with exactly: OK" }],
        } as any,
      })
      .catch((e: any) => ({ error: e?.message ?? String(e), data: null }))

    // Read back the stored user message to see if `variant` survived round-trip.
    let storedVariant: any = "unknown"
    try {
      const msgs: any = await client.session.messages({ path: { id } })
      const user = ((msgs.data as any[]) ?? []).find((m) => m?.info?.role === "user")
      storedVariant = user?.info?.model?.variant ?? null
    } catch (e: any) {
      storedVariant = `read-failed: ${e?.message ?? e}`
    }

    const out = text((r?.data as any)?.parts)
    const infoError = (r?.data as any)?.info?.error ?? null
    report.steps.gate = {
      slug,
      routeError: r?.error ?? null, // expect null (no 400) = route accepts `variant`
      infoError, // expect null = passing variant didn't break the provider call
      storedVariant, // expect "high" = server parsed + persisted it
      producedText: !!out,
      out: out.slice(0, 120),
    }
    gateDone = true
    if (!r?.error && out) break // got a clean pass; stop spending
  }
  if (!gateDone) report.steps.gate = { error: "no free candidate responded" }

  report.verdict = {
    routeAcceptsVariant: report.steps.gate?.routeError == null && report.steps.gate?.storedVariant === "high",
    catalogReadable: !!report.steps.catalog?.modelsWithVariants,
  }
  report.ok = true
} catch (e: any) {
  report.ok = false
  report.error = { message: e?.message, stack: e?.stack?.split("\n").slice(0, 5) }
} finally {
  clearTimeout(wd)
  writeFileSync("report-variant.json", JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  try { server.close() } catch {}
  process.exit(report.ok ? 0 : 1)
}
