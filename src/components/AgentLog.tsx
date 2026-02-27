import { useCallback, useEffect, useRef, useState } from "react"
import { useTick, SPINNER_FRAMES as TICK_SPINNER_FRAMES } from "../lib/tick.js"
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
import { parseDiff, highlightLinePair, highlightSingleLine } from "../lib/diff/index.js"
import type { DiffLine, Segment } from "../lib/diff/index.js"
import { colors as diffColors } from "../lib/diff/DiffViewer.style.js"

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

function DiffSegmentedLine({ segments, baseColor, highlightBg }: {
  segments: Segment[]
  baseColor: string
  highlightBg: string
}) {
  if (segments.length === 0) return <text fg={baseColor}>{" "}</text>
  return (
    <text fg={baseColor}>
      {segments.map((seg, i) =>
        seg.isChanged ? (
          <span key={i} fg={baseColor} bg={highlightBg}>{seg.text || " "}</span>
        ) : (
          <span key={i} fg={baseColor}>{seg.text || " "}</span>
        )
      )}
    </text>
  )
}

function DiffContent({ diff }: { diff: string }) {
  const parsed = parseDiff(diff)

  // Flatten all diff lines across all files and hunks into a simple list for
  // the inline preview, then cap at DIFF_MAX_LINES.
  type PreviewLine =
    | { kind: "hunk"; header: string }
    | { kind: "context"; line: DiffLine }
    | { kind: "remove"; line: DiffLine; segments: Segment[] }
    | { kind: "add"; line: DiffLine; segments: Segment[] }

  const previewLines: PreviewLine[] = []

  for (const file of parsed.files) {
    for (const hunk of file.hunks) {
      previewLines.push({ kind: "hunk", header: hunk.header })

      let i = 0
      const lines = hunk.lines

      while (i < lines.length && previewLines.length < DIFF_MAX_LINES) {
        const line = lines[i]!

        if (line.type === "context") {
          previewLines.push({ kind: "context", line })
          i++
          continue
        }

        // Collect a block of removes followed by adds for character highlighting
        const removeBlock: DiffLine[] = []
        const addBlock: DiffLine[] = []

        while (i < lines.length && lines[i]!.type === "remove") {
          removeBlock.push(lines[i]!)
          i++
        }
        while (i < lines.length && lines[i]!.type === "add") {
          addBlock.push(lines[i]!)
          i++
        }

        const count = Math.max(removeBlock.length, addBlock.length)
        for (let j = 0; j < count && previewLines.length < DIFF_MAX_LINES; j++) {
          const rem = removeBlock[j]
          const add = addBlock[j]

          if (rem && add) {
            const { old: oldSegs, new: newSegs } = highlightLinePair(rem.content, add.content)
            previewLines.push({ kind: "remove", line: rem, segments: oldSegs })
            previewLines.push({ kind: "add", line: add, segments: newSegs })
          } else if (rem) {
            previewLines.push({ kind: "remove", line: rem, segments: highlightSingleLine(rem.content) })
          } else if (add) {
            previewLines.push({ kind: "add", line: add, segments: highlightSingleLine(add.content) })
          }
        }
      }

      if (previewLines.length >= DIFF_MAX_LINES) break
    }
  }

  // Count total lines for overflow message
  const totalLines = parsed.files.reduce(
    (sum, f) => sum + f.hunks.reduce((hs, h) => hs + h.lines.length, 0),
    0
  )
  const overflow = totalLines - previewLines.filter((l) => l.kind !== "hunk").length

  return (
    <box
      border={["left"]}
      borderColor="#444444"
      style={{ paddingLeft: 1, marginTop: 0 }}
    >
      {previewLines.map((item, i) => {
        if (item.kind === "hunk") {
          return <text key={i} fg={diffColors.header}>{item.header}</text>
        }
        if (item.kind === "context") {
          return <text key={i} fg={diffColors.context}>{item.line.content}</text>
        }
        if (item.kind === "remove") {
          return (
            <box key={i} style={{ flexDirection: "row", backgroundColor: diffColors.removeRow }}>
              <text fg={diffColors.remove}>{"-"}</text>
              <DiffSegmentedLine
                segments={item.segments}
                baseColor={diffColors.remove}
                highlightBg={diffColors.removeHighlight}
              />
            </box>
          )
        }
        // add
        return (
          <box key={i} style={{ flexDirection: "row", backgroundColor: diffColors.addRow }}>
            <text fg={diffColors.add}>{"+"}</text>
            <DiffSegmentedLine
              segments={item.segments}
              baseColor={diffColors.add}
              highlightBg={diffColors.addHighlight}
            />
          </box>
        )
      })}
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
    <box style={{ paddingBottom: 1 }}>
      <box style={{ paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1, backgroundColor: "#111111" }}>
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
      </box>
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
  ready_to_merge: "#ff9900",
  failed: "#cc3333",
  unknown: "#888888",
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  running: "Running",
  done: "Done",
  ready_to_merge: "Ready to merge",
  failed: "Failed",
  unknown: "Unknown",
}

const STATUS_SYMBOL: Record<TaskStatus, string> = {
  running: TICK_SPINNER_FRAMES[0]!,
  done: "✓",
  ready_to_merge: "↑",
  failed: "✗",
  unknown: "?",
}

function TitleBarInner({ task, symbol, now }: { task: Task; symbol: string; now: number }) {
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

function RunningTitleBar({ task }: { task: Task }) {
  const tick = useTick()
  const now = Date.now()
  const symbol = TICK_SPINNER_FRAMES[tick % TICK_SPINNER_FRAMES.length]!
  return <TitleBarInner task={task} symbol={symbol} now={now} />
}

function StaticTitleBar({ task }: { task: Task }) {
  const now = new Date(task.completedAt!).getTime()
  const symbol = STATUS_SYMBOL[task.status]!
  return <TitleBarInner task={task} symbol={symbol} now={now} />
}

function TitleBar({ task }: { task: Task }) {
  return task.completedAt
    ? <StaticTitleBar task={task} />
    : <RunningTitleBar task={task} />
}

interface Props {
  repoRoot: string
  task: Task
  disabled?: boolean
}

export function AgentLog({ repoRoot, task, disabled }: Props) {
  const taskId = task.id
  const scrollRef = useRef<ScrollBoxRenderable>(null)
  const [entries, setEntries] = useState<LogEntry[]>(() => readLogEntries(repoRoot, taskId))

  useKeyboard((key) => {
    if (disabled || !scrollRef.current) return
    if (key.name === "up" || key.name === "k") {
      scrollRef.current.scrollBy(-3, "step")
    } else if (key.name === "down" || key.name === "j") {
      scrollRef.current.scrollBy(3, "step")
    } else if (key.name === "pageup") {
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
      <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#111111", marginBottom: 1 }}>
        <TitleBar task={task} />
      </box>

      <box style={{ flexGrow: 1, paddingLeft: 2, paddingRight: 2, paddingBottom: 1, overflow: "hidden" }}>
        <scrollbox ref={scrollRef} style={{ flexGrow: 1 }} scrollY scrollX={false} stickyScroll stickyStart="bottom" contentOptions={{ paddingRight: 1 }} viewportOptions={{ maxHeight: "100%" }}>
          <box style={{ flexDirection: "column" }}>
            <PromptRow prompt={task.prompt} model={task.model} />
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
