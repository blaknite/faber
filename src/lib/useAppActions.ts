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
import type { FlashType, PaneView } from "./useAppState.js"

// Returns true when a task should open in the diff view. Both the keyboard
// router and the auto-transition effect in useAppState rely on this same rule,
// so keep it here as the single source of truth.
export function taskUsesDiffView(task: Task): boolean {
  return task.status === "ready" && task.hasCommits
}

interface UseAppActionsParams {
  repoRoot: string
  selectedTask: Task | null
  paneTask: Task | null
  currentBranch: string
  paneTaskId: string | null
  paneView: PaneView
  setMode: (mode: Mode) => void
  setSelectedIdx: (i: number) => void
  setPaneTaskId: (id: string | null) => void
  setPaneView: (view: PaneView) => void
  prevSelectedIdx: React.MutableRefObject<number>
  refreshDirtyState: () => void
  showFlash: (msg: string, type: FlashType) => void
  showMergeMessage: (msg: string) => void
}

export function useAppActions({
  repoRoot,
  selectedTask,
  paneTask,
  currentBranch,
  paneTaskId,
  paneView,
  setMode,
  setSelectedIdx,
  setPaneTaskId,
  setPaneView,
  prevSelectedIdx,
  refreshDirtyState,
  showFlash,
  showMergeMessage,
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
      hasCommits: false,
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
      status: "stopped",
      completedAt: new Date().toISOString(),
      pid: null,
    })
    setMode("normal")
  }, [selectedTask, updateTaskInState, setMode])

  const handleOpenLog = useCallback(() => {
    const task = paneTask ?? selectedTask
    if (!task) return
    setPaneTaskId(task.id)
    setPaneView("log")
  }, [paneTask, selectedTask, setPaneTaskId, setPaneView])

  const handleOpenDiff = useCallback(() => {
    const task = paneTask ?? selectedTask
    if (!task || task.status !== "ready" || !task.hasCommits) return
    setPaneTaskId(task.id)
    setPaneView("diff")
  }, [paneTask, selectedTask, setPaneTaskId, setPaneView])

  // Opens whichever view is appropriate for the given task. Use this instead of
  // calling handleOpenDiff/handleOpenLog directly so the routing logic stays in
  // one place.
  const openTaskView = useCallback((task: Task) => {
    setPaneTaskId(task.id)
    setPaneView(taskUsesDiffView(task) ? "diff" : "log")
  }, [setPaneTaskId, setPaneView])

  const handleContinue = useCallback((prompt?: string, model?: Model) => {
    const task = paneTask ?? selectedTask
    if (!task || !task.sessionId) return
    if (task.status === "running") return
    setMode("normal")
    if (task.pid) killAgent(task.pid)
    const patch: Partial<Task> = {
      status: "running",
      completedAt: null,
      exitCode: null,
      ...(model ? { model } : {}),
    }
    updateTaskInState(task.id, patch)
    const updated = { ...task, ...patch }
    const resolvedPrompt = prompt?.trim() || undefined
    spawnAgent(updated, repoRoot, task.sessionId, resolvedPrompt)
    setPaneTaskId(task.id)
    setPaneView("log")
  }, [paneTask, selectedTask, repoRoot, updateTaskInState, setMode, setPaneTaskId, setPaneView])

  const handleSwitchBranch = useCallback(async (branch: string) => {
    setMode("normal")
    try {
      await switchBranch(repoRoot, branch)
      showFlash(`Switched to branch ${branch}`, "success")
    } catch (err) {
      showFlash(`Branch switch failed: ${err instanceof Error ? err.message : String(err)}`, "error")
    }
  }, [repoRoot, showFlash, setMode])

  const handlePush = useCallback(async () => {
    setMode("pushing")
    try {
      await pushBranch(repoRoot)
      showFlash("Success!", "success")
      refreshDirtyState()
    } catch (err) {
      showFlash(`Push failed: ${err instanceof Error ? err.message : String(err)}`, "error")
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
      setPaneTaskId(null)
      showMergeMessage(`Merged ${task.id} into HEAD.`)
      refreshDirtyState()
    } catch (err) {
      showFlash(`Merge failed: ${err instanceof Error ? err.message : String(err)}`, "error")
    }
  }, [selectedTask, repoRoot, showFlash, showMergeMessage, updateTaskInState, refreshDirtyState, setMode, setPaneTaskId])

  const handleMarkDone = useCallback((task: Task | null = selectedTask) => {
    if (!task || task.status !== "ready") return
    updateTaskInState(task.id, { status: "done" })
    if (paneTaskId === task.id) setPaneTaskId(null)
    showFlash(`${task.id} marked as done`, "success")
  }, [selectedTask, paneTaskId, updateTaskInState, setPaneTaskId, showFlash])

  return {
    handleDispatch,
    handleKill,
    handleContinue,
    handleOpenLog,
    handleOpenDiff,
    openTaskView,
    handleSwitchBranch,
    handlePush,
    handleMerge,
    handleMarkDone,
    updateTaskInState,
    removeTaskFromState,
  }
}
