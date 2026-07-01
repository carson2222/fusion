// Deterministic end-to-end test of the Fusion engine (no plugin/model-in-the-loop).
// Boots a real runtime, runs runFusion() with a 2-model free panel on a real task.
// Run: bun engine-test.ts
import { createOpencode } from "@opencode-ai/sdk"
import { runFusion } from "../src/fusion"
import { writeFileSync } from "node:fs"

const { client, server } = await createOpencode({ hostname: "127.0.0.1", port: 0 })
const out: any = { serverUrl: server.url }
try {
  const root = await client.session.create({ body: { title: "fusion-engine-test" } })
  const sessionID = (root.data as any).id

  const t = Date.now()
  const result = await runFusion({
    client,
    sessionID,
    task:
      "Audit probe.ts in this directory for failure modes and edge cases. " +
      "Give a concrete, prioritized list of the most important issues and how to fix each.",
    options: {
      panel: ["opencode/big-pickle", "opencode/north-mini-code-free"],
      synthesizer: "opencode/big-pickle",
    },
  })
  out.durMs = Date.now() - t
  out.synthesizer = result.synthesizer
  out.explorers = result.explorers.map((e) => ({
    slug: e.slug,
    ok: e.ok,
    sessionId: e.sessionId,
    error: e.error,
    outLen: e.output?.length,
  }))
  out.synthOk = result.synthOk
  out.synthError = result.synthError
  out.planLen = result.plan?.length ?? 0
  out.planHead = result.plan?.slice(0, 1800)
  out.ok = true
} catch (e: any) {
  out.ok = false
  out.error = e?.message
  out.stack = e?.stack?.split("\n").slice(0, 6)
} finally {
  writeFileSync("engine-report.json", JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
  try { server.close() } catch {}
  process.exit(out.ok ? 0 : 1)
}
