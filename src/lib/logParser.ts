import { existsSync, readFileSync } from "node:fs"
import { taskOutputPath } from "./state.js"
export interface ToolStatePart {
  input?: Record<string, unknown>
  output?: string
  status?: string
  title?: string
  metadata?: Record<string, unknown>
  error?: string
}

export interface LogEvent {
  type: string
  timestamp: number
  // prompt events carry the message sent to the agent before it starts
  prompt?: string
  part?: {
    // tool parts
    tool?: string
    state?: ToolStatePart
    // text/reasoning parts
    type?: string
    text?: string
    time?: { end?: number }
    // step-finish parts
    reason?: string
    tokens?: {
      total?: number
      input: number
      output: number
    }
  }
  modelID?: string
}

export type LogEntryKind = "text" | "tool_use" | "step_finish" | "reasoning" | "prompt"

export interface LogEntry {
  kind: LogEntryKind
  timestamp: number
  // text entries
  text?: string
  // tool_use entries
  tool?: string
  icon?: string
  title?: string
  description?: string
  blockContent?: string
  blockKind?: "text" | "diff"
  status?: string
  errorMessage?: string
  // step_finish entries
  modelId?: string
  elapsedMs?: number
  // reasoning entries
  reasoningText?: string
}

// Extract the text content of a single top-level XML tag by name using
// simple string search. This avoids re-parsing the XML, which breaks when
// file content contains JSX/HTML tags that the parser treats as XML elements.
function extractTagContent(xml: string, tagName: string): string | null {
  const openTag = `<${tagName}`
  const closeTag = `</${tagName}>`
  const start = xml.indexOf(openTag)
  if (start === -1) return null
  const contentStart = xml.indexOf(">", start) + 1
  const contentEnd = xml.lastIndexOf(closeTag)
  if (contentEnd <= contentStart) return null
  return xml.slice(contentStart, contentEnd)
}

// Parse the output from a file/directory read tool. The MCP Read tool wraps
// output in XML like:
//
//   <path>/abs/path</path>
//   <type>file</type>
//   <content>1: line one
//   2: line two</content>
//
// or for directories, <entries> instead of <content>. We want to show just
// the file/directory listing, not the path and type noise that gets mixed in
// when you strip all tags indiscriminately.
//
// We use plain string extraction rather than XML parsing here because file
// content often contains JSX/HTML tags that confuse the XML parser.
//
// Falls back to the raw string if the content doesn't look like this format.
export function parseReadOutput(raw: string): string {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith("<")) return raw
  const content = extractTagContent(trimmed, "content")
  if (content !== null && content.trim()) return content.trim()
  const entries = extractTagContent(trimmed, "entries")
  if (entries !== null && entries.trim()) return entries.trim()
  return raw
}

export function normalizePath(input?: string): string {
  if (!input) return ""
  // If it looks like an absolute path, show the last 2-3 segments to keep it readable
  if (input.startsWith("/")) {
    const parts = input.split("/").filter(Boolean)
    return parts.slice(-3).join("/")
  }
  return input
}

