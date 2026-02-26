import { useCallback, useEffect, useState } from "react"
import { existsSync, readFileSync, watch } from "node:fs"
import type { FSWatcher } from "node:fs"
import { createTextAttributes } from "@opentui/core"
import { taskOutputPath } from "../lib/state.js"

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
      // Split long text into lines, preserving natural newlines
      const lines = text.split("\n").flatMap((line) => {
        if (!line.trim()) return []
        // Wrap lines longer than 110 chars
        const chunks = line.match(/.{1,110}/g) ?? [line]
        return chunks.map((chunk): LogEntry => ({
          kind: "text",
          timestamp: event.timestamp,
          text: chunk,
        }))
      })
      return lines
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
    <box style={{ flexDirection: "row", paddingBottom: 0 }}>
      <text fg="#333333" style={{ width: 10, flexShrink: 0 }}>
        {formatTimestamp(entry.timestamp)}
      </text>
      <text fg="#444444" style={{ width: 2, flexShrink: 0 }}>{"  "}</text>
      <text fg="#999999">{entry.text}</text>
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
      <text fg={color} style={{ width: 2, flexShrink: 0 }}>{">"}</text>
      <text fg="#555555">{" "}</text>
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

interface Props {
  repoRoot: string
  taskId: string
}

export function AgentLog({ repoRoot, taskId }: Props) {
  const [entries, setEntries] = useState<LogEntry[]>(() => readLogEntries(repoRoot, taskId))

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
      border={["left"]}
      borderColor="#333333"
      style={{ flexDirection: "column", width: "60%", height: "100%" }}
    >
      <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222" }}>
        <text fg="#555555">log  </text>
        <text fg="#333333">{taskId}</text>
      </box>

      {entries.length === 0 ? (
        <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
          <text fg="#333333">No output yet.</text>
        </box>
      ) : (
        <box style={{ flexGrow: 1, paddingTop: 1, paddingLeft: 1, paddingRight: 1 }}>
          <scrollbox style={{ flexGrow: 1 }} scrollY scrollX={false} stickyScroll stickyStart="bottom" viewportOptions={{ maxHeight: "100%" }} contentOptions={{ paddingBottom: 1 }}>
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
