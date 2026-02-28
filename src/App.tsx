import { useCallback, useEffect, useState } from "react"
import { useKeyboard } from "@opentui/react"
import type { CliRenderer } from "@opentui/core"
import { AgentList } from "./components/AgentList.js"
import { useAppState, sortDescending } from "./lib/useAppState.js"
import { AgentLog } from "./components/AgentLog.js"
import { DiffView } from "./components/DiffView.js"
import { BottomBar } from "./components/BottomBar.js"
import { spawnAgent, killAgent } from "./lib/agent.js"
import { removeWorktree, mergeBranch, hasUnpushedCommits, switchBranch, pushBranch, gitHeadPath, readCurrentBranch } from "./lib/worktree.js"
import { generateSlug } from "./lib/slug.js"
import { addTask, readState, removeTask, updateTask, stateFilePath } from "./lib/state.js"
import { useFileWatch } from "./lib/useFileWatch.js"
import { createWorktree } from "./lib/worktree.js"
import { logTaskFailure } from "./lib/failureLog.js"
import type { Task, Model } from "./types.js"
import { DEFAULT_MODEL } from "./types.js"
import { TickProvider, useSpinnerFrame } from "./lib/tick.js"

type Mode = "normal" | "input" | "delete" | "kill" | "merge" | "push" | "pushing" | "request_changes" | "switch_branch"


function RunningCountSpinner({ count }: { count: number }) {
  const frame = useSpinnerFrame()
  return <text fg="#00aaff">{frame} {count}</text>
}


interface Props {
  repoRoot: string
  repoName: string
  initialTasks: Task[]
  renderer: CliRenderer
  onExit: () => void
}

