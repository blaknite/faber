import { useCallback, useEffect, useRef, useState } from "react"
import { useKeyboard } from "@opentui/react"
import { createTextAttributes } from "@opentui/core"
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import type { Task, TaskStatus, Model } from "../types.js"
import { TaskInput } from "./TaskInput.js"

export type FilterMode = "active" | "all"

export const ACTIVE_STATUSES: TaskStatus[] = ["running", "ready_to_merge"]

interface Props {
  tasks: Task[]
  selectedId: string | null
  filterMode: FilterMode
  onFilterChange: (mode: FilterMode) => void
  width?: number | "auto" | `${number}%`
  inputActive: boolean
  onSubmit: (prompt: string, model: Model) => void
  onCancel: () => void
  onSelectTask: (id: string) => void
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

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

const STATUS_SYMBOL: Record<TaskStatus, string> = {
  running: SPINNER_FRAMES[0],
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

function TaskRow({ task, selected }: { task: Task; selected: boolean }) {
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
  )
}

export function AgentList({ tasks, selectedId, filterMode, onFilterChange, width = undefined, inputActive, onSubmit, onCancel, onSelectTask }: Props) {
  const scrollRef = useRef<ScrollBoxRenderable>(null)
  const cardRefs = useRef<Map<string, BoxRenderable>>(new Map())

  const setCardRef = useCallback((id: string) => (el: BoxRenderable | null) => {
    if (el) {
      cardRefs.current.set(id, el)
    } else {
      cardRefs.current.delete(id)
    }
  }, [])

  useKeyboard((key) => {
    if (inputActive) return
    if (key.name === "tab") {
      onFilterChange(filterMode === "active" ? "all" : "active")
    }
  })

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

  return (
    <box style={{ ...containerStyle, flexDirection: "column" }}>
      <TaskInput active={inputActive} onSubmit={onSubmit} onCancel={onCancel} />
      <box style={{ marginTop: 1, paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, flexDirection: "row", justifyContent: "flex-end", backgroundColor: "#222222" }}>
        <text>
          <span fg={filterMode === "active" ? "#0088ff" : "#555555"}>active</span>
          <span fg="#333333">{" / "}</span>
          <span fg={filterMode === "all" ? "#0088ff" : "#555555"}>all</span>
          <span fg="#888888">{" [tab]"}</span>
        </text>
      </box>

      {tasks.length === 0 ? (
        <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
          <text fg="#333333">{filterMode === "active" ? "No active tasks." : "No tasks yet."}</text>
        </box>
      ) : (
        <box style={{ flexGrow: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1 }}>
          <scrollbox ref={scrollRef} style={{ flexGrow: 1 }} scrollY scrollX={false} viewportOptions={{ maxHeight: "100%" }}>
            <box style={{ flexDirection: "column", paddingRight: 1 }}>
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
                        <text fg={selected ? "#aaaaaa" : "#444444"} attributes={createTextAttributes({ italic: true })} truncate>{task.prompt.split("\n").slice(0, 5).join("\n")}</text>
                      </box>
                    </box>
                  </box>
                )
              })}
            </box>
          </scrollbox>
        </box>
      )}
    </box>
  )
}
