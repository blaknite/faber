import { createTextAttributes } from "@opentui/core"
import type { BoxRenderable } from "@opentui/core"
import type { Task, TaskStatus } from "../types.js"
import { useTick, SPINNER_FRAMES } from "../lib/tick.js"

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

interface Props {
  task: Task
  index: number
  selected: boolean
  cardRef: (el: BoxRenderable | null) => void
}

function RunningTaskRow({ task, index, selected, cardRef }: Props) {
  const tick = useTick()
  const now = Date.now()
  const spinnerFrame = tick % SPINNER_FRAMES.length
  const symbol = SPINNER_FRAMES[spinnerFrame]!

  return (
    <TaskRowInner task={task} index={index} selected={selected} cardRef={cardRef} symbol={symbol} now={now} />
  )
}

function StaticTaskRow({ task, index, selected, cardRef }: Props) {
  const now = new Date(task.completedAt!).getTime()
  const symbol = STATUS_SYMBOL[task.status]!

  return (
    <TaskRowInner task={task} index={index} selected={selected} cardRef={cardRef} symbol={symbol} now={now} />
  )
}

interface InnerProps extends Props {
  symbol: string
  now: number
}

function TaskRowInner({ task, index, selected, cardRef, symbol, now }: InnerProps) {
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
            <span fg={STATUS_COLOR[task.status]}>{selected ? <strong>{symbol} {STATUS_LABEL[task.status]}</strong> : <>{symbol} {STATUS_LABEL[task.status]}</>}</span>
            {"  "}
            <span>{formatElapsed(task.startedAt, task.completedAt, now)}</span>
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

export function TaskRow(props: Props) {
  return props.task.completedAt
    ? <StaticTaskRow {...props} />
    : <RunningTaskRow {...props} />
}
