import { useKeyboard } from "@opentui/react"
import type { MutableRefObject } from "react"
import { killAgent } from "./agent.js"
import { removeWorktree } from "./worktree.js"
import type { Task, Mode } from "../types.js"
import type { PaneView } from "./useAppState.js"
import { ACTIVE_STATUSES } from "../components/AgentList.js"

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
  repoRoot: string
  prevSelectedIdx: MutableRefObject<number>
  handleKill: (task?: Task | null) => void
  handleMerge: (task?: Task | null) => void
  handleMarkDone: (task?: Task | null) => void
  handlePush: () => void
  handleContinue: (prompt?: string) => void
  handleOpenLog: () => void
  handleOpenDiff: () => void
  openTaskView: (task: Task) => void
  removeTaskFromState: (id: string) => void
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
  repoRoot,
  prevSelectedIdx,
  handleKill,
  handleMerge,
  handleMarkDone,
  handlePush,
  handleContinue,
  handleOpenLog,
  handleOpenDiff,
  openTaskView,
  removeTaskFromState,
  onExit,
}: UseKeyboardRouterParams): void {
  useKeyboard((key) => {
    if (mode === "input" || mode === "continue" || mode === "switch_branch") return

    if (mode === "pushing") return

    if (key.name === "escape") {
      if (mode === "kill" || mode === "delete" || mode === "merge" || mode === "push") { setMode("normal"); return }
      if (paneTaskId !== null) { setPaneTaskId(null); return }
      return
    }

    if (key.ctrl && key.name === "c") { onExit(); return }

    // When in a pane, actions operate on the viewed task, not selectedTask.
    const activeTask = paneTask ?? selectedTask

    if (mode === "kill") {
      if (key.name === "y") { handleKill(activeTask); return }
      if (key.name === "n" || key.name === "q") { setMode("normal"); return }
      return
    }

    if (mode === "delete") {
      if (key.name === "y") {
        if (!activeTask) { setMode("normal"); return }
        if (activeTask.pid) killAgent(activeTask.pid)
        removeWorktree(repoRoot, activeTask.id).catch(() => {})
        if (paneTaskId === activeTask.id) setPaneTaskId(null)
        removeTaskFromState(activeTask.id)
        setMode("normal")
        return
      }
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

    if (key.name === "q") {
      if (paneTaskId !== null) { setPaneTaskId(null); return }
      onExit()
      return
    }

    if (paneTaskId !== null) {
      // Prev/next: switch to the new task using openTaskView so the correct
      // view is always shown (diff for ready tasks with commits, log otherwise).
      if (key.name === "," || key.name === ".") {
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

      if (paneView === "diff") {
        if (key.name === "c") {
          if (paneTask && paneTask.sessionId && paneTask.status !== "running") setMode("continue")
          return
        }
        if (key.name === "l") { setPaneView("log"); return }
        if (key.name === "m") {
          if (paneTask) setMode("merge")
          return
        }
        if (key.name === "x") {
          if (paneTask && paneTask.status === "ready") handleMarkDone(paneTask)
          return
        }
        if (key.name === "d") {
          if (paneTask) setMode("delete")
          return
        }
        return
      }

      if (paneView === "log") {
        if (key.name === "s") {
          if (paneTask && paneTask.status === "running" && paneTask.pid) setMode("kill")
          return
        }
        if (key.name === "f") {
          if (paneTask && paneTask.status === "ready" && paneTask.hasCommits) setPaneView("diff")
          return
        }
        if (key.name === "c") {
          if (paneTask && paneTask.sessionId && paneTask.status !== "running") setMode("continue")
          return
        }
        if (key.name === "x") {
          if (paneTask && paneTask.status === "ready") handleMarkDone(paneTask)
          return
        }
        if (key.name === "d") {
          if (paneTask) setMode("delete")
          return
        }
        return
      }

      return
    }

    if (key.name === "n") { prevSelectedIdx.current = selectedIdx; setMode("input"); setSelectedIdx(-1); return }
    if (key.name === "up" || key.name === "k") { setSelectedIdx((i) => Math.max(0, i - 1)); return }
    if (key.name === "down" || key.name === "j") { setSelectedIdx((i) => Math.min(visibleTasks.length - 1, i + 1)); return }
    if (key.name === "s") {
      if (selectedTask && selectedTask.status === "running" && selectedTask.pid) setMode("kill")
      return
    }
    if (key.name === "o" || key.name === "return") { if (selectedTask) openTaskView(selectedTask); return }
    if (key.name === "c") {
      if (selectedTask && selectedTask.sessionId && selectedTask.status !== "running") setMode("continue")
      return
    }
    if (key.name === "b") { setMode("switch_branch"); return }
    if (key.name === "x") {
      if (selectedTask && selectedTask.status === "ready") handleMarkDone(selectedTask)
      return
    }
    if (key.name === "d") {
      if (selectedTask) setMode("delete")
      return
    }
    if (key.name === "p") {
      if (isDirty) setMode("push")
      return
    }
  })
}
