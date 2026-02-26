import { useCallback, useEffect, useRef, useState } from "react"
import { createTextAttributes } from "@opentui/core"
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import type { Task, TaskStatus } from "../types.js"

interface Props {
  tasks: Task[]
  selectedId: string | null
  width?: number | "auto" | `${number}%`
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
      <span>{formatElapsed(task.startedAt, task.completedAt, now)}</span>
      {task.sessionId ? <span>{"  "}{task.sessionId}</span> : null}
    </text>
  )
}

export function AgentList({ tasks, selectedId, width = undefined }: Props) {
  const scrollRef = useRef<ScrollBoxRenderable>(null)
  const cardRefs = useRef<Map<string, BoxRenderable>>(new Map())

  const setCardRef = useCallback((id: string) => (el: BoxRenderable | null) => {
    if (el) {
      cardRefs.current.set(id, el)
    } else {
      cardRefs.current.delete(id)
    }
  }, [])

  useEffect(() => {
    if (!scrollRef.current || !selectedId) return

    const scrollbox = scrollRef.current
    const card = cardRefs.current.get(selectedId)
    if (!card) return

    // card.y is in screen coordinates; subtract the content container's y to get
    // the row offset within the scrollable content
    const contentY = scrollbox.content.y
    const top = card.y - contentY
    const bottom = top + card.height
    const viewportHeight = scrollbox.viewport.height
    const currentTop = scrollbox.scrollTop

    // Add a small buffer row when scrolling so the first/last item isn't
    // flush against the viewport edge.
    const CONTENT_PADDING = 1

    if (top < currentTop) {
      scrollbox.scrollTo(Math.max(0, top - CONTENT_PADDING))
    } else if (bottom > currentTop + viewportHeight) {
      scrollbox.scrollTo(bottom - viewportHeight + CONTENT_PADDING)
    }
  }, [selectedId, tasks])

  const containerStyle = width !== undefined ? { width } : { flexGrow: 1 }

  if (tasks.length === 0) {
    return (
      <box style={{ ...containerStyle, alignItems: "center", justifyContent: "center" }}>
        <text fg="#555555">No tasks yet.</text>
        <text fg="#333333">Press [n] to dispatch one.</text>
      </box>
    )
  }

  return (
    <box style={{ ...containerStyle, paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1 }}>
      <scrollbox ref={scrollRef} style={{ flexGrow: 1, paddingRight: 1 }} scrollY scrollX={false} viewportOptions={{ maxHeight: "100%" }}>
        <box style={{ flexDirection: "column" }}>
          {tasks.map((task, i) => {
            const selected = task.id === selectedId
            return (
              <box key={task.id} ref={setCardRef(task.id)} style={{ flexDirection: "column" }}>
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
    </box>
  )
}
