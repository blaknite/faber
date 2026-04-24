import { useKeyboard } from "@opentui/react"
import type { MutableRefObject } from "react"
import { ACTIVE_STATUSES, type Task, type Mode, type Tier } from "../types.js"
import type { PaneView } from "./useAppState.js"

export interface KeyBinding {
  key: string
  label: string
  disabled?: boolean
  hidden?: boolean
  action?: () => void
}

interface UseKeyboardRouterParams {
  mode: Mode
  setMode: (mode: Mode) => void
  paneTaskId: string | null
  setPaneTaskId: (id: string | null) => void
  paneView: PaneView
  setPaneView: (view: PaneView) => void
  paneTask: Task | null
  selectedTask: Task | null
  selectedIdx: number
  setSelectedIdx: (updater: number | ((i: number) => number)) => void
  tasks: Task[]
  visibleTasks: Task[]
  isDirty: boolean
  mergeMessage: string | null
  clearMergeMessage: () => void
  prevSelectedIdx: MutableRefObject<number>
  handleKill: (task?: Task | null) => void
  handleMerge: (task?: Task | null) => void
  handleMarkDone: (task?: Task | null) => void
  handleDelete: (task?: Task | null) => void
  handlePush: () => void
  handleContinue: (prompt?: string, tier?: Tier) => void
  handleOpenLog: () => void
  handleOpenDiff: () => void
  openTaskView: (task: Task) => void
  onExit: () => void
}

