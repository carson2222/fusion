// Fusion engine: fan one task out to a panel of read-only explorers in parallel,
// then aggregate their findings with the synthesizer model. Pure functions over the
// OpenCode SDK client — no plugin wiring here, so it's testable in isolation and a
// future orchestrator can call it directly. Verified call shapes: probes/FINDINGS.md.
import type { OpencodeClient } from "@opencode-ai/sdk"
import { parseConfig, type Model } from "./config"
import { EXPLORER_SYSTEM, buildAggregatorParts, buildExplorerParts } from "./prompts"

// Per-call wall-clock ceiling. A hung explorer is dropped, not allowed to hang the run.
const EXPLORER_TIMEOUT_MS = 300_000
const SYNTH_TIMEOUT_MS = 300_000
// Explorers run as the full `build` agent, so they inherit its god-mode toolset. We block
// the entire set of built-in ACTION/CONTROL tools, leaving only read + research/MCP tools
// (which are the safe, useful ones and also the dynamically-growing ones we WANT to keep):
//   write/edit/patch/bash → mutate the shared worktree
//   question              → pauses the whole panel on a dialog, masquerades as the result
//   task                  → nested subagent fan-out
//   fusion                → SELF-RECURSION (explorers spawning their own panels — observed)
//   plan_exit             → drops into plan mode, writes a plan file, blocks on a dialog (observed)
//   todowrite             → noise
// This is a denylist, but the dangerous tools are OpenCode's FINITE built-in set; the
// dynamic part (MCP/web/read) is exactly what we allow. Add new built-in action tools here.
const READONLY_TOOLS = {
  write: false,
  edit: false,
  patch: false,
  bash: false,
  question: false,
  task: false,
  fusion: false,
  plan_exit: false,
  todowrite: false,
} as const

const textOf = (parts: any[] = []) =>
  parts
    .filter((p) => p?.type === "text")
    .map((p) => p.text)
    .join("")
    .trim()

const partTypeSummary = (parts: any[] = []) => {
  const counts = new Map<string, number>()
  for (const part of parts) counts.set(part?.type ?? "unknown", (counts.get(part?.type ?? "unknown") ?? 0) + 1)
  return [...counts.entries()].map(([type, count]) => `${type}=${count}`).join(", ")
}

