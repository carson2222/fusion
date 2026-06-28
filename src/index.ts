// Fusion plugin entry — thin wiring over the engine in fusion.ts.
// Registers the `fusion` tool. The plugin closes over the injected SDK `client`;
// panel/synthesizer come from the options tuple in opencode.json.
import { type Plugin, tool } from "@opencode-ai/plugin"
import { runFusion } from "./fusion"

const truncate = (s: string, n = 60) => (s.length > n ? s.slice(0, n).trimEnd() + "…" : s)

export const FusionPlugin: Plugin = async ({ client }, options) => {
  return {
    tool: {
      fusion: tool({
        description:
          "Fan a hard problem out to a panel of independent models running in parallel as read-only explorers, then aggregate their findings into ONE answer/audit. Use for genuinely hard, high-stakes, or ambiguous problems (security audits, system architecture, subtle bugs) where a single model is likely to miss something. Read-only analysis — never modifies files. Returns one aggregated result; each explorer's full analysis is preserved as a child session.",
        args: {
          prompt: tool.schema
            .string()
            .describe("The hard task to investigate. Be specific; include the question, context, and any files in scope."),
        },
        async execute(args, ctx) {
          try {
            const result = await runFusion({
              client,
              task: args.prompt,
              sessionID: ctx.sessionID,
              messageID: ctx.messageID,
              options,
              signal: ctx.abort,
              // Surface a failed explorer the moment it settles — out of band, so the user
              // knows a panelist dropped (rate limit, credits, timeout…) and the result is
              // partial, without any of this leaking into the aggregator. TUI-only: no-ops
              // under headless `opencode run`, hence the swallowed catch.
              onExplorerSettled: (e) => {
                if (e.ok) return
                client.tui
                  .showToast({
                    body: { variant: "warning", message: `Fusion: ${e.slug} skipped — ${truncate(e.error ?? "failed", 100)}` },
                  })
                  .catch(() => {})
              },
            })

            const ok = result.explorers.filter((e) => e.ok)
            const failed = result.explorers.filter((e) => !e.ok)
            const footer = [
              "",
              "---",
              `Fusion ${ok.length}/${result.explorers.length} explorers synthesized by ${result.synthesizer}`,
              // Wrap ids/slugs in backticks: session ids contain underscores, which the markdown
              // renderer otherwise eats as *italic* emphasis (garbles the footer).
              ...ok.map((e) => `\`${e.slug}\` - \`${e.sessionId}\``),
              ...failed.map((e) => `\`${e.slug}\` - skipped${e.sessionId ? ` - \`${e.sessionId}\`` : ""} (${e.error})`),
            ].join("\n")

            return {
              title: `Fusion: ${truncate(args.prompt)}`,
              output: result.plan + "\n" + footer,
              metadata: {
                synthesizer: result.synthesizer,
                explorers: result.explorers.map((e) => ({
                  slug: e.slug,
                  ok: e.ok,
                  sessionId: e.sessionId,
                  error: e.error,
                })),
              },
            }
          } catch (e: any) {
            return {
              title: "Fusion: error",
              output: e?.message ?? String(e),
              metadata: { error: true },
            }
          }
        },
      }),
    },
  }
}
