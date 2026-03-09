import { useCallback, useEffect, useRef, useState } from "react"
import { useSpinnerFrame } from "../lib/tick.js"
import { STATUS_COLOR, STATUS_LABEL, STATUS_SYMBOL } from "../lib/status.js"
import { useFileWatch } from "../lib/useFileWatch.js"
import { createTextAttributes, SyntaxStyle } from "@opentui/core"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { taskOutputPath } from "../lib/state.js"
import {
  readLogEntries,
  readLogStats,
  formatElapsed,
  formatElapsedMs,
} from "../lib/logParser.js"
import type { LogEntry } from "../lib/logParser.js"
import { MODELS, getModelContextWindow } from "../types.js"
import type { Task } from "../types.js"
import { parseDiff, highlightLinePair, highlightSingleLine, SegmentedLine } from "../lib/diff/index.js"
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

const HEAVY_TOOLS = new Set(["bash", "edit", "write", "todowrite"])

function isHeavyTool(tool: string): boolean {
  const lower = tool.toLowerCase()
  for (const key of HEAVY_TOOLS) {
    if (lower.includes(key)) return true
  }
  return false
}

const BLOCK_MAX_LINES = 5

function BlockContent({ content, unlimited = false }: { content: string; unlimited?: boolean }) {
  const lines = content.split("\n")
  const visible = unlimited ? lines : lines.slice(0, BLOCK_MAX_LINES)
  const overflow = unlimited ? 0 : lines.length - BLOCK_MAX_LINES

  return (
    <box style={{ paddingLeft: 1, marginTop: 0 }}>
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
    <box style={{ paddingLeft: 1, marginTop: 0 }}>
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
              <SegmentedLine
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
            <SegmentedLine
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


function PromptLogRow({ entry, model }: { entry: LogEntry; model: Task["model"] }) {
  // Prefer the model stored in the log entry (set at prompt time) so that each
  // prompt row reflects the model it was actually sent with, not whatever model
  // the task was last run with. Fall back to task.model for older log entries
  // that predate this field.
  const resolvedModel = (entry.model as Task["model"]) ?? model
  const modelDef = MODELS.find((m) => m.value === resolvedModel) ?? MODELS[0]!
  return (
    <box style={{ paddingBottom: 1 }}>
      <box style={{ paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1, backgroundColor: "#111111" }}>
        <box
          border={["left"]}
          borderColor={modelDef.color}
          style={{ paddingLeft: 1, paddingRight: 1, flexDirection: "column" }}
        >
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
          <text> </text>
          <text fg={modelDef.color}>{modelDef.label}</text>
        </box>
      </box>
    </box>
  )
}

function TextRow({ entry }: { entry: LogEntry }) {
  return (
    <box style={{ flexDirection: "row", paddingBottom: 1 }}>
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
  const heavy = isHeavyTool(entry.tool ?? "")

  const titleAttr = createTextAttributes({ bold: !isDone })

  const header = (
    <box style={{ flexDirection: "row", paddingBottom: 0 }}>
      <text fg={color} style={{ flexShrink: 0 }}>
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
    </box>
  )

  const body = (
    <>
      {entry.command ? (
        <box style={{ paddingLeft: 1, marginTop: 0 }}>
          {entry.command.split("\n").map((line, i) => (
            <text key={i} fg="#888888">{i === 0 ? `$ ${line}` : line}</text>
          ))}
        </box>
      ) : null}
      {isError && entry.errorMessage ? (
        <BlockContent content={entry.errorMessage} />
      ) : entry.blockContent && entry.blockKind === "diff" ? (
        <DiffContent diff={entry.blockContent} />
      ) : entry.blockContent ? (
        <BlockContent content={entry.blockContent} unlimited={entry.tool === "todowrite"} />
      ) : null}
    </>
  )

  return (
    <box style={{ paddingBottom: 1 }}>
      <box style={{ paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1, backgroundColor: heavy ? "#111111" : undefined }}>
        <box
          border={["left"]}
          borderColor={heavy ? "#444444" : "#222222"}
          style={{ paddingLeft: 1, paddingRight: 1, flexDirection: "column" }}
        >
          {header}
          {heavy ? body : null}
        </box>
      </box>
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

function LogRow({ entry, model }: { entry: LogEntry; model: Task["model"] }) {
  if (entry.kind === "prompt") return <PromptLogRow entry={entry} model={model} />
  if (entry.kind === "tool_use") return <ToolRow entry={entry} />
  if (entry.kind === "step_finish") return <StepFinishRow entry={entry} />
  if (entry.kind === "reasoning") return <ReasoningRow entry={entry} />
  return <TextRow entry={entry} />
}


function RunningStatus({ task }: { task: Task }) {
  const frame = useSpinnerFrame()
  const elapsed = formatElapsed(task.startedAt, null, Date.now())
  return (
    <>
      <span fg={STATUS_COLOR[task.status]}>{frame} {STATUS_LABEL[task.status]}</span>
      {"  "}
      <span fg="#555555">{elapsed}</span>
    </>
  )
}

function StaticStatus({ task }: { task: Task }) {
  const symbol = STATUS_SYMBOL[task.status]!
  const elapsed = formatElapsed(task.startedAt, task.completedAt, new Date(task.completedAt!).getTime())
  return (
    <>
      <span fg={STATUS_COLOR[task.status]}>{symbol} {STATUS_LABEL[task.status]}</span>
      {"  "}
      <span fg="#555555">{elapsed}</span>
    </>
  )
}

function TitleBar({ task, repoRoot }: { task: Task; repoRoot: string }) {
  const stats = readLogStats(repoRoot, task.id)
  const contextPercent = stats.totalTokens > 0
    ? Math.round((stats.totalTokens / getModelContextWindow(task.model)) * 100)
    : null

  return (
    <box style={{ flexDirection: "row", justifyContent: "space-between", flexGrow: 1 }}>
      <text>
        <strong fg="#ffffff">{task.id.slice(0, 6)}</strong>
        {"  "}
        {task.completedAt
          ? <StaticStatus task={task} />
          : <RunningStatus task={task} />}
      </text>
      <text fg="#666666">
        {[
          task.sessionId ?? null,
          contextPercent !== null ? `${contextPercent}%` : null,
          stats.totalCost > 0 ? `$${stats.totalCost.toFixed(2)}` : null,
        ].filter(Boolean).join(" • ")}
      </text>
    </box>
  )
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

  // Watch the log file for changes while the task is running. Uses pollUntilExists
  // because the log file may not exist when the component first mounts.
  useFileWatch(taskOutputPath(repoRoot, taskId), refresh, { pollUntilExists: true })

  return (
    <box
      style={{ flexDirection: "column", flexGrow: 1, paddingBottom: 1 }}
    >
      <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#111111", marginBottom: 1 }}>
        <TitleBar task={task} repoRoot={repoRoot} />
      </box>

      <box style={{ flexGrow: 1, paddingLeft: 2, paddingRight: 2, paddingBottom: 1, overflow: "hidden" }}>
        <scrollbox ref={scrollRef} style={{ flexGrow: 1 }} scrollY scrollX={false} stickyScroll stickyStart="bottom" contentOptions={{ paddingRight: 1 }} viewportOptions={{ maxHeight: "100%" }}>
          <box style={{ flexDirection: "column" }}>
            {entries.length === 0 ? (
              <text fg="#555555">No output yet.</text>
            ) : (
              entries.map((entry, i) => (
                <LogRow key={i} entry={entry} model={task.model} />
              ))
            )}
          </box>
        </scrollbox>
      </box>
    </box>
  )
}
