import { summarizeErrorEntry } from "./logParser.js"
import type { LogEntry } from "./logParser.js"

export interface FormatOptions {
  full?: boolean
  json?: boolean
}

// Format a tool_use entry as a single line. The icon and title are always
// shown; description is appended if present; blockContent is indented below
// when full=true.
function formatToolEntry(entry: LogEntry, full: boolean): string {
  const parts: string[] = []

  const icon = entry.icon ?? "⚙"
  const title = entry.title ?? ""
  const line = entry.description ? `  ${icon} ${title} (${entry.description})` : `  ${icon} ${title}`
  parts.push(line)

  if (entry.errorMessage) {
    parts.push(`  ! ${entry.errorMessage}`)
  }

  if (full && entry.blockContent) {
    const indented = entry.blockContent
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n")
    parts.push(indented)
  }

  return parts.join("\n")
}

function formatErrorEntry(entry: LogEntry): string {
  return `  ! ${summarizeErrorEntry(entry)}`
}

// Render a LogEntry[] as plain text. By default (full=false) tool calls are
// summarised as one-liners and step_finish/reasoning entries are omitted.
// With full=true the block content (bash output, file contents, diffs) is
// included beneath each tool call.
export function formatLog(entries: LogEntry[], options: FormatOptions = {}): string {
  if (options.json) {
    return JSON.stringify(entries, null, 2)
  }

  const { full = false } = options
  const sections: string[] = []

  // Collect prompt entries first so we can render a header block.
  const promptEntries = entries.filter((e) => e.kind === "prompt")
  if (promptEntries.length > 0) {
    const promptText = promptEntries.map((e) => e.text ?? "").join("\n\n")
    sections.push(`# Prompt\n\n${promptText}`)
  }

  // Collect everything that follows: text and tool_use entries (plus block
  // content when full=true). step_finish and reasoning are always omitted.
  const outputLines: string[] = []
  for (const entry of entries) {
    if (entry.kind === "prompt" || entry.kind === "step_finish" || entry.kind === "reasoning") {
      continue
    }

    if (entry.kind === "text") {
      outputLines.push(entry.text ?? "")
      continue
    }

    if (entry.kind === "error") {
      outputLines.push(formatErrorEntry(entry))
      continue
    }

    if (entry.kind === "tool_use") {
      outputLines.push(formatToolEntry(entry, full))
      continue
    }
  }

  if (outputLines.length > 0) {
    sections.push(`# Output\n\n${outputLines.join("\n\n")}`)
  }

  return sections.join("\n\n")
}
