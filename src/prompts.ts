// Explorer + aggregator prompts. `system` is only an additive lens (see docs/internals.md);
// the real instructions ride in the task `parts`, and read-only is enforced by the tool block.

// Stance lens only — not a behavioral guarantee.
export const EXPLORER_SYSTEM = [
  "Analyze, explore, think, and reason how to solve this task.",
  "This is analysis and exploration only. Never modify anything.",
  "Be specific and terse. No filler, no restating the task back to me.",
  "Return findings as plain final text.",
].join(" ")

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
  ].join("\n")
}

// The aggregator gets ONLY the analysis text — no model names, counts, or run status.
export function buildAggregatorParts(task: string, analyses: string[]): string {
  const sections = analyses.map((output, i) => `--- Analysis ${i + 1} ---\n${output.trim()}`).join("\n\n")

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
  ].join("\n")
}