const withTimeout = (ms: number, caller?: AbortSignal) =>
  caller ? AbortSignal.any([caller, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms)

export type ExplorerResult = {
  slug: string
  sessionId?: string
  ok: boolean
  output?: string
  error?: string
}

export type FusionResult = {
  plan: string
  synthesizer: string
  explorers: ExplorerResult[]
}

// Read the model the user is currently driving with — the synthesizer default.
// Precise source = the calling assistant message; fall back to the last assistant message.
async function readCurrentModel(
  client: OpencodeClient,
  sessionID: string,
  messageID?: string,
): Promise<Model | undefined> {
  if (messageID) {
    const m: any = await client.session.message({ path: { id: sessionID, messageID } }).catch(() => null)
    const info = m?.data?.info
    if (info?.providerID && info?.modelID)
      return { providerID: info.providerID, modelID: info.modelID, slug: `${info.providerID}/${info.modelID}` }
  }
  const msgs: any = await client.session.messages({ path: { id: sessionID } }).catch(() => null)
  const last = [...((msgs?.data ?? []) as any[])].reverse().find((x) => x?.info?.role === "assistant")
  if (last?.info?.providerID && last?.info?.modelID)
    return {
      providerID: last.info.providerID,
      modelID: last.info.modelID,
      slug: `${last.info.providerID}/${last.info.modelID}`,
    }
  return undefined
}

// One explorer: its own child session, blind to the others, read-only.
// `onSettled` fires once with the final result (ok or failed) so the caller can surface
// run health (e.g. a toast) — the engine itself stays UI-agnostic.
async function runExplorer(
  client: OpencodeClient,
  parentID: string,
  model: Model,
  task: string,
  caller?: AbortSignal,
  onSettled?: (e: ExplorerResult) => void,
): Promise<ExplorerResult> {
  let sessionId: string | undefined
  let result: ExplorerResult
  try {
    const s: any = await client.session.create({
      body: { parentID, title: `fusion explorer · ${model.slug}` },
    })
    sessionId = s?.data?.id
    if (s?.error || !sessionId) throw new Error(`session.create failed: ${JSON.stringify(s?.error ?? {})}`)

    const r: any = await client.session.prompt({
      path: { id: sessionId },
      body: {
        model: { providerID: model.providerID, modelID: model.modelID },
        // Per-call reasoning effort (verified: the prompt route accepts + persists `variant`;
        // unknown values fall back to the model default server-side). Omit when unset.
        ...(model.variant ? { variant: model.variant } : {}),
        system: EXPLORER_SYSTEM,
        tools: { ...READONLY_TOOLS },
        parts: [{ type: "text", text: buildExplorerParts(task) }],
      },
      signal: withTimeout(EXPLORER_TIMEOUT_MS, caller),
    } as any)
    if (r?.error) throw new Error(typeof r.error === "string" ? r.error : JSON.stringify(r.error))
    // A failed model call comes back 200 with the error on info.error (not r.error) + empty parts.
    const info = r?.data?.info
    if (info?.error) throw new Error(info.error?.data?.message ?? info.error?.message ?? info.error?.name ?? "model error")

    const parts = r?.data?.parts ?? []
    const output = textOf(parts)
    if (!output) {
      const summary = partTypeSummary(parts)
      const finish = info?.finish ?? "unknown"
      throw new Error(`no final text output (finish: ${finish}${summary ? `; parts: ${summary}` : ""})`)
    }
    result = { slug: model.slug, sessionId, ok: true, output }
  } catch (e: any) {
    result = { slug: model.slug, sessionId, ok: false, error: e?.message ?? String(e) }
  }
  onSettled?.(result)
  return result
}

export async function runFusion(input: {
  client: OpencodeClient
  task: string
  sessionID: string
  messageID?: string
  options: Record<string, unknown> | undefined
  signal?: AbortSignal
  // Fires once per explorer as it settles (ok or failed). UI-agnostic: the tool layer
  // uses it to surface run health (toast). The engine never decides how it's shown.
  onExplorerSettled?: (e: ExplorerResult) => void
}): Promise<FusionResult> {
  const { client, task, sessionID, messageID, signal } = input
  const config = parseConfig(input.options)
  if (!task.trim()) throw new Error("Fusion: empty task.")

  // synthesizer: explicit override -> current driving model -> first panel member.
  const synth: Model =
    config.synthesizer ?? (await readCurrentModel(client, sessionID, messageID)) ?? config.panel[0]

  // Fan out — genuinely parallel (probe R2), each blind & read-only.
  const explorers = await Promise.all(
    config.panel.map((m) => runExplorer(client, sessionID, m, task, signal, input.onExplorerSettled)),
  )

  const succeeded = explorers.filter((e) => e.ok && e.output)
  if (succeeded.length === 0) {
    throw new Error(
      "Fusion: every explorer failed —\n" + explorers.map((e) => `  • ${e.slug}: ${e.error}`).join("\n"),
    )
  }

  // Aggregate INTERNALLY with the synthesizer, so only the merged plan returns to the main
  // session (raw audits stay in the explorer child sessions). PLAN.md: aggregate, never summarize.
  const agg: any = await client.session.create({ body: { parentID: sessionID, title: "fusion synthesizer" } })
  const aggId = agg?.data?.id
  if (agg?.error || !aggId) throw new Error(`Fusion: synthesizer session.create failed: ${JSON.stringify(agg?.error ?? {})}`)

  const res: any = await client.session.prompt({
    path: { id: aggId },
    body: {
      model: { providerID: synth.providerID, modelID: synth.modelID },
      ...(synth.variant ? { variant: synth.variant } : {}),
      tools: { ...READONLY_TOOLS },
      parts: [{ type: "text", text: buildAggregatorParts(task, succeeded.map((e) => e.output!)) }],
    },
    signal: withTimeout(SYNTH_TIMEOUT_MS, signal),
  } as any)
  if (res?.error) throw new Error(`Fusion: synthesizer failed: ${typeof res.error === "string" ? res.error : JSON.stringify(res.error)}`)
  const synthInfo = res?.data?.info
  if (synthInfo?.error)
    throw new Error(`Fusion: synthesizer (${synth.slug}) errored: ${synthInfo.error?.data?.message ?? synthInfo.error?.name ?? "model error"}`)

  const plan = textOf(res?.data?.parts)
  if (!plan) throw new Error("Fusion: synthesizer produced no output.")

  return { plan, synthesizer: synth.slug, explorers }
}
