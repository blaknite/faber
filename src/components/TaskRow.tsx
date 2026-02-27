import { createTextAttributes } from "@opentui/core"
import type { BoxRenderable } from "@opentui/core"
import type { Task, TaskStatus } from "../types.js"
import { useSpinnerFrame, SPINNER_FRAMES } from "../lib/tick.js"

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
  running: SPINNER_FRAMES[0]!,
  done: "✓",
  ready_to_merge: "↑",
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

export function TaskRow({ task, index, selected, cardRef }: Props) {
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
          {task.sessionId ? <text fg={selected ? "#555555" : "#333333"}>{task.sessionId}</text> : null}
        </box>
        <box
          border={["left"]}
          borderColor="#ffffff"
          style={{ marginTop: 1, paddingLeft: 1 }}
        >
          <text fg={selected ? "#aaaaaa" : "#444444"} attributes={createTextAttributes({ italic: true })} truncate>{task.prompt.split("\n").slice(0, 5).join("\n")}</text>
        </box>
      </box>
    </box>
  )
}
