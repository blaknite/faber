import { useCallback } from "react"
import type React from "react"
import { spawnAgent, killAgent } from "./agent.js"
import { removeWorktree, mergeBranch, switchBranch, pushBranch } from "./worktree.js"
import { removeTask, updateTask } from "./state.js"
import { createAndDispatchTask } from "./dispatch.js"
import type { Task, Mode, Model, TaskPatch } from "../types.js"
import { DEFAULT_MODEL, taskUsesDiffView } from "../types.js"
import { getEffectiveModel, MODEL_TO_AGENT } from "./config.js"
import type { FlashType, PaneView } from "./useAppState.js"
import type { AgentConfig } from "./config.js"

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
  loadedConfig: AgentConfig
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
  loadedConfig,
}: UseAppActionsParams) {
  const updateTaskInState = useCallback((id: string, patch: TaskPatch) => {
    updateTask(repoRoot, id, patch)
  }, [repoRoot])

  const removeTaskFromState = useCallback((id: string) => {
    removeTask(repoRoot, id)
  }, [repoRoot])

  const handleDispatch = useCallback(async (prompt: string, model: Model = DEFAULT_MODEL) => {
    setMode("normal")
    setSelectedIdx(0)
    prevSelectedIdx.current = 0

    try {
      await createAndDispatchTask({
        repoRoot,
        prompt,
        model,
        baseBranch: currentBranch,
        callSite: "App.tsx:handleDispatch",
        loadedConfig,
      })
    } catch {
      // createAndDispatchTask already updated the task status to failed and
      // wrote to the failure log. Nothing more to do here.
    }
  }, [repoRoot, currentBranch, setMode, setSelectedIdx, prevSelectedIdx, loadedConfig])

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
    const resolvedModel = model
      ? getEffectiveModel(MODEL_TO_AGENT[model] ?? 'smart', loadedConfig)
      : undefined
    const patch: TaskPatch = {
      status: "running",
      completedAt: null,
      exitCode: null,
      ...(resolvedModel ? { model: resolvedModel } : {}),
    }
    updateTaskInState(task.id, patch)
    const updated = { ...task, ...patch }
    const resolvedPrompt = prompt?.trim() || undefined
    spawnAgent(updated, repoRoot, loadedConfig, task.sessionId, resolvedPrompt)
    setPaneTaskId(task.id)
    setPaneView("log")
  }, [paneTask, selectedTask, repoRoot, updateTaskInState, setMode, setPaneTaskId, setPaneView, loadedConfig])

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
      await mergeBranch(repoRoot, task.id, task.baseBranch)
      updateTaskInState(task.id, { status: "done" })
      setPaneTaskId(null)
      showMergeMessage(`Merged ${task.id} into ${task.baseBranch || currentBranch}.`)
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

  const handleDelete = useCallback(async (task: Task | null = selectedTask) => {
    if (!task) { setMode("normal"); return }
    if (task.pid) killAgent(task.pid)
    try {
      await removeWorktree(repoRoot, task.id)
    } catch (err) {
      showFlash(`Worktree removal failed: ${err instanceof Error ? err.message : String(err)}`, "error")
    }
    if (paneTaskId === task.id) setPaneTaskId(null)
    removeTaskFromState(task.id)
    setMode("normal")
  }, [selectedTask, repoRoot, paneTaskId, removeTaskFromState, setPaneTaskId, showFlash, setMode])

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
    handleDelete,
    updateTaskInState,
    removeTaskFromState,
  }
}
