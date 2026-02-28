import { type MutableRefObject, useCallback, useEffect, useRef, useState } from "react"
import { ACTIVE_STATUSES, type FilterMode } from "../components/AgentList.js"
import type { Task } from "../types.js"
import { taskUsesDiffView } from "./useAppActions.js"

export function sortDescending(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

export type FlashType = "success" | "error"
export type PaneView = "log" | "diff"

export interface AppState {
  tasks: Task[]
  setTasks: (tasks: Task[] | ((prev: Task[]) => Task[])) => void
  filterMode: FilterMode
  setFilterMode: (mode: FilterMode) => void
  selectedIdx: number
  setSelectedIdx: (idx: number | ((prev: number) => number)) => void
  flashMessage: string | null
  flashType: FlashType | null
  paneTaskId: string | null
  setPaneTaskId: (id: string | null) => void
  paneView: PaneView
  setPaneView: (view: PaneView) => void
  currentBranch: string
  setCurrentBranch: (branch: string) => void
  isDirty: boolean
  setIsDirty: (dirty: boolean) => void
  prevSelectedIdx: MutableRefObject<number>
  // Derived values
  visibleTasks: Task[]
  selectedTask: Task | null
  paneTask: Task | null
  // Helper
  showFlash: (msg: string, type: FlashType) => void
}

export function useAppState(initialTasks: Task[]): AppState {
  const [tasks, setTasks] = useState<Task[]>(sortDescending(initialTasks))
  const [filterMode, setFilterMode] = useState<FilterMode>("active")
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [flashMessage, setFlashMessage] = useState<string | null>(null)
  const [flashType, setFlashType] = useState<FlashType | null>(null)
  const [paneTaskId, setPaneTaskId] = useState<string | null>(null)
  const [paneView, setPaneView] = useState<PaneView>("log")
  const [currentBranch, setCurrentBranch] = useState<string>("")
  const [isDirty, setIsDirty] = useState<boolean>(false)
  const prevSelectedIdx = useRef(0)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevTaskStatusesRef = useRef<Map<string, Task["status"]>>(new Map())

  const visibleTasks = filterMode === "active"
    ? tasks.filter((t) => ACTIVE_STATUSES.includes(t.status))
    : tasks

  const selectedTask = visibleTasks[selectedIdx] ?? null

  // When viewing a log or diff pane, actions must operate on the task being
  // viewed, not on selectedTask (which is position-based in the filtered list).
  // If the filter hides a task after it's killed, selectedTask silently shifts
  // to whatever lands at that index -- paneTask prevents that mismatch.
  const paneTask = paneTaskId
    ? tasks.find((t) => t.id === paneTaskId) ?? null
    : null

  // Keep selectedIdx in bounds when visibleTasks changes (filter toggle, task added/removed).
  useEffect(() => {
    setSelectedIdx((i) => Math.min(i, Math.max(0, visibleTasks.length - 1)))
  }, [visibleTasks.length])

  // When a task transitions to ready and has commits while the log view is
  // open, switch automatically to the diff view. Only fires on the status
  // transition itself -- not every render while the task is already ready.
  useEffect(() => {
    const prev = prevTaskStatusesRef.current
    for (const task of tasks) {
      const previousStatus = prev.get(task.id)
      if (
        previousStatus !== undefined &&
        previousStatus !== "ready" &&
        taskUsesDiffView(task) &&
        paneTaskId === task.id &&
        paneView === "log"
      ) {
        setPaneView("diff")
      }
    }
    const next = new Map<string, Task["status"]>()
    for (const task of tasks) next.set(task.id, task.status)
    prevTaskStatusesRef.current = next
  }, [tasks, paneTaskId, paneView])

  const showFlash = useCallback((msg: string, type: FlashType) => {
    if (flashTimerRef.current !== null) {
      clearTimeout(flashTimerRef.current)
    }
    setFlashMessage(msg)
    setFlashType(type)
    flashTimerRef.current = setTimeout(() => {
      setFlashMessage(null)
      setFlashType(null)
      flashTimerRef.current = null
    }, 2000)
  }, [])

  return {
    tasks,
    setTasks,
    filterMode,
    setFilterMode,
    selectedIdx,
    setSelectedIdx,
    flashMessage,
    flashType,
    paneTaskId,
    setPaneTaskId,
    paneView,
    setPaneView,
    currentBranch,
    setCurrentBranch,
    isDirty,
    setIsDirty,
    prevSelectedIdx,
    visibleTasks,
    selectedTask,
    paneTask,
    showFlash,
  }
}
