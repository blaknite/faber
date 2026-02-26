import { useEffect, useRef, useState } from "react"
import { createTextAttributes } from "@opentui/core"
import type { ScrollBoxRenderable } from "@opentui/core"
import type { Task, TaskStatus } from "../types.js"

interface Props {
  tasks: Task[]
  selectedId: string | null
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

// Each task card is: paddingTop(1) + status line(1) + marginTop(1) + prompt line(1) + paddingBottom(1) = 5 rows
// Plus a 1-row separator border between cards (for i > 0)
const CARD_HEIGHT = 5
const SEPARATOR_HEIGHT = 1

function rowOffset(index: number): number {
  // outer paddingTop(1) + sum of all preceding cards + their separators
  return 1 + index * CARD_HEIGHT + Math.max(0, index) * SEPARATOR_HEIGHT
}

function formatElapsed(startedAt: string, completedAt: string | null, now: number): string {
  const end = completedAt ? new Date(completedAt).getTime() : now
  const elapsed = Math.floor((end - new Date(startedAt).getTime()) / 1000)
  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  return `${mins}m ${String(secs).padStart(2, "0")}s`
}

function TaskRow({ task, selected }: { task: Task; selected: boolean }) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (task.completedAt) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [task.completedAt])

  return (
    <text fg={selected ? "#ffffff" : "#666666"}>
      {selected ? <strong>{task.id.slice(0, 6)}</strong> : task.id.slice(0, 6)}
      {"  "}
      <span fg={STATUS_COLOR[task.status]}>{STATUS_LABEL[task.status]}</span>
      {"  "}
      <span fg="#555555">{formatElapsed(task.startedAt, task.completedAt, now)}</span>
      {task.sessionId ? <span fg="#444444">{"  "}{task.sessionId}</span> : null}
    </text>
  )
}

export function AgentList({ tasks, selectedId }: Props) {
  const scrollRef = useRef<ScrollBoxRenderable>(null)

  useEffect(() => {
    if (!scrollRef.current || !selectedId) return
    const index = tasks.findIndex((t) => t.id === selectedId)
    if (index === -1) return

    const scrollbox = scrollRef.current
    const top = rowOffset(index)
    const bottom = top + CARD_HEIGHT

    const viewportHeight = scrollbox.viewport.height
    const currentTop = scrollbox.scrollTop

    if (top < currentTop) {
      scrollbox.scrollTo(top)
    } else if (bottom > currentTop + viewportHeight) {
      scrollbox.scrollTo(bottom - viewportHeight)
    }
  }, [selectedId, tasks])

  if (tasks.length === 0) {
    return (
      <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
        <text fg="#555555">No tasks yet.</text>
        <text fg="#333333">Press [n] to dispatch one.</text>
      </box>
    )
  }

  return (
    <scrollbox ref={scrollRef} style={{ flexGrow: 1 }} scrollY scrollX={false}>
      <box style={{ flexDirection: "column", paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1 }}>
        {tasks.map((task, i) => {
          const selected = task.id === selectedId
          return (
            <box key={task.id} style={{ flexDirection: "column" }}>
              {i > 0 && <box border={["top"]} borderColor="#222222" />}
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
                <TaskRow task={task} selected={selected} />
                <box
                  border={["left"]}
                  borderColor="#ffffff"
                  style={{ marginTop: 1, paddingLeft: 1 }}
                >
                  <text fg={selected ? "#aaaaaa" : "#444444"} attributes={createTextAttributes({ italic: true })} truncate>{task.prompt}</text>
                </box>
              </box>
            </box>
          )
        })}
      </box>
    </scrollbox>
  )
}
