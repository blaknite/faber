import { useCallback, useEffect, useRef, useState } from "react"
import { existsSync, readFileSync, watch } from "node:fs"
import type { FSWatcher } from "node:fs"
import { createTextAttributes, SyntaxStyle } from "@opentui/core"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { taskOutputPath } from "../lib/state.js"
import { MODELS } from "../types.js"
import type { Task, TaskStatus } from "../types.js"

const syntaxStyle = SyntaxStyle.create()

interface ToolStatePart {
  input?: Record<string, unknown>
  output?: string
  status?: string
  title?: string
  metadata?: Record<string, unknown>
  error?: string
}

interface LogEvent {
  type: string
  timestamp: number
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

type LogEntryKind = "text" | "tool_use" | "step_finish" | "reasoning"

interface LogEntry {
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

const TOOL_COLORS: Record<string, string> = {
  bash: "#ff8800",
  read: "#0099ff",
  write: "#00cc66",
  edit: "#00cc66",
  glob: "#aa66ff",
  grep: "#aa66ff",
  task: "#ffcc00",
  webfetch: "#0099ff",
  list: "#0099ff",
  todowrite: "#888888",
  skill: "#0099ff",
}

function toolColor(tool: string): string {
  const lower = tool.toLowerCase()
  for (const [key, color] of Object.entries(TOOL_COLORS)) {
    if (lower.includes(key)) return color
  }
  return "#888888"
}

function normalizePath(input?: string): string {
  if (!input) return ""
  // If it looks like an absolute path, show the last 2-3 segments to keep it readable
  if (input.startsWith("/")) {
    const parts = input.split("/").filter(Boolean)
    return parts.slice(-3).join("/")
  }
  return input
}

function parseToolEntry(event: LogEvent): LogEntry | null {
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
    const extras = Object.entries(input)
      .filter(([k]) => k !== "filePath")
      .filter(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
      .map(([k, v]) => `${k}=${v}`)
    const description = extras.length ? `[${extras.join(", ")}]` : undefined
    return {
      kind: "tool_use",
      timestamp: event.timestamp,
      tool,
      icon: "→",
      title: `Read ${filePath}`,
      description,
      status,
      errorMessage,
    }
  }

  // write
  if (toolLower === "write" || toolLower.includes("_write") || toolLower.endsWith("write")) {
    const filePath = normalizePath(str(input.filePath))
    const output = str(state?.output)
    return {
      kind: "tool_use",
      timestamp: event.timestamp,
      tool,
      icon: "←",
      title: `Write ${filePath}`,
      blockContent: output || undefined,
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

  // todowrite
  if (toolLower === "todowrite") {
    return {
      kind: "tool_use",
      timestamp: event.timestamp,
      tool,
      icon: "#",
      title: "Todos",
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

function parseEvent(event: LogEvent): LogEntry[] {
  switch (event.type) {
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
      // model ID may be in the event at top level or not present
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

function readLogEntries(repoRoot: string, taskId: string): LogEntry[] {
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

const BLOCK_MAX_LINES = 5

function BlockContent({ content }: { content: string }) {
  const lines = content.split("\n")
  const visible = lines.slice(0, BLOCK_MAX_LINES)
  const overflow = lines.length - BLOCK_MAX_LINES

  return (
    <box
      border={["left"]}
      borderColor="#444444"
      style={{ paddingLeft: 1, marginTop: 0 }}
    >
      {visible.map((line, i) => (
        <text key={i} fg="#888888">{line}</text>
      ))}
      {overflow > 0 ? (
        <text fg="#666666">
          {`... ${overflow} more ${overflow === 1 ? "line" : "lines"}`}
        </text>
      ) : null}
    </box>
  )
}

const DIFF_MAX_LINES = 10

function diffLineColor(line: string): string {
  if (line.startsWith("+")) return "#00cc66"
  if (line.startsWith("-")) return "#cc3333"
  if (line.startsWith("@@")) return "#559999"
  return "#666666"
}

function DiffContent({ diff }: { diff: string }) {
  // Strip the unified diff file header (Index:, ===, ---, +++ lines)
  const lines = diff.split("\n").filter((line) => {
    if (line.startsWith("Index:")) return false
    if (line.startsWith("===")) return false
    if (line.startsWith("--- ")) return false
    if (line.startsWith("+++ ")) return false
    return true
  })

  const nonEmpty = lines.filter((l) => l.trim() !== "")
  const visible = nonEmpty.slice(0, DIFF_MAX_LINES)
  const overflow = nonEmpty.length - DIFF_MAX_LINES

  return (
    <box
      border={["left"]}
      borderColor="#444444"
      style={{ paddingLeft: 1, marginTop: 0 }}
    >
      {visible.map((line, i) => (
        <text key={i} fg={diffLineColor(line)}>{line}</text>
      ))}
      {overflow > 0 ? (
        <text fg="#555555">
          {`... ${overflow} more ${overflow === 1 ? "line" : "lines"}`}
        </text>
      ) : null}
    </box>
  )
}

function PromptRow({ prompt, model }: { prompt: string; model: Task["model"] }) {
  const modelDef = MODELS.find((m) => m.value === model) ?? MODELS[0]!
  return (
    <box
      border={["left"]}
      borderColor={modelDef.color}
      style={{ paddingLeft: 1, paddingRight: 1, flexDirection: "column" }}
    >
      <markdown
        content={prompt}
        syntaxStyle={syntaxStyle}
        style={{ flexGrow: 1, flexShrink: 1 }}
        renderNode={(token, context) => {
          const renderable = context.defaultRender()
          if (renderable && token.type === "paragraph" && "wrapMode" in renderable) {
            (renderable as any).wrapMode = "word"
          }
          return renderable
        }}
      />
      <text> </text>
      <text fg={modelDef.color}>{modelDef.label}</text>
    </box>
  )
}

function TextRow({ entry }: { entry: LogEntry }) {
  return (
    <box style={{ flexDirection: "row" }}>
      <markdown
        content={entry.text ?? ""}
        syntaxStyle={syntaxStyle}
        style={{ flexGrow: 1, flexShrink: 1 }}
        renderNode={(token, context) => {
          const renderable = context.defaultRender()
          if (renderable && token.type === "paragraph" && "wrapMode" in renderable) {
            (renderable as any).wrapMode = "word"
          }
          return renderable
        }}
      />
    </box>
  )
}

function ToolRow({ entry }: { entry: LogEntry }) {
  const color = toolColor(entry.tool ?? "")
  const icon = entry.icon ?? "⚙"
  const title = entry.title ?? entry.tool ?? ""
  const isDone = entry.status === "completed"
  const isError = entry.status === "error"

  const titleAttr = createTextAttributes({ bold: !isDone })
  const iconAttr = undefined

  return (
    <box style={{ flexDirection: "column" }}>
      <box style={{ flexDirection: "row", paddingBottom: 0 }}>
        <text fg={color} attributes={iconAttr} style={{ flexShrink: 0 }}>
          {icon}{" "}
        </text>
        <text fg={color} attributes={titleAttr} style={{ flexShrink: 0 }} truncate>
          {title}
        </text>
        {entry.description ? (
          <>
            <text fg="#555555">{" "}</text>
            <text fg="#777777" truncate>
              {entry.description}
            </text>
          </>
        ) : null}
        {isError && entry.errorMessage ? (
          <text fg="#cc3333" attributes={createTextAttributes({ dim: true })}>
            {" "}{entry.errorMessage}
          </text>
        ) : null}
      </box>
      {entry.blockContent && entry.blockKind === "diff" ? (
        <DiffContent diff={entry.blockContent} />
      ) : entry.blockContent ? (
        <BlockContent content={entry.blockContent} />
      ) : null}
    </box>
  )
}

function StepFinishRow({ entry }: { entry: LogEntry }) {
  const modelLabel = entry.modelId
    ? entry.modelId.replace(/^[^/]+\//, "") // strip provider prefix, e.g. "anthropic/claude-sonnet-4-6" -> "claude-sonnet-4-6"
    : null
  const elapsed = entry.elapsedMs != null ? formatElapsedMs(entry.elapsedMs) : null

  return (
    <box style={{ flexDirection: "row", paddingBottom: 1 }}>
      <text fg="#00cc66">
        {"▣  "}
        {modelLabel ? `${modelLabel} · ` : ""}
        {"done"}
        {elapsed ? ` · ${elapsed}` : ""}
      </text>
    </box>
  )
}

function ReasoningRow({ entry }: { entry: LogEntry }) {
  const text = entry.reasoningText ?? ""
  const summary = `Thinking: ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}`

  return (
    <box
      border={["left"]}
      borderColor="#555555"
      style={{ paddingLeft: 1, marginTop: 0 }}
    >
      <text fg="#666666">
        {summary}
      </text>
    </box>
  )
}

function LogRow({ entry }: { entry: LogEntry }) {
  if (entry.kind === "tool_use") return <ToolRow entry={entry} />
  if (entry.kind === "step_finish") return <StepFinishRow entry={entry} />
  if (entry.kind === "reasoning") return <ReasoningRow entry={entry} />
  return <TextRow entry={entry} />
}

const STATUS_COLOR: Record<TaskStatus, string> = {
  running: "#00aaff",
  done: "#00cc66",
  failed: "#cc3333",
  unknown: "#888888",
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  running: "Running",
  done: "Done",
  failed: "Failed",
  unknown: "Unknown",
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

const STATUS_SYMBOL: Record<TaskStatus, string> = {
  running: SPINNER_FRAMES[0],
  done: "✓",
  failed: "✗",
  unknown: "?",
}

function formatElapsed(startedAt: string, completedAt: string | null, now: number): string {
  const end = completedAt ? new Date(completedAt).getTime() : now
  const elapsed = Math.floor((end - new Date(startedAt).getTime()) / 1000)
  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  return `${mins}m ${String(secs).padStart(2, "0")}s`
}

function formatElapsedMs(ms: number): string {
  const totalSecs = Math.floor(ms / 1000)
  const mins = Math.floor(totalSecs / 60)
  const secs = totalSecs % 60
  if (mins > 0) return `${mins}m ${String(secs).padStart(2, "0")}s`
  return `${secs}s`
}

function TitleBar({ task }: { task: Task }) {
  const [now, setNow] = useState(Date.now())
  const [spinnerFrame, setSpinnerFrame] = useState(0)

  useEffect(() => {
    if (task.completedAt) return
    const interval = setInterval(() => {
      setNow(Date.now())
      setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length)
    }, 100)
    return () => clearInterval(interval)
  }, [task.completedAt])

  const symbol = task.status === "running" ? SPINNER_FRAMES[spinnerFrame] : STATUS_SYMBOL[task.status]

  return (
    <box style={{ flexDirection: "row", justifyContent: "space-between", flexGrow: 1 }}>
      <text>
        <strong fg="#ffffff">{task.id.slice(0, 6)}</strong>
        {"  "}
        <span fg={STATUS_COLOR[task.status]}>{symbol} {STATUS_LABEL[task.status]}</span>
        {"  "}
        <span fg="#555555">{formatElapsed(task.startedAt, task.completedAt, now)}</span>
      </text>
      {task.sessionId ? <text fg="#666666">{task.sessionId}</text> : null}
    </box>
  )
}

interface Props {
  repoRoot: string
  task: Task
}

export function AgentLog({ repoRoot, task }: Props) {
  const taskId = task.id
  const scrollRef = useRef<ScrollBoxRenderable>(null)
  const [entries, setEntries] = useState<LogEntry[]>(() => readLogEntries(repoRoot, taskId))

  useKeyboard((key) => {
    if (!scrollRef.current) return
    if (key.name === "up" || key.name === "k") {
      scrollRef.current.stickyScroll = false
      scrollRef.current.scrollBy(-3, "step")
    } else if (key.name === "down" || key.name === "j") {
      scrollRef.current.scrollBy(3, "step")
    } else if (key.name === "pageup") {
      scrollRef.current.stickyScroll = false
      scrollRef.current.scrollBy(-0.5, "viewport")
    } else if (key.name === "pagedown") {
      scrollRef.current.scrollBy(0.5, "viewport")
    }
  })

  const refresh = useCallback(() => {
    setEntries(readLogEntries(repoRoot, taskId))
  }, [repoRoot, taskId])

  // Reload immediately when the task changes
  useEffect(() => {
    setEntries(readLogEntries(repoRoot, taskId))
  }, [repoRoot, taskId])

  // Watch the log file for changes while the task is running.
  // Falls back to polling if the file doesn't exist yet when the effect fires.
  useEffect(() => {
    const logPath = taskOutputPath(repoRoot, taskId)
    let watcher: FSWatcher | null = null
    let pollInterval: ReturnType<typeof setInterval> | null = null

    const startWatching = () => {
      if (watcher) return
      try {
        watcher = watch(logPath, () => refresh())
      } catch {
        // watch failed, keep polling
      }
    }

    if (existsSync(logPath)) {
      startWatching()
    } else {
      // File doesn't exist yet -- poll until it appears, then switch to watch
      pollInterval = setInterval(() => {
        refresh()
        if (existsSync(logPath)) {
          if (pollInterval) clearInterval(pollInterval)
          pollInterval = null
          startWatching()
        }
      }, 500)
    }

    return () => {
      watcher?.close()
      if (pollInterval) clearInterval(pollInterval)
    }
  }, [repoRoot, taskId, refresh])

  return (
    <box
      style={{ flexDirection: "column", flexGrow: 1, paddingBottom: 1 }}
    >
      <box border={["bottom"]} borderColor="#555555" style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#000000" }}>
        <TitleBar task={task} />
      </box>

      <box style={{ flexGrow: 1, paddingLeft: 2, paddingRight: 2, paddingBottom: 1, overflow: "hidden" }}>
        <scrollbox ref={scrollRef} style={{ flexGrow: 1 }} scrollY scrollX={false} stickyScroll stickyStart="bottom" contentOptions={{ paddingRight: 1 }} viewportOptions={{ maxHeight: "100%" }}>
          <box style={{ flexDirection: "column" }}>
            <PromptRow prompt={task.prompt} model={task.model} />
            <box border={["bottom"]} borderColor="#444444" style={{ marginLeft: 1, marginRight: 1 }} />
            {entries.length === 0 ? (
              <text fg="#555555">No output yet.</text>
            ) : (
              entries.map((entry, i) => (
                <LogRow key={i} entry={entry} />
              ))
            )}
          </box>
        </scrollbox>
      </box>
    </box>
  )
}
