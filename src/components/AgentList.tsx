import { useCallback, useEffect, useRef } from "react"
import { useKeyboard } from "@opentui/react"
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import type { Task, TaskStatus, Model, FilterMode } from "../types.js"
import { TaskInput } from "./TaskInput.js"
import { TaskRow } from "./TaskRow.js"

interface Props {
  repoRoot: string
  tasks: Task[]
  selectedId: string | null
  filterMode: FilterMode
  onFilterChange: (mode: FilterMode) => void
  updateAvailable?: boolean
  width?: number | "auto" | `${number}%`
  inputActive: boolean
  currentBranch?: string
  onActivate: () => void
  onSubmit: (prompt: string, model: Model) => void
  onCancel: () => void
  onSelectTask: (id: string) => void
  onOpenTask: (id: string) => void
}

export function AgentList({ repoRoot, tasks, selectedId, filterMode, onFilterChange, updateAvailable = false, width = undefined, inputActive, currentBranch, onActivate, onSubmit, onCancel, onSelectTask, onOpenTask }: Props) {
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
      <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, marginBottom: 1, flexDirection: "row", justifyContent: "space-between", backgroundColor: "#111111", height: 3 }}>
        {updateAvailable ? (
          <text>
            <span fg="#ff6600">update available</span>
            <span fg="#888888">{" — run "}</span>
            <span fg="#555555">faber update</span>
          </text>
        ) : (
          <text>{""}</text>
        )}
        <box style={{ flexDirection: "row" }}>
          <text fg={filterMode === "active" ? "#ff6600" : "#555555"} onMouseDown={(e) => { if (e.button === 0) onFilterChange("active") }}>active</text>
          <text fg="#333333">{" / "}</text>
          <text fg={filterMode === "all" ? "#ff6600" : "#555555"} onMouseDown={(e) => { if (e.button === 0) onFilterChange("all") }}>all</text>
          <text fg="#888888">{" [tab]"}</text>
        </box>
      </box>
      <TaskInput repoRoot={repoRoot} active={inputActive} onActivate={onActivate} onSubmit={onSubmit} onCancel={onCancel} />

      {tasks.length === 0 ? (
        <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
          <text fg="#333333">{filterMode === "active" ? "No active tasks." : currentBranch ? `No tasks for \`${currentBranch}\`.` : "No tasks yet."}</text>
        </box>
      ) : (
        <box style={{ flexGrow: 1, paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1 }}>
          <scrollbox ref={scrollRef} style={{ flexGrow: 1 }} scrollY scrollX={false} contentOptions={{ paddingRight: 1 }} viewportOptions={{ maxHeight: "100%" }}>
            <box style={{ flexDirection: "column" }}>
              {tasks.map((task, i) => (
                <TaskRow key={task.id} task={task} index={i} selected={task.id === selectedId} cardRef={setCardRef(task.id)} repoRoot={repoRoot} onOpen={() => onOpenTask(task.id)} />
              ))}
            </box>
          </scrollbox>
        </box>
      )}
    </box>
  )
}
