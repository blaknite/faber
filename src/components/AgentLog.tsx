import { useCallback, useEffect, useRef, useState } from "react"
import { existsSync, statSync, watch } from "node:fs"
import type { FSWatcher } from "node:fs"
import { createTextAttributes, SyntaxStyle } from "@opentui/core"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { taskOutputPath } from "../lib/state.js"
import {
  readLogEntries,
  formatElapsed,
  formatElapsedMs,
} from "../lib/logParser.js"
import type { LogEntry } from "../lib/logParser.js"
import { MODELS } from "../types.js"
import type { Task, TaskStatus } from "../types.js"

const syntaxStyle = SyntaxStyle.create()

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
  //
  // fs.watch() (FSEvents on macOS) can silently stop delivering notifications
  // under high I/O load or after rapid successive writes. To guard against
  // that, a watchdog interval runs alongside the watcher. If the file's mtime
  // has moved forward since the last time we refreshed but the watcher hasn't
  // fired, the watchdog calls refresh() itself and tears down the dead watcher
  // so it can be recreated on the next tick.
  useEffect(() => {
    const logPath = taskOutputPath(repoRoot, taskId)
    let watcher: FSWatcher | null = null
    let pollInterval: ReturnType<typeof setInterval> | null = null
    let watchdogInterval: ReturnType<typeof setInterval> | null = null
    let lastRefreshedMtime = 0

    const doRefresh = () => {
      try {
        lastRefreshedMtime = existsSync(logPath) ? statSync(logPath).mtimeMs : 0
      } catch {
        lastRefreshedMtime = 0
      }
      refresh()
    }

    const startWatching = () => {
      if (watcher) return
      try {
        watcher = watch(logPath, doRefresh)
        watcher.on("error", () => {
          // Watcher died -- close it and let the watchdog recreate it
          watcher?.close()
          watcher = null
        })
      } catch {
        // watch() call itself failed, keep polling
      }
    }

    const startWatchdog = () => {
      if (watchdogInterval) return
      watchdogInterval = setInterval(() => {
        if (!existsSync(logPath)) return

        let currentMtime = 0
        try {
          currentMtime = statSync(logPath).mtimeMs
        } catch {
          return
        }

        // If the file has changed but the watcher hasn't fired since our last
        // refresh, the watcher is probably stuck. Refresh manually and
        // recreate the watcher.
        if (currentMtime > lastRefreshedMtime) {
          doRefresh()
          if (watcher) {
            watcher.close()
            watcher = null
          }
          startWatching()
        }

        // If the watcher is missing for any reason, recreate it.
        if (!watcher) {
          startWatching()
        }
      }, 1000)
    }

    if (existsSync(logPath)) {
      startWatching()
    } else {
      // File doesn't exist yet -- poll until it appears, then switch to watch
      pollInterval = setInterval(() => {
        doRefresh()
        if (existsSync(logPath)) {
          if (pollInterval) clearInterval(pollInterval)
          pollInterval = null
          startWatching()
        }
      }, 500)
    }

    startWatchdog()

    return () => {
      watcher?.close()
      if (pollInterval) clearInterval(pollInterval)
      if (watchdogInterval) clearInterval(watchdogInterval)
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
