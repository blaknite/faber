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
  summarizeErrorEntry,
} from "../lib/logParser.js"
import type { LogEntry } from "../lib/logParser.js"
import { TIERS, DEFAULT_TIER } from "../types.js"
import type { Task, Tier } from "../types.js"
import type { AgentConfig } from "../lib/config.js"
import { tierForModel, getModelContextWindow } from "../lib/config.js"
import { DiffViewer, countDiffLines } from "../lib/diff/index.js"

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
  const [expanded, setExpanded] = useState(false)
  const [hovered, setHovered] = useState(false)
  const lines = content.split("\n")
  const hasOverflow = !unlimited && lines.length > BLOCK_MAX_LINES
  const visible = unlimited || expanded ? lines : lines.slice(0, BLOCK_MAX_LINES)
  const overflow = hasOverflow ? lines.length - BLOCK_MAX_LINES : 0

  return (
    <box style={{ paddingLeft: 1, marginTop: 0 }}>
      {visible.map((line, i) => (
        <text key={i} fg="#888888">{line}</text>
      ))}
      {hasOverflow ? (
        <text
          fg={hovered ? "#888888" : "#666666"}
          selectable={false}
          onMouseDown={() => setExpanded((e) => !e)}
          onMouseOver={() => setHovered(true)}
          onMouseOut={() => setHovered(false)}
        >
          {expanded ? "▾ collapse" : `▸ ${overflow} more ${overflow === 1 ? "line" : "lines"}`}
        </text>
      ) : null}
    </box>
  )
}

const DIFF_MAX_LINES = 10

function DiffContent({ diff }: { diff: string }) {
  const [expanded, setExpanded] = useState(false)
  const [hovered, setHovered] = useState(false)

  const totalLines = countDiffLines(diff)
  const maxLines = expanded ? totalLines : DIFF_MAX_LINES
  const overflow = totalLines - Math.min(totalLines, DIFF_MAX_LINES)

  const toggleProps = {
    fg: hovered ? "#888888" : "#555555",
    selectable: false,
    onMouseDown: () => setExpanded((e) => !e),
    onMouseOver: () => setHovered(true),
    onMouseOut: () => setHovered(false),
  }

  return (
    <box style={{ paddingLeft: 1, marginTop: 0 }}>
      <DiffViewer
        diff={diff}
        viewMode="side-by-side"
        embedded
        maxLines={maxLines}
      />
      {overflow > 0 && !expanded ? (
        <text {...toggleProps}>
          {`▸ ${overflow} more ${overflow === 1 ? "line" : "lines"}`}
        </text>
      ) : expanded ? (
        <text {...toggleProps}>
          {"▾ collapse"}
        </text>
      ) : null}
    </box>
  )
}


function PromptLogRow({ entry, tier }: { entry: LogEntry; tier: Tier }) {
  const meta = TIERS[tier]
  return (
    <box style={{ paddingBottom: 1 }}>
      <box style={{ paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1, backgroundColor: "#111111" }}>
        <box
          border={["left"]}
          borderColor={meta.color}
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
          <text fg={meta.color}>{meta.label}</text>
        </box>
      </box>
    </box>
  )
}

