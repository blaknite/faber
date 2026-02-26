import { useCallback, useEffect, useRef, useState } from "react"
import { existsSync, readFileSync } from "node:fs"
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

function formatEvent(event: LogEvent): string | null {
  switch (event.type) {
    case "text": {
      const text = event.part?.text?.trim()
      if (!text) return null
      return text
    }
    case "tool_use": {
      const tool = event.part?.tool
      if (!tool) return null
      const title = event.part?.state?.title
      if (title) return `[${tool}] ${title}`
      const input = event.part?.state?.input
      if (input && typeof input === "object") {
        const first = Object.values(input as Record<string, unknown>)[0]
        if (typeof first === "string") return `[${tool}] ${first.slice(0, 80)}`
      }
      return `[${tool}]`
    }
    case "step_start":
      return null
    case "step_finish":
      return null
    default:
      return null
  }
}

function readLogLines(repoRoot: string, taskId: string): string[] {
  const path = taskOutputPath(repoRoot, taskId)
  if (!existsSync(path)) return []
  const raw = readFileSync(path, "utf8")
  const lines: string[] = []
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const event = JSON.parse(trimmed) as LogEvent
      const formatted = formatEvent(event)
      if (formatted) {
        // Wrap long text entries into multiple display lines
        const chunks = formatted.match(/.{1,120}/g) ?? [formatted]
        lines.push(...chunks)
      }
    } catch {
      // skip unparseable lines
    }
  }
  return lines
}

interface Props {
  repoRoot: string
  taskId: string
  isRunning: boolean
}

export function AgentLog({ repoRoot, taskId, isRunning }: Props) {
  const [lines, setLines] = useState<string[]>(() => readLogLines(repoRoot, taskId))
  const prevTaskIdRef = useRef(taskId)

  const refresh = useCallback(() => {
    setLines(readLogLines(repoRoot, taskId))
  }, [repoRoot, taskId])

  // When the task changes, reload immediately
  useEffect(() => {
    if (prevTaskIdRef.current !== taskId) {
      prevTaskIdRef.current = taskId
      setLines(readLogLines(repoRoot, taskId))
    }
  }, [repoRoot, taskId])

  // Poll while the task is running
  useEffect(() => {
    if (!isRunning) return
    const interval = setInterval(refresh, 1000)
    return () => clearInterval(interval)
  }, [isRunning, refresh])

  return (
    <box
      border={["left"]}
      borderColor="#333333"
      style={{ flexDirection: "column", width: "50%", height: "100%" }}
    >
      <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222" }}>
        <text fg="#555555">log  </text>
        <text fg="#333333">{taskId}</text>
      </box>

      {lines.length === 0 ? (
        <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
          <text fg="#333333">No output yet.</text>
        </box>
      ) : (
        <scrollbox style={{ flexGrow: 1 }} scrollY scrollX={false} stickyScroll stickyStart="bottom">
          <box style={{ flexDirection: "column", paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1 }}>
            {lines.map((line, i) => (
              <text key={i} fg="#666666">{line}</text>
            ))}
          </box>
        </scrollbox>
      )}
    </box>
  )
}
