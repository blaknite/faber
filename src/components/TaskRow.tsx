import { createTextAttributes } from "@opentui/core"
import type { BoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import { useState } from "react"
import type { Task } from "../types.js"
import { getModelContextWindow } from "../types.js"
import { useSpinnerFrame } from "../lib/tick.js"
import { STATUS_COLOR, STATUS_LABEL, STATUS_SYMBOL } from "../lib/status.js"
import { formatElapsed, readLogStats } from "../lib/logParser.js"
import { taskOutputPath } from "../lib/state.js"
import { useFileWatch } from "../lib/useFileWatch.js"

// Characters consumed by the layout surrounding the summary text:
//   AgentList outer paddingLeft (1) + AgentList inner paddingLeft (1)
//   + TaskRow border left (1) + TaskRow paddingLeft (1)
//   + summary box border left (1) + summary box paddingLeft (1)
//   + summary box paddingRight (1) + TaskRow paddingRight (1)
//   + AgentList inner paddingRight (1) + AgentList outer paddingRight (1)
//   + scrollbox content paddingRight (1)
const SUMMARY_HORIZONTAL_OVERHEAD = 11

function truncateWithEllipsis(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text
  return text.slice(0, Math.max(0, maxWidth - 1)) + "\u2026"
}

function RunningStatus({ task, selected }: { task: Task; selected: boolean }) {
  const frame = useSpinnerFrame()
  const elapsed = formatElapsed(task.startedAt, null, Date.now())
  return (
    <>
      <span fg={STATUS_COLOR[task.status]}>{selected ? <strong>{frame} {STATUS_LABEL[task.status]}</strong> : <>{frame} {STATUS_LABEL[task.status]}</>}</span>
      {"  "}
      <span>{elapsed}</span>
    </>
  )
}

interface Props {
  task: Task
  index: number
  selected: boolean
  cardRef: (el: BoxRenderable | null) => void
  repoRoot: string
}

function StaticStatus({ task, selected }: { task: Task; selected: boolean }) {
  const symbol = STATUS_SYMBOL[task.status]!
  const elapsed = formatElapsed(task.startedAt, task.completedAt, new Date(task.completedAt!).getTime())
  return (
    <>
      <span fg={STATUS_COLOR[task.status]}>{selected ? <strong>{symbol} {STATUS_LABEL[task.status]}</strong> : <>{symbol} {STATUS_LABEL[task.status]}</>}</span>
      {"  "}
      <span>{elapsed}</span>
    </>
  )
}

export function TaskRow({ task, index, selected, cardRef, repoRoot }: Props) {
  const { width: termWidth } = useTerminalDimensions()
  const [stats, setStats] = useState(() => readLogStats(repoRoot, task.id))

  const logPath = task.completedAt === null ? taskOutputPath(repoRoot, task.id) : ""
  useFileWatch(logPath, () => setStats(readLogStats(repoRoot, task.id)), { pollUntilExists: true })

  const contextPercent = stats.totalTokens > 0
    ? Math.round((stats.totalTokens / getModelContextWindow(task.model)) * 100)
    : null

  const summaryText = truncateWithEllipsis(
    (task.summaryText || task.prompt).split("\n")[0],
    termWidth - SUMMARY_HORIZONTAL_OVERHEAD,
  )

  return (
    <box key={task.id} ref={cardRef} style={{ flexDirection: "column" }}>
      {index > 0 && <box border={["top"]} borderColor="#222222" />}
      <box
        style={{
          flexDirection: "column",
          paddingLeft: 1,
          paddingRight: 1,
          paddingTop: 1,
          paddingBottom: 1,
          backgroundColor: selected ? "#222222" : "#111111",
        }}
        border={["left"]}
        borderColor={selected ? "#ff6600" : "#ffffff"}
      >
        <box style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <text fg={selected ? "#ffffff" : "#666666"}>
            {selected ? <strong>{task.id.slice(0, 6)}</strong> : task.id.slice(0, 6)}
            {"  "}
            {task.completedAt
              ? <StaticStatus task={task} selected={selected} />
              : <RunningStatus task={task} selected={selected} />}
          </text>
          {task.sessionId ? <text fg={selected ? "#555555" : "#333333"}>{task.sessionId}{contextPercent !== null ? ` • ${contextPercent}%` : ""}</text> : null}
        </box>
        <box
          border={["left"]}
          borderColor="#ffffff"
          style={{ marginTop: 1, paddingLeft: 1, paddingRight: 1 }}
        >
          <text fg={selected ? "#aaaaaa" : "#444444"} attributes={createTextAttributes({ italic: true })} wrapMode="none">{summaryText}</text>
        </box>
      </box>
    </box>
  )
}
