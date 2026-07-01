// Plugin entry — thin wiring over the engine. Registers the `fusion` tool; panel/synthesizer
// come from the options tuple in opencode.json.
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
              // Surface a dropped panelist out of band (toast); never leaks into the aggregator.
              // TUI-only, so no-ops under headless `opencode run` — hence the swallowed catch.
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

            // Synthesis failed but explorers didn't: return their raw findings with an explicit
            // do-NOT-rerun directive (re-running repeats the whole expensive fan-out). Partial success.
            if (!result.synthOk) {
              const usable = ok.filter((e) => e.output)
              const lines = [
                "# Fusion — synthesis failed; raw explorer findings preserved",
                "",
                `Synthesizer \`${result.synthesizer}\` did not return a merged plan: ${result.synthError ?? "unknown error"}.`,
                `${usable.length}/${result.explorers.length} explorers succeeded. **Synthesize directly from the findings below — do NOT re-run fusion.** The expensive fan-out already completed; its full output is here and in the child sessions.`,
                ...usable.map((e) => `\n---\n\n## \`${e.slug}\` · \`${e.sessionId}\`\n\n${e.output}`),
              ]
              if (failed.length) {
                lines.push("\n---\n")
                lines.push(...failed.map((e) => `\`${e.slug}\` - skipped (${e.error})`))
              }
              return {
                title: `Fusion (partial): ${truncate(args.prompt)}`,
                output: lines.join("\n"),
                metadata: {
                  partial: true,
                  synthesizer: result.synthesizer,
                  synthError: result.synthError,
                  explorers: result.explorers.map((e) => ({ slug: e.slug, ok: e.ok, sessionId: e.sessionId, error: e.error })),
                },
              }
            }

            // Footer ids/slugs in backticks: session ids contain underscores the markdown
            // renderer would otherwise render as italics.
            const footer = [
              "",
              "---",
              `Fusion ${ok.length}/${result.explorers.length} explorers synthesized by ${result.synthesizer}`,
              ...ok.map((e) => `\`${e.slug}\` - \`${e.sessionId}\``),
              ...failed.map((e) => `\`${e.slug}\` - skipped${e.sessionId ? ` - \`${e.sessionId}\`` : ""} (${e.error})`),
            ].join("\n")

            return {
              title: `Fusion: ${truncate(args.prompt)}`,
              output: (result.plan ?? "") + "\n" + footer,
              metadata: {
                synthesizer: result.synthesizer,
                explorers: result.explorers.map((e) => ({ slug: e.slug, ok: e.ok, sessionId: e.sessionId, error: e.error })),
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
