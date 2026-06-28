// Fusion capability probe — proves the OpenCode SDK calls Fusion depends on.
// Run: bun probe.ts   (writes report.json + prints it)
import { createOpencode } from "@opencode-ai/sdk"
import { writeFileSync, existsSync, rmSync } from "node:fs"

const CANDIDATE_MODELS = [
  "opencode/big-pickle",
  "opencode/north-mini-code-free",
  "opencode/deepseek-v4-flash-free",
  "opencode/mimo-v2.5-free",
  "opencode/nemotron-3-ultra-free",
]

const report: any = { startedAt: new Date().toISOString(), steps: {} }
const text = (parts: any[] = []) => parts.filter((p) => p?.type === "text").map((p) => p.text).join("").trim()

// watchdog: never hang forever
const wd = setTimeout(() => {
  report.timedOut = true
  try { writeFileSync("report.json", JSON.stringify(report, null, 2)) } catch {}
  console.error("WATCHDOG TIMEOUT")
  process.exit(2)
}, 180_000)

const { client, server } = await createOpencode({ hostname: "127.0.0.1", port: 0 })
report.serverUrl = server.url
console.log("R0: server up ->", server.url)

try {
  // R1: root + child session
  const root = await client.session.create({ body: { title: "probe-root" } })
  if (root.error) throw new Error("session.create root failed: " + JSON.stringify(root.error))
  const rootId = (root.data as any).id
  const child = await client.session.create({ body: { parentID: rootId, title: "probe-child" } })
  report.steps.create = { ok: !child.error, rootId, childId: (child.data as any)?.id, childKeys: Object.keys(child.data ?? {}) }
  if (child.error) throw new Error("child create failed: " + JSON.stringify(child.error))

  // R1/R5/R3: pick a free model by actually prompting with model+system+tools override
  let CHOSEN: any = null
  const tries: any[] = []
  for (const slug of CANDIDATE_MODELS) {
    const [providerID, ...rest] = slug.split("/")
    const modelID = rest.join("/")
    const k = await client.session.create({ body: { parentID: rootId, title: "pick-" + slug } })
    const t0 = Date.now()
    const r = await client.session.prompt({
      path: { id: (k.data as any).id },
      body: {
        model: { providerID, modelID },
        system: "You are PROBE-A. Reply with EXACTLY two words: OK PROBE-A",
        tools: { write: false, edit: false, patch: false, bash: false },
        parts: [{ type: "text", text: "go" }],
      },
    })
    const durMs = Date.now() - t0
    const out = text((r.data as any)?.parts)
    tries.push({ slug, ok: !r.error && !!out, durMs, out, error: r.error ?? null })
    if (!r.error && out) {
      CHOSEN = { providerID, modelID, slug, sessionId: (k.data as any).id }
      report.steps.promptOverride = {
        ok: true, slug, durMs, out,
        systemHonored: /PROBE-A/i.test(out),
        modelEcho: { providerID: (r.data as any)?.info?.providerID, modelID: (r.data as any)?.info?.modelID },
        infoKeys: Object.keys((r.data as any)?.info ?? {}),
        partTypes: ((r.data as any)?.parts ?? []).map((p: any) => p.type),
      }
      break
    }
  }
  report.steps.modelPickTries = tries
  if (!CHOSEN) throw new Error("no candidate free model produced text")

  // R4: read "current model" the way the plugin will (off session messages -> last assistant info)
  const msgs = await client.session.messages({ path: { id: CHOSEN.sessionId } })
  const list = (msgs.data as any[]) ?? []
  const lastAssistant = [...list].reverse().find((m) => m?.info?.role === "assistant")
  report.steps.currentModelRead = {
    ok: !!lastAssistant?.info?.modelID,
    providerID: lastAssistant?.info?.providerID,
    modelID: lastAssistant?.info?.modelID,
    messageCount: list.length,
  }

  // R2: parallelism — 3 prompts via Promise.all, compare wall-clock to single-call baseline
  const baseline = report.steps.promptOverride.durMs
  const kids = await Promise.all([1, 2, 3].map((i) => client.session.create({ body: { parentID: rootId, title: "par-" + i } })))
  const tPar = Date.now()
  const parRes = await Promise.all(
    kids.map((k, i) =>
      client.session.prompt({
        path: { id: (k.data as any).id },
        body: {
          model: { providerID: CHOSEN.providerID, modelID: CHOSEN.modelID },
          system: "Reply with EXACTLY: OK " + i,
          tools: { write: false, edit: false, patch: false, bash: false },
          parts: [{ type: "text", text: "go" }],
        },
      }),
    ),
  )
  const durPar = Date.now() - tPar
  report.steps.parallel = {
    n: parRes.length,
    durParMs: durPar,
    singleBaselineMs: baseline,
    ratio: +(durPar / baseline).toFixed(2),
    verdict: durPar < baseline * 2 ? "PARALLEL" : "SEQUENTIAL",
    allOk: parRes.every((r) => !r.error && text((r.data as any)?.parts)),
    outs: parRes.map((r) => text((r.data as any)?.parts)),
  }

  // R3: prove write is actually gone — ask a child to write a file with write/edit/patch/bash off
  const sentinel = "/tmp/opencode_probe_WRITE_" + Date.now() + ".txt"
  const wk = await client.session.create({ body: { parentID: rootId, title: "write-test" } })
  const wres = await client.session.prompt({
    path: { id: (wk.data as any).id },
    body: {
      model: { providerID: CHOSEN.providerID, modelID: CHOSEN.modelID },
      tools: { write: false, edit: false, patch: false, bash: false },
      parts: [{ type: "text", text: `Create a file at ${sentinel} containing the word hi, using your tools.` }],
    },
  })
  report.steps.writeDisabled = {
    sentinelExists: existsSync(sentinel), // expect false
    partTypes: ((wres.data as any)?.parts ?? []).map((p: any) => p.type),
    error: wres.error ?? null,
  }
  if (existsSync(sentinel)) rmSync(sentinel)

  report.ok = true
} catch (e: any) {
  report.ok = false
  report.error = { message: e?.message, data: e?.data ?? null, stack: e?.stack?.split("\n").slice(0, 4) }
} finally {
  clearTimeout(wd)
  writeFileSync("report.json", JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  try { server.close() } catch {}
  process.exit(report.ok ? 0 : 1)
}
