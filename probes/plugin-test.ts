// Deterministic test of the PLUGIN layer (src/index.ts): build the tool via FusionPlugin,
// call execute() directly with a real client. Confirms tool registration, output footer,
// and metadata shape without a model-in-the-loop. Run: bun plugin-test.ts
import { createOpencode } from "@opencode-ai/sdk"
import { FusionPlugin } from "../src/index"

const { client, server } = await createOpencode({ hostname: "127.0.0.1", port: 0 })
try {
  const root = await client.session.create({ body: { title: "plugin-test" } })
  const sessionID = (root.data as any).id

  const hooks: any = await FusionPlugin({ client } as any, {
    panel: ["opencode/big-pickle", "opencode/north-mini-code-free"],
    synthesizer: "opencode/big-pickle",
  })
  const fusion = hooks.tool.fusion

  const ctx: any = {
    sessionID,
    messageID: "msg_none",
    agent: "build",
    abort: new AbortController().signal,
    metadata() {},
    ask: async () => {},
  }

  const res = await fusion.execute(
    { prompt: "List the top 5 security risks in a Solidity escrow contract and how to mitigate each." },
    ctx,
  )

  console.log("TITLE:", res.title)
  console.log("META:", JSON.stringify(res.metadata, null, 2))
  console.log("OUTPUT (head):\n", res.output.slice(0, 1200))
  console.log("OUTPUT (tail / footer):\n", res.output.slice(-500))
} catch (e: any) {
  console.error("FAIL:", e?.message, e?.stack?.split("\n").slice(0, 5).join("\n"))
  try { server.close() } catch {}
  process.exit(1)
}
try { server.close() } catch {}
process.exit(0)