function AppInner({ repoRoot, repoName, initialTasks, onExit }: Props) {
  const {
    tasks,
    setTasks,
    filterMode,
    setFilterMode,
    selectedIdx,
    setSelectedIdx,
    flashMessage,
    logPaneTaskId,
    setLogPaneTaskId,
    diffPaneTaskId,
    setDiffPaneTaskId,
    currentBranch,
    setCurrentBranch,
    isDirty,
    setIsDirty,
    prevSelectedIdx,
    visibleTasks,
    selectedTask,
    paneTask,
    showFlash,
  } = useAppState(initialTasks)
  const [mode, setMode] = useState<Mode>("normal")

  const refreshTasks = useCallback(() => {
    const state = readState(repoRoot)
    setTasks(sortDescending(state.tasks))
  }, [repoRoot])

  const refreshDirtyState = useCallback(() => {
    hasUnpushedCommits(repoRoot).then(setIsDirty).catch(() => {})
  }, [repoRoot])

  // Bootstrap on mount
  useEffect(() => {
    setCurrentBranch(readCurrentBranch(repoRoot))
    refreshDirtyState()
  }, [repoRoot, refreshDirtyState])

  // Watch state.json for changes and refresh when it's written.
  useFileWatch(stateFilePath(repoRoot), refreshTasks)

  // Watch .git/HEAD for branch changes and read the branch name directly
  // from the file rather than spawning a subprocess.
  const refreshBranchState = useCallback(() => {
    setCurrentBranch(readCurrentBranch(repoRoot))
    refreshDirtyState()
  }, [repoRoot, refreshDirtyState])
  useFileWatch(gitHeadPath(repoRoot), refreshBranchState)

  const runningCount = tasks.filter(t => t.status === "running").length

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
  }, [repoRoot, updateTaskInState])

  const handleKill = useCallback((task: Task | null = selectedTask) => {
    if (!task || task.status !== "running" || !task.pid) return
    killAgent(task.pid)
    updateTaskInState(task.id, {
      status: "failed",
      completedAt: new Date().toISOString(),
      pid: null,
    })
    setMode("normal")
  }, [selectedTask, updateTaskInState])

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
  }, [selectedTask])

  const handleOpenDiff = useCallback(() => {
    const task = paneTask ?? selectedTask
    if (!task || task.status !== "ready_to_merge") return
    setDiffPaneTaskId(task.id)
  }, [paneTask, selectedTask])

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
  }, [paneTask, repoRoot, updateTaskInState])

  const handleSwitchBranch = useCallback(async (branch: string) => {
    setMode("normal")
    try {
      await switchBranch(repoRoot, branch)
      showFlash(`Switched to branch ${branch}`)
    } catch (err) {
      showFlash(`Branch switch failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [repoRoot, showFlash])

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
  }, [repoRoot, currentBranch, showFlash, refreshDirtyState])

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
  }, [selectedTask, repoRoot, showFlash, updateTaskInState, refreshDirtyState])

  useKeyboard((key) => {
    if (mode === "input" || mode === "request_changes" || mode === "switch_branch") return

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
        if (paneTask && paneTask.sessionId && paneTask.status !== "running") setMode("request_changes")
        return
      }
      if (key.name === "l") { handleOpenLog(); setDiffPaneTaskId(null); return }
      if (key.name === "m") {
        if (paneTask) setMode("merge")
        return
      }
      if (key.name === "d") {
        if (paneTask) setMode("delete")
        return
      }
      return
    }

    if (logPaneTaskId !== null) {
      if (key.name === "x") {
        if (paneTask && paneTask.status === "running" && paneTask.pid) setMode("kill")
        return
      }
      if (key.name === "r") { handleResume(paneTask); return }
      if (key.name === "f") {
        if (paneTask && paneTask.status === "ready_to_merge") handleOpenDiff()
        return
      }
      if (key.name === "c") {
        if (paneTask && paneTask.sessionId && paneTask.status !== "running") setMode("request_changes")
        return
      }
      if (key.name === "d") {
        if (paneTask) setMode("delete")
        return
      }
      return
    }

    if (key.name === "n" || key.name === "c") { prevSelectedIdx.current = selectedIdx; setMode("input"); setSelectedIdx(-1); return }
    if (key.name === "up" || key.name === "k") { setSelectedIdx((i) => Math.max(0, i - 1)); return }
    if (key.name === "down" || key.name === "j") { setSelectedIdx((i) => Math.min(visibleTasks.length - 1, i + 1)); return }
    if (key.name === "x") {
      if (selectedTask && selectedTask.status === "running" && selectedTask.pid) setMode("kill")
      return
    }
    if (key.name === "o" || key.name === "return") { selectedTask?.status === "ready_to_merge" ? handleOpenDiff() : handleOpenLog(); return }
    if (key.name === "r") { handleResume(); return }
    if (key.name === "b") { setMode("switch_branch"); return }
    if (key.name === "d") {
      if (selectedTask) setMode("delete")
      return
    }
    if (key.name === "p") {
      if (isDirty) setMode("push")
      return
    }
  })

  const normalBindings = diffPaneTaskId ? [
    { key: "q", label: "back to list" },
    { key: "l", label: "back to log", disabled: !paneTask },
    { key: "↑↓", label: "scroll" },
    { key: "c", label: "request changes", disabled: !paneTask?.sessionId || paneTask?.status === "running" },
    { key: "m", label: "merge into HEAD", disabled: !paneTask },
    { key: "d", label: "delete", disabled: !paneTask },
  ] : logPaneTaskId ? [
    { key: "q", label: "back to list" },
    { key: "↑↓", label: "scroll" },
    { key: "x", label: "kill", disabled: !paneTask || paneTask.status !== "running" || !paneTask.pid },
    { key: "r", label: "resume", disabled: !paneTask || (paneTask.status !== "failed" && paneTask.status !== "done") || !paneTask.sessionId },
    { key: "f", label: "diff", disabled: !paneTask || paneTask.status !== "ready_to_merge" },
    { key: "c", label: "request changes", disabled: !paneTask?.sessionId || paneTask?.status === "running" },
    { key: "d", label: "delete", disabled: !paneTask },
  ] : [
    { key: "q", label: "quit" },
    { key: "n", label: "new task" },
    { key: "↑↓", label: "select", disabled: tasks.length === 0 },
    { key: "enter", label: "open", disabled: !selectedTask },
    { key: "x", label: "kill", disabled: !selectedTask || selectedTask.status !== "running" || !selectedTask.pid },
    { key: "r", label: "resume", disabled: !selectedTask || (selectedTask.status !== "failed" && selectedTask.status !== "done") || !selectedTask.sessionId },
    { key: "d", label: "delete", disabled: !selectedTask },
    { key: "b", label: "switch branch", disabled: !selectedTask },
    { key: "p", label: "push", disabled: !isDirty },
  ]

  return (
    <box style={{ flexDirection: "column", height: "100%", backgroundColor: "#000000" }}>
      <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222", flexDirection: "row", justifyContent: "space-between", height: 3 }}>
        <text><strong fg="#ff6600">faber</strong>{"  "}<span fg="#555555">{repoName}{currentBranch ? `:${currentBranch}` : ""}</span>{isDirty && <span fg="#ff6600">{" *"}</span>}</text>
        <box style={{ flexDirection: "row", gap: 1 }}>
          {runningCount > 0 && (
            <RunningCountSpinner count={runningCount} />
          )}
          {runningCount > 0 && tasks.filter(t => t.status === "ready_to_merge").length > 0 && (
            <text fg="#555555">{"•"}</text>
          )}
          {tasks.filter(t => t.status === "ready_to_merge").length > 0 && (
            <text fg="#ff9900">{"↑"} {tasks.filter(t => t.status === "ready_to_merge").length}</text>
          )}
        </box>
      </box>

      <box style={{ flexGrow: 1 }}>
        {diffPaneTaskId ? (() => {
          const diffTask = tasks.find((t) => t.id === diffPaneTaskId) ?? null
          return diffTask ? (
            <DiffView
              repoRoot={repoRoot}
              task={diffTask}
              disabled={mode === "request_changes"}
            />
          ) : null
        })() : logPaneTaskId ? (() => {
          const logTask = tasks.find((t) => t.id === logPaneTaskId) ?? null
          return logTask ? (
            <AgentLog
              repoRoot={repoRoot}
              task={logTask}
              disabled={mode === "request_changes"}
            />
          ) : null
        })() : (
          <AgentList
            tasks={visibleTasks}
            selectedId={selectedTask?.id ?? null}
            filterMode={filterMode}
            onFilterChange={setFilterMode}
            inputActive={mode === "input"}
            onSubmit={(prompt, model) => handleDispatch(prompt, model)}
            onCancel={() => { setMode("normal"); setSelectedIdx(prevSelectedIdx.current) }}
            onSelectTask={(id) => {
              const idx = visibleTasks.findIndex((t) => t.id === id)
              if (idx !== -1) setSelectedIdx(idx)
            }}
          />
        )}
      </box>

      <BottomBar
        mode={mode}
        flashMessage={flashMessage}
        paneTask={paneTask}
        selectedTask={selectedTask}
        currentBranch={currentBranch}
        bindings={normalBindings}
        onBranchSubmit={(branch) => handleSwitchBranch(branch)}
        onBranchCancel={() => setMode("normal")}
        onRequestChangesSubmit={(prompt) => handleRequestChanges(prompt)}
        onRequestChangesCancel={() => setMode("normal")}
      />
    </box>
  )
}

export function App(props: Props) {
  return (
    <TickProvider>
      <AppInner {...props} />
    </TickProvider>
  )
}
