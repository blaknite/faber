import { useCallback, useEffect, useRef, useState } from "react"
import { existsSync, readFileSync, watch } from "node:fs"
import type { FSWatcher } from "node:fs"
import { createTextAttributes, SyntaxStyle } from "@opentui/core"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { taskOutputPath } from "../lib/state.js"
import type { Task, TaskStatus } from "../types.js"

const syntaxStyle = SyntaxStyle.create()

interface LogEvent {
  type: string
  timestamp: number
  part?: {
    tool?: string
    text?: string
    state?: {
      title?: string
      input?: unknown
      status?: string
    }
  }
}

type LogEntryKind = "text" | "tool_use"

interface LogEntry {
  kind: LogEntryKind
  timestamp: number
  // text entries
  text?: string
  // tool_use entries
  tool?: string
  description?: string
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
}

function toolColor(tool: string): string {
  const lower = tool.toLowerCase()
  for (const [key, color] of Object.entries(TOOL_COLORS)) {
    if (lower.includes(key)) return color
  }
  return "#888888"
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  const ss = String(d.getSeconds()).padStart(2, "0")
  return `${hh}:${mm}:${ss}`
}

function parseEvent(event: LogEvent): LogEntry[] {
  switch (event.type) {
    case "text": {
      const text = event.part?.text?.trim()
      if (!text) return []
      return [{ kind: "text", timestamp: event.timestamp, text }]
    }
    case "tool_use": {
      const tool = event.part?.tool
      if (!tool) return []
      const title = event.part?.state?.title
      let description: string | undefined
      if (title) {
        description = title
      } else {
        const input = event.part?.state?.input
        if (input && typeof input === "object") {
          const first = Object.values(input as Record<string, unknown>)[0]
          if (typeof first === "string") description = first.slice(0, 80)
        }
      }
      return [{
        kind: "tool_use",
        timestamp: event.timestamp,
        tool,
        description,
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
  return entries
}

function TextRow({ entry }: { entry: LogEntry }) {
  return (
    <box style={{ flexDirection: "row" }}>
      <text fg="#333333" style={{ width: 10, flexShrink: 0 }}>
        {formatTimestamp(entry.timestamp)}
      </text>
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
  const toolName = entry.tool ?? ""
  return (
    <box style={{ flexDirection: "row", paddingBottom: 0 }}>
      <text fg="#333333" style={{ width: 10, flexShrink: 0 }}>
        {formatTimestamp(entry.timestamp)}
      </text>
      <text fg={color} style={{ flexShrink: 0 }}>{"> "}</text>
      <text fg={color} attributes={createTextAttributes({ bold: true })} style={{ flexShrink: 0 }}>
        {toolName}
      </text>
      {entry.description ? (
        <>
          <text fg="#444444">{" "}</text>
          <text fg="#555555" attributes={createTextAttributes({ dim: true })} truncate>
            {entry.description}
          </text>
        </>
      ) : null}
    </box>
  )
}

function LogRow({ entry }: { entry: LogEntry }) {
  if (entry.kind === "tool_use") return <ToolRow entry={entry} />
  return <TextRow entry={entry} />
}

const STATUS_COLOR: Record<TaskStatus, string> = {
  running: "#00aaff",
  done: "#00cc66",
  failed: "#cc3333",
  unknown: "#888888",
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  running: "running",
  done: "done",
  failed: "failed",
  unknown: "unknown",
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
      {task.sessionId ? <text fg="#444444">{task.sessionId}</text> : null}
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
      style={{ flexDirection: "column", flexGrow: 1, height: "100%" }}
    >
      <box border={["bottom"]} borderColor="#333333" style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#000000" }}>
        <TitleBar task={task} />
      </box>

      {entries.length === 0 ? (
        <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
          <text fg="#333333">No output yet.</text>
        </box>
      ) : (
        <box style={{ flexGrow: 1, paddingLeft: 1, paddingRight: 1, paddingBottom: 1 }}>
          <scrollbox ref={scrollRef} style={{ flexGrow: 1 }} scrollY scrollX={false} stickyScroll stickyStart="bottom">
            <box style={{ flexDirection: "column" }}>
              {entries.map((entry, i) => (
                <LogRow key={i} entry={entry} />
              ))}
            </box>
          </scrollbox>
        </box>
      )}
    </box>
  )
}
