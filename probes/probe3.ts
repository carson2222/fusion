// Diagnose: why do opencode-go/* explorers return empty text? Dump raw info + part types,
// with and without our system/tools overrides, vs a known-good free model. Run: bun probe3.ts
import { createOpencode } from "@opencode-ai/sdk"

const { client, server } = await createOpencode({ hostname: "127.0.0.1", port: 0 })
const root = await client.session.create({ body: { title: "probe3" } })
const rootId = (root.data as any).id

async function tryModel(slug: string, withOverrides: boolean) {
  const [providerID, ...rest] = slug.split("/")
  const modelID = rest.join("/")
  const k = await client.session.create({ body: { parentID: rootId, title: `p3 ${slug} ${withOverrides}` } })
  const body: any = {
    model: { providerID, modelID },
    parts: [{ type: "text", text: "List 3 risks in a Solidity withdrawal function. Be brief." }],
  }
  if (withOverrides) {
    body.system = "You are an explorer. Be terse."
    body.tools = { write: false, edit: false, patch: false, bash: false }
  }
  try {
    const r: any = await client.session.prompt({ path: { id: (k.data as any).id }, body, signal: AbortSignal.timeout(120_000) } as any)
    const parts = r?.data?.parts ?? []
    return {
      slug, withOverrides,
      error: r?.error ?? null,
      finish: r?.data?.info?.finish,
      infoError: r?.data?.info?.error ?? null,
      partTypes: parts.map((p: any) => p.type),
      textLen: parts.filter((p: any) => p.type === "text").map((p: any) => p.text).join("").length,
      sample: JSON.stringify(parts).slice(0, 600),
    }
  } catch (e: any) {
    return { slug, withOverrides, thrown: e?.message }
  }
}

const results: any[] = []
for (const slug of ["opencode-go/glm-5.2", "opencode-go/kimi-k2.7-code", "opencode/big-pickle"]) {
  results.push(await tryModel(slug, false))
  results.push(await tryModel(slug, true))
}
console.log(JSON.stringify(results, null, 2))
try { server.close() } catch {}
process.exit(0)