export function useKeyboardRouter({
  mode,
  setMode,
  paneTaskId,
  setPaneTaskId,
  paneView,
  setPaneView,
  paneTask,
  selectedTask,
  selectedIdx,
  setSelectedIdx,
  tasks,
  visibleTasks,
  isDirty,
  mergeMessage,
  clearMergeMessage,
  prevSelectedIdx,
  handleKill,
  handleMerge,
  handleMarkDone,
  handleDelete,
  handlePush,
  handleContinue,
  handleOpenLog,
  handleOpenDiff,
  openTaskView,
  onExit,
}: UseKeyboardRouterParams): KeyBinding[] {
  const activeTaskCount = tasks.filter(t => ACTIVE_STATUSES.includes(t.status)).length

  // When in a pane, actions operate on the viewed task, not selectedTask.
  const activeTask = paneTask ?? selectedTask

  // The single source of truth for all keyboard bindings. Each entry controls
  // both what the StatusBar renders and what happens when the key is pressed.
  const bindings: KeyBinding[] = paneTaskId && paneView === "diff" ? [
    { key: "q", label: "back to list", action: () => setPaneTaskId(null) },
    { key: "l", label: "back to log", disabled: !paneTask, action: () => setPaneView("log") },
    { key: "↑↓", label: "scroll" },
    { key: "</>", label: "prev/next", hidden: activeTaskCount < 2 || !paneTask || !ACTIVE_STATUSES.includes(paneTask.status) },
    { key: "c", label: "continue", disabled: !paneTask?.sessionId || paneTask?.status === "running", action: () => setMode("continue") },
    { key: "m", label: "merge", disabled: !paneTask, action: () => setMode("merge") },
    { key: "x", label: "done", disabled: !paneTask || paneTask.status !== "ready", action: () => setMode("done") },
    { key: "d", label: "delete", disabled: !paneTask, action: () => setMode("delete") },
  ] : paneTaskId && paneView === "log" ? [
    { key: "q", label: "back to list", action: () => setPaneTaskId(null) },
    { key: "↑↓", label: "scroll" },
    { key: "</>", label: "prev/next", hidden: activeTaskCount < 2 || !paneTask || !ACTIVE_STATUSES.includes(paneTask.status) },
    { key: "s", label: "stop", disabled: !paneTask || paneTask.status !== "running" || !paneTask.pid, action: () => setMode("kill") },
    { key: "f", label: "diff", disabled: !paneTask || paneTask.status !== "ready" || !paneTask.hasCommits, action: () => setPaneView("diff") },
    { key: "c", label: "continue", disabled: !paneTask?.sessionId || paneTask?.status === "running", action: () => setMode("continue") },
    { key: "x", label: "done", disabled: !paneTask || paneTask.status !== "ready", action: () => setMode("done") },
    { key: "d", label: "delete", disabled: !paneTask, action: () => setMode("delete") },
  ] : [
    { key: "q", label: "quit", action: () => onExit() },
    { key: "n", label: "new task", action: () => { prevSelectedIdx.current = selectedIdx; setMode("input"); setSelectedIdx(-1) } },
    { key: "↑↓", label: "select", disabled: tasks.length === 0 },
    { key: "enter", label: "open", disabled: !selectedTask, action: () => { if (selectedTask) openTaskView(selectedTask) } },
    { key: "s", label: "stop", disabled: !selectedTask || selectedTask.status !== "running" || !selectedTask.pid, action: () => setMode("kill") },
    { key: "c", label: "continue", disabled: !selectedTask?.sessionId || selectedTask?.status === "running", action: () => setMode("continue") },
    { key: "x", label: "done", disabled: !selectedTask || selectedTask.status !== "ready", action: () => setMode("done") },
    { key: "d", label: "delete", disabled: !selectedTask, action: () => setMode("delete") },
    { key: "b", label: "switch branch", action: () => setMode("switch_branch") },
    { key: "p", label: "push", disabled: !isDirty, action: () => setMode("push") },
  ]

  useKeyboard((key) => {
    if (mode === "input" || mode === "continue" || mode === "switch_branch") return

    if (mode === "pushing") return

    if (mergeMessage !== null) {
      clearMergeMessage()
      return
    }

    if (key.name === "escape") {
      if (mode === "kill" || mode === "delete" || mode === "done" || mode === "merge" || mode === "push") { setMode("normal"); return }
      if (paneTaskId !== null) { setPaneTaskId(null); return }
      return
    }

    if (key.ctrl && key.name === "c") { onExit(); return }

    if (mode === "kill") {
      if (key.name === "y") { handleKill(activeTask); return }
      if (key.name === "n" || key.name === "q") { setMode("normal"); return }
      return
    }

    if (mode === "delete") {
      if (key.name === "y") { handleDelete(activeTask); return }
      if (key.name === "n" || key.name === "q") { setMode("normal"); return }
      return
    }

    if (mode === "done") {
      if (key.name === "y") { handleMarkDone(activeTask); setMode("normal"); return }
      if (key.name === "n" || key.name === "q") { setMode("normal"); return }
      return
    }

    if (mode === "merge") {
      if (key.name === "y") { handleMerge(activeTask); return }
      if (key.name === "n" || key.name === "q") { setMode("normal"); return }
      return
    }

    if (mode === "push") {
      if (key.name === "y") { handlePush(); return }
      if (key.name === "n" || key.name === "q") { setMode("normal"); return }
      return
    }

    // Prev/next task navigation — not in the bindings list but handled here
    // because it's a special case that operates on the active task index.
    if (paneTaskId !== null && (key.name === "," || key.name === ".")) {
      const activeTasks = tasks.filter(t => ACTIVE_STATUSES.includes(t.status))
      const currentIdx = activeTasks.findIndex(t => t.id === paneTaskId)
      if (currentIdx !== -1 && activeTasks.length > 1) {
        const nextIdx = key.name === ","
          ? (currentIdx + 1) % activeTasks.length
          : (currentIdx - 1 + activeTasks.length) % activeTasks.length
        const nextTask = activeTasks[nextIdx]
        openTaskView(nextTask)
      }
      return
    }

    // Up/down navigation in the list — also not in bindings since the key
    // display is "↑↓" (a combined label for two keys).
    if (!paneTaskId) {
      if (key.name === "up" || key.name === "k") { setSelectedIdx((i) => Math.max(0, i - 1)); return }
      if (key.name === "down" || key.name === "j") { setSelectedIdx((i) => Math.min(visibleTasks.length - 1, i + 1)); return }
      if (key.name === "o") { if (selectedTask) openTaskView(selectedTask); return }
    }

    // Dispatch to the binding whose key matches. Disabled bindings have no
    // action so they naturally fall through without doing anything.
    const keyName = key.name === "return" ? "enter" : key.name
    const binding = bindings.find(b => !b.disabled && b.key === keyName)
    if (binding?.action) {
      binding.action()
    }
  })

  return bindings
}
