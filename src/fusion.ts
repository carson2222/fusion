// Engine: fan one task out to read-only explorers in parallel, then aggregate with the
// synthesizer. Pure over the SDK client (no plugin wiring). SDK gotchas: docs/internals.md.
import type { OpencodeClient } from "@opencode-ai/sdk"
import { parseConfig, type Model } from "./config"
import { EXPLORER_SYSTEM, buildAggregatorParts, buildExplorerParts } from "./prompts"

// Generous backstops, not the primary control: on a synth timeout we recover the persisted
// plan (recoverSynthPlan) instead of discarding the fan-out.
const EXPLORER_TIMEOUT_MS = 900_000
const SYNTH_TIMEOUT_MS = 1_800_000

// Block the finite set of built-in action/control tools; keep read/research/MCP/web. Explorers
// run as `build`, so this is the only read-only guarantee. Rationale: docs/internals.md.
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// A raw Error/DOMException JSON.stringifies to "{}" (non-enumerable props); pull a real message.
const errText = (err: any): string => {
  if (err == null) return "unknown error"
  if (typeof err === "string") return err
  const msg = err.data?.message ?? err.message ?? err.name
  if (msg) return String(msg)
  try {
    const s = JSON.stringify(err)
    return s && s !== "{}" ? s : String(err)
  } catch {
    return String(err)
  }
}

export type ExplorerResult = {
  slug: string
  sessionId?: string
  ok: boolean
  output?: string
  error?: string
}

export type FusionResult = {
  // Present when synthesis succeeded or was recovered; absent when it genuinely failed —
  // callers then degrade to `explorers` and must never re-run the panel.
  plan?: string
  synthesizer: string
  synthOk: boolean
  synthError?: string
  explorers: ExplorerResult[]
}

// Synthesizer default: the calling assistant message's model, else the last assistant message.
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

// One explorer: its own child session, blind to the others, read-only. `onSettled` fires once
// so the caller can surface run health while the engine stays UI-agnostic.
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
        ...(model.variant ? { variant: model.variant } : {}), // per-call effort; unknown → model default
        system: EXPLORER_SYSTEM,
        tools: { ...READONLY_TOOLS },
        parts: [{ type: "text", text: buildExplorerParts(task) }],
      },
      signal: withTimeout(EXPLORER_TIMEOUT_MS, caller),
    } as any)
    if (r?.error) throw new Error(typeof r.error === "string" ? r.error : JSON.stringify(r.error))
    // Failed model calls return 200 with the error on info.error (not r.error) + empty parts.
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

// A client abort/timeout doesn't stop the server — it finishes and persists the message. Poll
// the synth session for its completed message instead of throwing the fan-out away. Bail fast on
// a hard model error (never completes) or a user cancel.
async function recoverSynthPlan(
  client: OpencodeClient,
  sessionId: string,
  caller?: AbortSignal,
): Promise<string | undefined> {
  const fetchLast = async () => {
    const msgs: any = await client.session.messages({ path: { id: sessionId } }).catch(() => null)
    return [...((msgs?.data ?? []) as any[])].reverse().find((x) => x?.info?.role === "assistant")
  }
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (caller?.aborted) return undefined
    const last = await fetchLast()
    const info = last?.info
    if (info?.error) return undefined
    if (info?.time?.completed) {
      const text = textOf(last.parts)
      return text || undefined
    }
    await sleep(3000)
  }
  const last = await fetchLast()
  if (last?.info?.error) return undefined
  const text = last ? textOf(last.parts) : ""
  return text || undefined
}

export async function runFusion(input: {
  client: OpencodeClient
  task: string
  sessionID: string
  messageID?: string
  options: Record<string, unknown> | undefined
  signal?: AbortSignal
  // Fires once per explorer as it settles; the tool layer uses it to surface run health.
  onExplorerSettled?: (e: ExplorerResult) => void
}): Promise<FusionResult> {
  const { client, task, sessionID, messageID, signal } = input
  const config = parseConfig(input.options)
  if (!task.trim()) throw new Error("Fusion: empty task.")

  // synthesizer: explicit override -> current driving model -> first panel member.
  const synth: Model =
    config.synthesizer ?? (await readCurrentModel(client, sessionID, messageID)) ?? config.panel[0]

  const explorers = await Promise.all(
    config.panel.map((m) => runExplorer(client, sessionID, m, task, signal, input.onExplorerSettled)),
  )

  const succeeded = explorers.filter((e) => e.ok && e.output)
  if (succeeded.length === 0) {
    throw new Error(
      "Fusion: every explorer failed —\n" + explorers.map((e) => `  • ${e.slug}: ${e.error}`).join("\n"),
    )
  }

  // Aggregate internally: only the merged plan returns to the main session; raw audits stay in
  // the explorer child sessions.
  const agg: any = await client.session.create({ body: { parentID: sessionID, title: "fusion synthesizer" } })
  const aggId = agg?.data?.id
  if (agg?.error || !aggId) throw new Error(`Fusion: synthesizer session.create failed: ${errText(agg?.error)}`)

  let plan: string | undefined
  let synthError: string | undefined
  try {
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
    if (res?.error) throw new Error(errText(res.error))
    if (res?.data?.info?.error) throw new Error(errText(res.data.info.error))
    plan = textOf(res?.data?.parts) || undefined
    if (!plan) throw new Error("synthesizer produced no output")
  } catch (e: any) {
    synthError = errText(e)
    plan = await recoverSynthPlan(client, aggId, signal) // reclaim the persisted plan if the server finished after we gave up
  }

  if (plan) return { plan, synthesizer: synth.slug, synthOk: true, explorers }
  // Synthesis genuinely failed: hand back raw findings so the caller synthesizes directly —
  // never drop them, never re-run the panel.
  return { synthesizer: synth.slug, synthOk: false, synthError, explorers }
}
