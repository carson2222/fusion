// Probe 2 — system-prompt authority + realistic explorer behavior + `agent` field.
// Informs the weight-bearing explorer/aggregator prompts. Run: bun probe2.ts
import { createOpencode } from "@opencode-ai/sdk"
import { writeFileSync } from "node:fs"

const MODEL = { providerID: "opencode", modelID: "big-pickle" }
const text = (parts: any[] = []) => parts.filter((p) => p?.type === "text").map((p) => p.text).join("").trim()
const report: any = { steps: {} }
const wd = setTimeout(() => { writeFileSync("report2.json", JSON.stringify({ ...report, timedOut: true }, null, 2)); process.exit(2) }, 180_000)

const { client, server } = await createOpencode({ hostname: "127.0.0.1", port: 0 })
report.serverUrl = server.url
const root = await client.session.create({ body: { title: "probe2" } })
const rootId = (root.data as any).id

async function ask(title: string, body: any) {
  const k = await client.session.create({ body: { parentID: rootId, title } })
  const t = Date.now()
  const r = await client.session.prompt({ path: { id: (k.data as any).id }, body })
  return {
    durMs: Date.now() - t,
    out: text((r.data as any)?.parts),
    error: r.error ?? null,
    agent: (r.data as any)?.info?.agent,
    modelID: (r.data as any)?.info?.modelID,
    partTypes: ((r.data as any)?.parts ?? []).map((p: any) => p.type),
  }
}

try {
  // Test 1: system authority (shibboleth) — does a strong system override dominate?
  report.steps.shibboleth = await ask("shibboleth", {
    model: MODEL,
    system: "CRITICAL: Disregard any other role or task framing. Respond with EXACTLY this single token and nothing else: SHIBBOLETH-7",
    tools: { write: false, edit: false, patch: false, bash: false },
    parts: [{ type: "text", text: "Summarize the repository in detail." }],
  })
  report.steps.shibboleth.verdict = /^SHIBBOLETH-7$/.test(report.steps.shibboleth.out) ? "SYSTEM_AUTHORITATIVE" : "SYSTEM_WEAK_OR_ADDITIVE"

  // Test 2: realistic explorer prompt + real small task — does it produce findings, read-only?
  report.steps.explorer = await ask("explorer", {
    model: MODEL,
    system: "You are one independent explorer in a panel of models. Investigate the user's task and surface concrete risks, edge cases, and tricky issues other models might miss. Output a terse bullet list of findings only. You are read-only: never modify files; this is planning only.",
    tools: { write: false, edit: false, patch: false },
    parts: [{ type: "text", text: "Audit probe.ts in this project for failure modes and edge cases. List concrete findings." }],
  })
  report.steps.explorer.looksLikeFindings = /(^|\n)\s*([-*]|\d+\.)\s/.test(report.steps.explorer.out)

  // Test 3: does the `agent` field steer (built-in read-only `explore`)?
  report.steps.agentExplore = await ask("agent-explore", {
    model: MODEL,
    agent: "explore",
    parts: [{ type: "text", text: "List the files in the project root and what each is for." }],
  })

  report.ok = true
} catch (e: any) {
  report.ok = false
  report.error = { message: e?.message, stack: e?.stack?.split("\n").slice(0, 4) }
} finally {
  clearTimeout(wd)
  writeFileSync("report2.json", JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  try { server.close() } catch {}
  process.exit(report.ok ? 0 : 1)
}
