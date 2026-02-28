import { useKeyboard } from "@opentui/react"
import type { MutableRefObject } from "react"
import { killAgent } from "./agent.js"
import { removeWorktree } from "./worktree.js"
import type { Task, Mode } from "../types.js"
import { ACTIVE_STATUSES } from "../components/AgentList.js"

interface UseKeyboardRouterParams {
  mode: Mode
  setMode: (mode: Mode) => void
  diffPaneTaskId: string | null
  setDiffPaneTaskId: (id: string | null) => void
  logPaneTaskId: string | null
  setLogPaneTaskId: (id: string | null) => void
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
  removeTaskFromState: (id: string) => void
  onExit: () => void
}

export function useKeyboardRouter({
  mode,
  setMode,
  diffPaneTaskId,
  setDiffPaneTaskId,
  logPaneTaskId,
  setLogPaneTaskId,
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
  removeTaskFromState,
  onExit,
}: UseKeyboardRouterParams): void {
  useKeyboard((key) => {
    if (mode === "input" || mode === "continue" || mode === "switch_branch") return

    if (mode === "pushing") return

    if (key.name === "escape") {
      if (mode === "kill" || mode === "delete" || mode === "merge" || mode === "push") { setMode("normal"); return }
      if (diffPaneTaskId !== null) { setDiffPaneTaskId(null); setLogPaneTaskId(null); return }
      if (logPaneTaskId !== null) { setLogPaneTaskId(null); return }
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
        if (logPaneTaskId === activeTask.id) setLogPaneTaskId(null)
        if (diffPaneTaskId === activeTask.id) setDiffPaneTaskId(null)
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
      if (diffPaneTaskId !== null) { setDiffPaneTaskId(null); setLogPaneTaskId(null); return }
      if (logPaneTaskId !== null) { setLogPaneTaskId(null); return }
      onExit()
      return
    }

    if (diffPaneTaskId !== null) {
      if (key.name === "c") {
        if (paneTask && paneTask.sessionId && paneTask.status !== "running") setMode("continue")
        return
      }
      if (key.name === "l") { handleOpenLog(); setDiffPaneTaskId(null); return }
      if (key.name === "m") {
        if (paneTask) setMode("merge")
        return
      }
      if (key.name === "e") {
        if (paneTask && paneTask.status === "ready") handleMarkDone(paneTask)
        return
      }
      if (key.name === "d") {
        if (paneTask) setMode("delete")
        return
      }
      if (key.name === "," || key.name === ".") {
        const activeTasks = tasks.filter(t => ACTIVE_STATUSES.includes(t.status))
        const currentIdx = activeTasks.findIndex(t => t.id === diffPaneTaskId)
        if (currentIdx !== -1 && activeTasks.length > 1) {
          const nextIdx = key.name === "."
            ? (currentIdx + 1) % activeTasks.length
            : (currentIdx - 1 + activeTasks.length) % activeTasks.length
          const nextTask = activeTasks[nextIdx]
          if (nextTask.status === "ready" && nextTask.hasCommits) {
            setDiffPaneTaskId(nextTask.id)
            setLogPaneTaskId(null)
          } else {
            setDiffPaneTaskId(null)
            setLogPaneTaskId(nextTask.id)
          }
        }
        return
      }
      return
    }

    if (logPaneTaskId !== null) {
      if (key.name === "s") {
        if (paneTask && paneTask.status === "running" && paneTask.pid) setMode("kill")
        return
      }
      if (key.name === "f") {
        if (paneTask && paneTask.status === "ready" && paneTask.hasCommits) handleOpenDiff()
        return
      }
      if (key.name === "c") {
        if (paneTask && paneTask.sessionId && paneTask.status !== "running") setMode("continue")
        return
      }
      if (key.name === "e") {
        if (paneTask && paneTask.status === "ready") handleMarkDone(paneTask)
        return
      }
      if (key.name === "d") {
        if (paneTask) setMode("delete")
        return
      }
      if (key.name === "," || key.name === ".") {
        const activeTasks = tasks.filter(t => ACTIVE_STATUSES.includes(t.status))
        const currentIdx = activeTasks.findIndex(t => t.id === logPaneTaskId)
        if (currentIdx !== -1 && activeTasks.length > 1) {
          const nextIdx = key.name === "."
            ? (currentIdx + 1) % activeTasks.length
            : (currentIdx - 1 + activeTasks.length) % activeTasks.length
          const nextTask = activeTasks[nextIdx]
          if (nextTask.status === "ready" && nextTask.hasCommits) {
            setDiffPaneTaskId(nextTask.id)
            setLogPaneTaskId(null)
          } else {
            setLogPaneTaskId(nextTask.id)
          }
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
    if (key.name === "o" || key.name === "return") { selectedTask?.status === "ready" && selectedTask.hasCommits ? handleOpenDiff() : handleOpenLog(); return }
    if (key.name === "c") {
      if (selectedTask && selectedTask.sessionId && selectedTask.status !== "running") setMode("continue")
      return
    }
    if (key.name === "b") { setMode("switch_branch"); return }
    if (key.name === "e") {
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