function TextRow({ entry }: { entry: LogEntry }) {
  return (
    <box style={{ flexDirection: "row", paddingBottom: 1, paddingLeft: 3 }}>
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
    <box style={{ flexDirection: "row" }}>
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

  if (heavy) {
    return (
      <box style={{ paddingBottom: 1 }}>
        <box style={{ paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1, backgroundColor: "#111111" }}>
          <box
            border={["left"]}
            borderColor="#444444"
            style={{ paddingLeft: 1, paddingRight: 1, flexDirection: "column" }}
          >
            {header}
            <box style={{ marginTop: 1 }}>
              {body}
            </box>
          </box>
        </box>
      </box>
    )
  }

  return (
    <box style={{ paddingBottom: 1, paddingLeft: 2 }}>
      {header}
    </box>
  )
}

export function sumRoundElapsed(entries: LogEntry[], boundaryIndex: number): number {
  let total = 0
  for (let i = boundaryIndex; i >= 0; i--) {
    if (entries[i].kind === "prompt") break
    if (entries[i].kind === "step_finish" && entries[i].elapsedMs != null) {
      total += entries[i].elapsedMs!
    }
  }
  return total
}

export function shouldShowStepFinish(
  entries: LogEntry[],
  index: number,
  taskRunning: boolean,
): boolean {
  for (let i = index + 1; i < entries.length; i++) {
    if (entries[i].kind === "prompt") return true   // round is complete, and we're the last step before it
    if (entries[i].kind === "step_finish") return false // a later step_finish exists in this round
  }
  // End of entries — only show if the task is no longer running
  return !taskRunning
}

function StepFinishRow({ entry, elapsed }: { entry: LogEntry; elapsed: number }) {
  const modelLabel = entry.modelId
    ? entry.modelId.replace(/^[^/]+\//, "") // strip provider prefix, e.g. "anthropic/claude-sonnet-4-6" -> "claude-sonnet-4-6"
    : null

  return (
    <box style={{ flexDirection: "row", paddingBottom: 1, paddingLeft: 3 }}>
      <text fg="#00cc66">
        {"▣  "}
        {modelLabel ? `${modelLabel} · ` : ""}
        {"done"}
        {elapsed > 0 ? ` · ${formatElapsedMs(elapsed)}` : ""}
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

function ErrorRow({ entry }: { entry: LogEntry }) {
  const title = entry.errorName?.trim() || "Error"
  const message = entry.errorMessage?.trim()
  const summary = summarizeErrorEntry(entry)

  return (
    <box style={{ paddingBottom: 1 }}>
      <box style={{ paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1, backgroundColor: "#1a1010" }}>
        <box
          border={["left"]}
          borderColor="#cc3333"
          style={{ paddingLeft: 1, paddingRight: 1, flexDirection: "column" }}
        >
          <text fg="#ff6666">{message ? `! ${title}` : `! ${summary}`}</text>
          {message ? <BlockContent content={message} unlimited /> : null}
        </box>
      </box>
    </box>
  )
}

function LogRow({ entry, index, entries, model, taskStatus, loadedConfig }: { entry: LogEntry; index: number; entries: LogEntry[]; model: Task["model"]; taskStatus: Task["status"]; loadedConfig: AgentConfig }) {
  if (entry.kind === "prompt") {
    const resolvedModel = (entry.model as Task["model"]) ?? model
    const tier = tierForModel(resolvedModel, loadedConfig) ?? DEFAULT_TIER
    return <PromptLogRow entry={entry} tier={tier} />
  }
  if (entry.kind === "tool_use") return <ToolRow entry={entry} />
  if (entry.kind === "error") return <ErrorRow entry={entry} />
  if (entry.kind === "step_finish") {
    if (shouldShowStepFinish(entries, index, taskStatus === "running")) {
      const elapsed = sumRoundElapsed(entries, index)
      return <StepFinishRow entry={entry} elapsed={elapsed} />
    }
    return null
  }
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

function TitleBar({ task, repoRoot, loadedConfig }: { task: Task; repoRoot: string; loadedConfig: AgentConfig }) {
  const stats = readLogStats(repoRoot, task.id)
  const contextPercent = stats.totalTokens > 0
    ? Math.round((stats.totalTokens / getModelContextWindow(task.model, loadedConfig)) * 100)
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
  loadedConfig: AgentConfig
}

export function AgentLog({ repoRoot, task, disabled, loadedConfig }: Props) {
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
        <TitleBar task={task} repoRoot={repoRoot} loadedConfig={loadedConfig} />
      </box>

      <box style={{ flexGrow: 1, paddingLeft: 2, paddingRight: 2, paddingBottom: 1, overflow: "hidden" }}>
        <scrollbox ref={scrollRef} style={{ flexGrow: 1 }} scrollY scrollX={false} stickyScroll stickyStart="bottom" contentOptions={{ paddingRight: 1 }} viewportOptions={{ maxHeight: "100%" }}>
          <box style={{ flexDirection: "column" }}>
            {entries.length === 0 ? (
              <text fg="#555555">No output yet.</text>
            ) : (
              entries.map((entry, i) => (
                <LogRow key={i} entry={entry} index={i} entries={entries} model={task.model} taskStatus={task.status} loadedConfig={loadedConfig} />
              ))
            )}
          </box>
        </scrollbox>
      </box>
    </box>
  )
}
