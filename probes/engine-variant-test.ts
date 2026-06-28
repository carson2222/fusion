// E2E: runFusion() with a `#effort` panel (free models that expose variants), then read
// back each explorer's child session to confirm the effort variant actually propagated.
// Run: bun probes/engine-variant-test.ts
import { createOpencode } from "@opencode-ai/sdk"
import { runFusion } from "../src/fusion"
import { writeFileSync } from "node:fs"

const { client, server } = await createOpencode({ hostname: "127.0.0.1", port: 0 })
const out: any = { serverUrl: server.url }
try {
  const root = await client.session.create({ body: { title: "fusion-variant-test" } })
  const sessionID = (root.data as any).id

  const result = await runFusion({
    client,
    sessionID,
    task: "In one or two sentences: what is the single biggest risk in a parallel fan-out of LLM calls?",
    options: {
      // free models that expose effort variants per the catalog probe
      panel: ["opencode/deepseek-v4-flash-free#max", "opencode/mimo-v2.5-free#high"],
      synthesizer: "opencode/deepseek-v4-flash-free#max",
    },
  })

  out.synthesizer = result.synthesizer
  out.planLen = result.plan.length
  out.explorers = []
  for (const e of result.explorers) {
    let storedVariant: any = null
    if (e.sessionId) {
      const msgs: any = await client.session.messages({ path: { id: e.sessionId } }).catch(() => null)
      const user = ((msgs?.data as any[]) ?? []).find((m) => m?.info?.role === "user")
      storedVariant = user?.info?.model?.variant ?? null
    }
    out.explorers.push({ slug: e.slug, ok: e.ok, storedVariant, error: e.error, outLen: e.output?.length })
  }
  // expectation: deepseek explorer stored "max", mimo stored "high"
  out.variantPropagated = out.explorers.every((x: any) => !x.ok || x.storedVariant)
  out.ok = true
} catch (e: any) {
  out.ok = false
  out.error = e?.message
  out.stack = e?.stack?.split("\n").slice(0, 6)
} finally {
  writeFileSync("engine-variant-report.json", JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
  try { server.close() } catch {}
  process.exit(out.ok ? 0 : 1)
}