export function parseToolEntry(event: LogEvent): LogEntry | null {
  const tool = event.part?.tool
  if (!tool) return null

  const state = event.part?.state
  const input = state?.input ?? {}
  const status = state?.status ?? "unknown"
  const metadata = state?.metadata ?? {}
  const errorMessage = status === "error" ? (state?.error ?? "error") : undefined

  const str = (v: unknown): string => (typeof v === "string" ? v : "")
  const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined)

  const toolLower = tool.toLowerCase()

  // bash
  if (toolLower === "bash" || toolLower.includes("bash")) {
    const command = str(input.command) || str(input.description) || tool
    const output = str(metadata.output) || str(state?.output)
    return {
      kind: "tool_use",
      timestamp: event.timestamp,
      tool,
      icon: "$",
      title: command,
      blockContent: output || undefined,
      status,
      errorMessage,
    }
  }

  // read
  if (toolLower === "read" || toolLower.includes("_read") || toolLower.endsWith("read")) {
    const filePath = normalizePath(str(input.filePath))
    const offset = num(input.offset)
    const limit = num(input.limit)
    let description: string | undefined
    if (offset !== undefined && limit !== undefined) {
      description = `lines ${offset}–${offset + limit}`
    } else if (offset !== undefined) {
      description = `from line ${offset}`
    }
    const rawOutput = str(state?.output)
    const output = rawOutput ? parseReadOutput(rawOutput) : undefined
    return {
      kind: "tool_use",
      timestamp: event.timestamp,
      tool,
      icon: "→",
      title: `Read ${filePath}`,
      description,
      blockContent: output || undefined,
      status,
      errorMessage,
    }
  }

  // todowrite -- must come before the generic write check because "todowrite".endsWith("write")
  if (toolLower === "todowrite") {
    const todos = Array.isArray(input.todos) ? input.todos : []
    const todoLines = todos.map((todo: unknown) => {
      const t = todo as Record<string, unknown>
      const content = str(t.content)
      const todoStatus = str(t.status)
      const marker = todoStatus === "completed" ? "✓" : todoStatus === "in_progress" ? "~" : " "
      return `[${marker}] ${content}`
    })
    return {
      kind: "tool_use",
      timestamp: event.timestamp,
      tool,
      icon: "#",
      title: "Todos",
      blockContent: todoLines.length ? todoLines.join("\n") : undefined,
      status,
      errorMessage,
    }
  }

  // write
  if (toolLower === "write" || toolLower.includes("_write") || toolLower.endsWith("write")) {
    const filePath = normalizePath(str(input.filePath))
    const content = str(input.content)
    return {
      kind: "tool_use",
      timestamp: event.timestamp,
      tool,
      icon: "←",
      title: `Write ${filePath}`,
      blockContent: content || undefined,
      status,
      errorMessage,
    }
  }

  // edit
  if (toolLower === "edit" || toolLower.includes("_edit") || toolLower.endsWith("edit")) {
    const filePath = normalizePath(str(input.filePath))
    const diff = str(metadata.diff)
    const fallback = str(metadata.output)
    return {
      kind: "tool_use",
      timestamp: event.timestamp,
      tool,
      icon: "←",
      title: `Edit ${filePath}`,
      blockContent: diff || fallback || undefined,
      blockKind: diff ? "diff" : "text",
      status,
      errorMessage,
    }
  }

  // glob
  if (toolLower === "glob") {
    const pattern = str(input.pattern)
    const root = str(input.path)
    const count = num(metadata.count)
    const suffix = root ? `in ${normalizePath(root)}` : ""
    const countStr = count !== undefined ? `${count} ${count === 1 ? "match" : "matches"}` : ""
    const description = [suffix, countStr].filter(Boolean).join(" · ") || undefined
    return {
      kind: "tool_use",
      timestamp: event.timestamp,
      tool,
      icon: "✱",
      title: `Glob "${pattern}"`,
      description,
      status,
      errorMessage,
    }
  }

  // grep
  if (toolLower === "grep") {
    const pattern = str(input.pattern)
    const root = str(input.path)
    const matches = num(metadata.matches)
    const suffix = root ? `in ${normalizePath(root)}` : ""
    const matchStr = matches !== undefined ? `${matches} ${matches === 1 ? "match" : "matches"}` : ""
    const description = [suffix, matchStr].filter(Boolean).join(" · ") || undefined
    return {
      kind: "tool_use",
      timestamp: event.timestamp,
      tool,
      icon: "✱",
      title: `Grep "${pattern}"`,
      description,
      status,
      errorMessage,
    }
  }

  // list
  if (toolLower === "list" || toolLower === "ls") {
    const dir = normalizePath(str(input.path))
    return {
      kind: "tool_use",
      timestamp: event.timestamp,
      tool,
      icon: "→",
      title: dir ? `List ${dir}` : "List",
      status,
      errorMessage,
    }
  }

  // webfetch
  if (toolLower === "webfetch") {
    const url = str(input.url)
    return {
      kind: "tool_use",
      timestamp: event.timestamp,
      tool,
      icon: "%",
      title: `WebFetch ${url}`,
      status,
      errorMessage,
    }
  }

  // task
  if (toolLower === "task") {
    const subagent = str(input.subagent_type).trim() || "unknown"
    const desc = str(input.description).trim() || undefined
    const icon = status === "error" ? "✗" : status === "running" ? "•" : "✓"
    const name = desc ?? `${subagent} Task`
    const description = desc ? subagent : undefined
    return {
      kind: "tool_use",
      timestamp: event.timestamp,
      tool,
      icon,
      title: name,
      description,
      status,
      errorMessage,
    }
  }

  // skill
  if (toolLower === "skill") {
    const name = str(input.name)
    return {
      kind: "tool_use",
      timestamp: event.timestamp,
      tool,
      icon: "→",
      title: `Skill "${name}"`,
      status,
      errorMessage,
    }
  }

  // fallback: anything else
  const firstValue = Object.values(input)[0]
  const fallbackDesc = typeof firstValue === "string" ? firstValue.slice(0, 80) : ""
  return {
    kind: "tool_use",
    timestamp: event.timestamp,
    tool,
    icon: "⚙",
    title: `${tool}${fallbackDesc ? " " + fallbackDesc : ""}`,
    status,
    errorMessage,
  }
}

