// The weight-bearing piece. Probe finding: `system` is an additive LENS, not authoritative —
// so the real instructions ride in the task `parts`. Explorers run blind & parallel; the
// aggregator must MERGE losslessly (not summarize).

// Stance only — `system` is a weak, additive lens (probe: a strict "reply X only" system was
// ignored). It does NOT enforce behavior; the hard guarantee is the tool block in fusion.ts
// (`question`/`task`/`todowrite` disabled, so an explorer literally cannot ask or branch out).
export const EXPLORER_SYSTEM = [
  "Analyze, explore, think, and reason how to solve this task.",
  "This is analysis and exploration only. Never modify anything.",
  "Be specific and terse. No filler, no restating the task back to me.",
  "Return findings as plain final text.",
].join(" ");

export function buildExplorerParts(task: string): string {
  return [
    "Analyze the task as an independent read-only explorer.",
    "Use available read/search/research tools if useful, but do not modify files, ask questions, create subtasks, or call Fusion.",
    "Return a final answer as normal text. Do not leave the answer only in reasoning, tool notes, or scratch work.",
    "Final answer format: terse bullet points with concrete findings, risks, frictions, and implementation-relevant details.",
    "No filler. Do not restate the task.",
    "",
    "TASK:",
    task.trim(),
  ].join("\n");
}

// Aggregator instructions live in `parts` (authoritative — `system` is too weak to rely on),
// with the raw findings inlined. The aggregator gets ONLY the analysis text — no model
// names, counts, or run status. It must not know who/what produced these, only the content.
export function buildAggregatorParts(task: string, analyses: string[]): string {
  const sections = analyses
    .map((output, i) => `--- Analysis ${i + 1} ---\n${output.trim()}`)
    .join("\n\n");

  return [
    "Below are independent analyses of the same task. Merge them into one answer.",
    "Keep every distinct point, drop duplicates, and call out where they disagree.",
    "Answer exactly what the task asked. Be specific and terse. No filler.",
    "",
    "TASK:",
    task.trim(),
    "",
    "ANALYSES:",
    sections,
  ].join("\n");
}
