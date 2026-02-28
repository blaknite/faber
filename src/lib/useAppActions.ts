import { useCallback } from "react"
import type React from "react"
import { spawnAgent, killAgent } from "./agent.js"
import { removeWorktree, mergeBranch, switchBranch, pushBranch } from "./worktree.js"
import { addTask, removeTask, updateTask } from "./state.js"
import { createWorktree } from "./worktree.js"
import { generateSlug } from "./slug.js"
import { logTaskFailure } from "./failureLog.js"
import type { Task, Mode, Model } from "../types.js"
import { DEFAULT_MODEL } from "../types.js"

interface UseAppActionsParams {
  repoRoot: string
  selectedTask: Task | null
  paneTask: Task | null
  currentBranch: string
  setMode: (mode: Mode) => void
  setSelectedIdx: (i: number) => void
  setLogPaneTaskId: (id: string | null) => void
  setDiffPaneTaskId: (id: string | null) => void
  prevSelectedIdx: React.MutableRefObject<number>
  refreshDirtyState: () => void
  showFlash: (msg: string) => void
}

export function useAppActions({
  repoRoot,
  selectedTask,
  paneTask,
  currentBranch,
  setMode,
  setSelectedIdx,
  setLogPaneTaskId,
  setDiffPaneTaskId,
  prevSelectedIdx,
  refreshDirtyState,
  showFlash,
}: UseAppActionsParams) {
  const updateTaskInState = useCallback((id: string, patch: Partial<Task>) => {
    updateTask(repoRoot, id, patch)
  }, [repoRoot])

  const removeTaskFromState = useCallback((id: string) => {
    removeTask(repoRoot, id)
  }, [repoRoot])

  const handleDispatch = useCallback(async (prompt: string, model: Model = DEFAULT_MODEL) => {
    setMode("normal")
    setSelectedIdx(0)
    prevSelectedIdx.current = 0
    const slug = generateSlug(prompt)
    const worktree = `.worktrees/${slug}`
    const task: Task = {
      id: slug,
      prompt,
      model,
      status: "running",
      pid: null,
      worktree,
      sessionId: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      exitCode: null,
    }

    addTask(repoRoot, task)

    try {
      await createWorktree(repoRoot, slug)
    } catch (err) {
      logTaskFailure(repoRoot, {
        taskId: slug,
        callSite: "App.tsx:handleDispatch",
        reason: "Failed to create git worktree",
        exitCode: -1,
        error: err instanceof Error ? err.message : String(err),
      })
      updateTaskInState(slug, {
        status: "failed",
        completedAt: new Date().toISOString(),
        exitCode: -1,
      })
      return
    }

    spawnAgent(task, repoRoot)
  }, [repoRoot, updateTaskInState, setMode, setSelectedIdx, prevSelectedIdx])

  const handleKill = useCallback((task: Task | null = selectedTask) => {
    if (!task || task.status !== "running" || !task.pid) return
    killAgent(task.pid)
    updateTaskInState(task.id, {
      status: "failed",
      completedAt: new Date().toISOString(),
      pid: null,
    })
    setMode("normal")
  }, [selectedTask, updateTaskInState, setMode])

  const handleResume = useCallback((task: Task | null = selectedTask) => {
    if (!task || (task.status !== "failed" && task.status !== "done") || !task.sessionId) return
    if (task.pid) killAgent(task.pid)
    const patch: Partial<Task> = {
      status: "running",
      completedAt: null,
      exitCode: null,
    }
    updateTaskInState(task.id, patch)
    const updated = { ...task, ...patch }
    spawnAgent(updated, repoRoot, task.sessionId)
  }, [selectedTask, repoRoot, updateTaskInState])

  const handleOpenLog = useCallback(() => {
    if (!selectedTask) return
    setLogPaneTaskId(selectedTask.id)
  }, [selectedTask, setLogPaneTaskId])

  const handleOpenDiff = useCallback(() => {
    const task = paneTask ?? selectedTask
    if (!task || task.status !== "ready_to_merge") return
    setDiffPaneTaskId(task.id)
  }, [paneTask, selectedTask, setDiffPaneTaskId])

  const handleRequestChanges = useCallback((prompt: string) => {
    const task = paneTask
    if (!task || !task.sessionId) return
    setMode("normal")
    if (task.pid) killAgent(task.pid)
    const patch: Partial<Task> = {
      status: "running",
      completedAt: null,
      exitCode: null,
    }
    updateTaskInState(task.id, patch)
    const updated = { ...task, ...patch }
    spawnAgent(updated, repoRoot, task.sessionId, prompt)
    setDiffPaneTaskId(null)
    setLogPaneTaskId(task.id)
  }, [paneTask, repoRoot, updateTaskInState, setMode, setDiffPaneTaskId, setLogPaneTaskId])

  const handleSwitchBranch = useCallback(async (branch: string) => {
    setMode("normal")
    try {
      await switchBranch(repoRoot, branch)
      showFlash(`Switched to branch ${branch}`)
    } catch (err) {
      showFlash(`Branch switch failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [repoRoot, showFlash, setMode])

  const handlePush = useCallback(async () => {
    setMode("pushing")
    try {
      await pushBranch(repoRoot)
      showFlash(`Pushed ${currentBranch} to origin`)
      refreshDirtyState()
    } catch (err) {
      showFlash(`Push failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setMode("normal")
    }
  }, [repoRoot, currentBranch, showFlash, refreshDirtyState, setMode])

  const handleMerge = useCallback(async (task: Task | null = selectedTask) => {
    if (!task) { setMode("normal"); return }
    setMode("normal")
    try {
      await mergeBranch(repoRoot, task.id)
      updateTaskInState(task.id, { status: "done" })
      setDiffPaneTaskId(null)
      setLogPaneTaskId(null)
      showFlash(`Merged ${task.id} into HEAD`)
      refreshDirtyState()
    } catch (err) {
      showFlash(`Merge failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [selectedTask, repoRoot, showFlash, updateTaskInState, refreshDirtyState, setMode, setDiffPaneTaskId, setLogPaneTaskId])

  return {
    handleDispatch,
    handleKill,
    handleResume,
    handleOpenLog,
    handleOpenDiff,
    handleRequestChanges,
    handleSwitchBranch,
    handlePush,
    handleMerge,
    updateTaskInState,
    removeTaskFromState,
  }
}