export function parseEvent(event: LogEvent): LogEntry[] {
  switch (event.type) {
    case "prompt": {
      const text = event.prompt?.trim()
      if (!text) return []
      return [{ kind: "prompt", timestamp: event.timestamp, text }]
    }

    case "text": {
      const text = event.part?.text?.trim()
      if (!text) return []
      return [{ kind: "text", timestamp: event.timestamp, text }]
    }

    case "tool_use": {
      const entry = parseToolEntry(event)
      if (!entry) return []
      return [entry]
    }

    case "step_finish": {
      const modelId = typeof event.modelID === "string" ? event.modelID : undefined
      return [{
        kind: "step_finish",
        timestamp: event.timestamp,
        modelId,
      }]
    }

    case "reasoning": {
      const text = event.part?.text?.trim()
      if (!text) return []
      return [{
        kind: "reasoning",
        timestamp: event.timestamp,
        reasoningText: text,
      }]
    }

    default:
      return []
  }
}

export function readLogEntries(repoRoot: string, taskId: string): LogEntry[] {
  const path = taskOutputPath(repoRoot, taskId)
  if (!existsSync(path)) return []
  const raw = readFileSync(path, "utf8")
  const entries: LogEntry[] = []
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const event = JSON.parse(trimmed) as LogEvent
      entries.push(...parseEvent(event))
    } catch {
      // skip unparseable lines
    }
  }

  // Annotate each step_finish with how long it took since the previous step_finish
  // (or the very first event if it's the first step).
  let prevTimestamp = entries[0]?.timestamp ?? 0
  for (const entry of entries) {
    if (entry.kind === "step_finish") {
      entry.elapsedMs = entry.timestamp - prevTimestamp
      prevTimestamp = entry.timestamp
    }
  }

  return entries
}

export function formatElapsed(startedAt: string, completedAt: string | null, now: number): string {
  const end = completedAt ? new Date(completedAt).getTime() : now
  const elapsed = Math.floor((end - new Date(startedAt).getTime()) / 1000)
  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  return `${mins}m ${String(secs).padStart(2, "0")}s`
}

export function formatElapsedMs(ms: number): string {
  const totalSecs = Math.floor(ms / 1000)
  const mins = Math.floor(totalSecs / 60)
  const secs = totalSecs % 60
  if (mins > 0) return `${mins}m ${String(secs).padStart(2, "0")}s`
  return `${secs}s`
}
