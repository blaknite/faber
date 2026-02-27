import { useCallback, useEffect, useRef, useState } from "react"
import { useKeyboard } from "@opentui/react"
import type { CliRenderer } from "@opentui/core"
import { AgentList, ACTIVE_STATUSES, type FilterMode } from "./components/AgentList.js"
import { AgentLog } from "./components/AgentLog.js"
import { DiffView } from "./components/DiffView.js"
import { BranchInput } from "./components/BranchInput.js"
import { RequestChangesInput } from "./components/RequestChangesInput.js"
import { StatusBar } from "./components/StatusBar.js"
import { spawnAgent, killAgent } from "./lib/agent.js"
import { removeWorktree, mergeBranch, getCommitsAhead, switchBranch, pushBranch, gitHeadPath, readCurrentBranch } from "./lib/worktree.js"
import { generateSlug } from "./lib/slug.js"
import { addTask, readState, removeTask, updateTask, stateFilePath } from "./lib/state.js"
import { watch, statSync, existsSync } from "node:fs"
import type { FSWatcher } from "node:fs"
import { createWorktree } from "./lib/worktree.js"
import { logTaskFailure } from "./lib/failureLog.js"
import type { Task, Model } from "./types.js"
import { DEFAULT_MODEL } from "./types.js"
import { TickContext, SPINNER_FRAMES, useTickProvider, useTick } from "./lib/tick.js"

type Mode = "normal" | "input" | "delete" | "kill" | "merge" | "push" | "pushing" | "request_changes" | "switch_branch"


function sortDescending(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

interface Props {
  repoRoot: string
  repoName: string
  initialTasks: Task[]
  renderer: CliRenderer
  onExit: () => void
}

function AppInner({ repoRoot, repoName, initialTasks, onExit }: Props) {
  const [tasks, setTasks] = useState<Task[]>(sortDescending(initialTasks))
  const [filterMode, setFilterMode] = useState<FilterMode>("active")
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [mode, setMode] = useState<Mode>("normal")
  const [flashMessage, setFlashMessage] = useState<string | null>(null)
  const [logPaneTaskId, setLogPaneTaskId] = useState<string | null>(null)
  const [diffPaneTaskId, setDiffPaneTaskId] = useState<string | null>(null)
  const [currentBranch, setCurrentBranch] = useState<string>("")
  const [commitsAhead, setCommitsAhead] = useState<number>(0)
  const prevSelectedIdx = useRef(0)

  const tick = useTick()
  const spinnerFrame = tick % SPINNER_FRAMES.length

  const visibleTasks = filterMode === "active"
    ? tasks.filter((t) => ACTIVE_STATUSES.includes(t.status))
    : tasks

  const selectedTask = visibleTasks[selectedIdx] ?? null

  // When viewing a log or diff pane, actions must operate on the task being
  // viewed, not on selectedTask (which is position-based in the filtered list).
  // If the filter hides a task after it's killed, selectedTask silently shifts
  // to whatever lands at that index -- paneTask prevents that mismatch.
  const paneTask = (diffPaneTaskId ?? logPaneTaskId)
    ? tasks.find((t) => t.id === (diffPaneTaskId ?? logPaneTaskId)) ?? null
    : null

  const refreshTasks = useCallback(() => {
    const state = readState(repoRoot)
    setTasks(sortDescending(state.tasks))
  }, [repoRoot])

  const refreshCommitsAhead = useCallback(() => {
    getCommitsAhead(repoRoot).then(setCommitsAhead).catch(() => {})
  }, [repoRoot])

  // Bootstrap on mount
  useEffect(() => {
    setCurrentBranch(readCurrentBranch(repoRoot))
    refreshCommitsAhead()
  }, [repoRoot, refreshCommitsAhead])

  // Watch state.json for changes and refresh immediately when it's written.
  // A watchdog runs alongside fs.watch because FSEvents on macOS can silently
  // stop delivering notifications under high I/O. If the file's mtime has
  // moved forward since the last refresh but the watcher hasn't fired, the
  // watchdog calls refreshTasks itself and recreates the watcher.
  useEffect(() => {
    const statePath = stateFilePath(repoRoot)
    let watcher: FSWatcher | null = null
    let lastRefreshedMtime = 0

    const doRefresh = () => {
      try {
        lastRefreshedMtime = existsSync(statePath) ? statSync(statePath).mtimeMs : 0
      } catch {
        lastRefreshedMtime = 0
      }
      refreshTasks()
    }

    const startWatching = () => {
      if (watcher) return
      try {
        watcher = watch(statePath, doRefresh)
        watcher.on("error", () => {
          watcher?.close()
          watcher = null
        })
      } catch {
        // watch() failed, watchdog will retry
      }
    }

    startWatching()

    const watchdog = setInterval(() => {
      let currentMtime = 0
      try {
        currentMtime = existsSync(statePath) ? statSync(statePath).mtimeMs : 0
      } catch {
        return
      }
      if (currentMtime > lastRefreshedMtime) {
        doRefresh()
        watcher?.close()
        watcher = null
      }
      if (!watcher) startWatching()
    }, 1000)

    return () => {
      watcher?.close()
      clearInterval(watchdog)
    }
  }, [repoRoot, refreshTasks])

  // Watch .git/HEAD for branch changes and read the branch name directly
  // from the file rather than spawning a subprocess. Same watchdog pattern
  // as the state.json watcher.
  useEffect(() => {
    const headPath = gitHeadPath(repoRoot)
    let watcher: FSWatcher | null = null
    let lastRefreshedMtime = 0

    const doRefresh = () => {
      try {
        lastRefreshedMtime = existsSync(headPath) ? statSync(headPath).mtimeMs : 0
      } catch {
        lastRefreshedMtime = 0
      }
      setCurrentBranch(readCurrentBranch(repoRoot))
    }

    const startWatching = () => {
      if (watcher) return
      try {
        watcher = watch(headPath, doRefresh)
        watcher.on("error", () => {
          watcher?.close()
          watcher = null
        })
      } catch {
        // watch() failed, watchdog will retry
      }
    }

    startWatching()

    const watchdog = setInterval(() => {
      let currentMtime = 0
      try {
        currentMtime = existsSync(headPath) ? statSync(headPath).mtimeMs : 0
      } catch {
        return
      }
      if (currentMtime > lastRefreshedMtime) {
        doRefresh()
        watcher?.close()
        watcher = null
      }
      if (!watcher) startWatching()
    }, 1000)

    return () => {
      watcher?.close()
      clearInterval(watchdog)
    }
  }, [repoRoot])

  const runningCount = tasks.filter(t => t.status === "running").length

  const updateTaskInState = useCallback((id: string, patch: Partial<Task>) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
    )
    updateTask(repoRoot, id, patch)
  }, [repoRoot])

  const removeTaskFromState = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id))
    removeTask(repoRoot, id)
  }, [repoRoot])

  // Keep selectedIdx in bounds when visibleTasks changes (filter toggle, task added/removed).
  useEffect(() => {
    setSelectedIdx((i) => Math.min(i, Math.max(0, visibleTasks.length - 1)))
  }, [visibleTasks.length])

  const showFlash = useCallback((msg: string) => {
    setFlashMessage(msg)
    setTimeout(() => setFlashMessage(null), 2000)
  }, [])

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

    setTasks((prev) => {
      const next = [task, ...prev]
      setSelectedIdx(0)
      return next
    })
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

    spawnAgent(task, repoRoot, (patch) => {
      updateTaskInState(slug, patch)
    })
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
    spawnAgent(updated, repoRoot, (p) => {
      updateTaskInState(task.id, p)
    }, task.sessionId)
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
    spawnAgent(updated, repoRoot, (p) => {
      updateTaskInState(task.id, p)
    }, task.sessionId, prompt)
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
      refreshCommitsAhead()
    } catch (err) {
      showFlash(`Push failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setMode("normal")
    }
  }, [repoRoot, currentBranch, showFlash, refreshCommitsAhead])

  const handleMerge = useCallback(async (task: Task | null = selectedTask) => {
    if (!task) { setMode("normal"); return }
    setMode("normal")
    try {
      await mergeBranch(repoRoot, task.id)
      updateTaskInState(task.id, { status: "done" })
      showFlash(`Merged ${task.id} into HEAD`)
      refreshCommitsAhead()
    } catch (err) {
      showFlash(`Merge failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [selectedTask, repoRoot, showFlash, updateTaskInState, refreshCommitsAhead])

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
      setMode("push")
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
    { key: "n", label: "new task" },
    { key: "↑↓", label: "select", disabled: tasks.length === 0 },
    { key: "enter", label: "open", disabled: !selectedTask },
    { key: "x", label: "kill", disabled: !selectedTask || selectedTask.status !== "running" || !selectedTask.pid },
    { key: "r", label: "resume", disabled: !selectedTask || (selectedTask.status !== "failed" && selectedTask.status !== "done") || !selectedTask.sessionId },
    { key: "b", label: "switch branch", disabled: !selectedTask },
    { key: "p", label: "push" },
    { key: "d", label: "delete", disabled: !selectedTask },
    { key: "q", label: "quit" },
  ]

  const bottomBar = flashMessage ? (
    <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222" }}>
      <text fg="#ff8800">{flashMessage}</text>
    </box>
  ) : mode === "switch_branch" ? (
    <BranchInput
      onSubmit={(branch) => handleSwitchBranch(branch)}
      onCancel={() => setMode("normal")}
    />
  ) : mode === "request_changes" && (diffPaneTaskId || logPaneTaskId) ? (
    <RequestChangesInput
      onSubmit={(prompt) => handleRequestChanges(prompt)}
      onCancel={() => setMode("normal")}
    />
  ) : mode === "kill" && (paneTask ?? selectedTask) ? (
    <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222" }}>
      <text><strong>{`Kill ${(paneTask ?? selectedTask)!.id}?`}</strong>{` [y/n]`}</text>
    </box>
  ) : mode === "delete" && (paneTask ?? selectedTask) ? (
    <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222" }}>
      <text><strong>{`Delete ${(paneTask ?? selectedTask)!.id}?`}</strong>{` [y/n]`}</text>
    </box>
  ) : mode === "merge" && (paneTask ?? selectedTask) ? (
    <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222" }}>
      <text><strong>{`Merge ${(paneTask ?? selectedTask)!.id} into HEAD?`}</strong>{` [y/n]`}</text>
    </box>
  ) : mode === "push" ? (
    <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222" }}>
      <text><strong>{`Push ${currentBranch} to origin?`}</strong>{` [y/n]`}</text>
    </box>
  ) : mode === "pushing" ? (
    <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222" }}>
      <text fg="#00aaff">{SPINNER_FRAMES[spinnerFrame]}{` Pushing ${currentBranch} to origin...`}</text>
    </box>
  ) : (
    <StatusBar bindings={normalBindings} />
  )

  return (
    <box style={{ flexDirection: "column", height: "100%", backgroundColor: "#000000" }}>
      <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222", flexDirection: "row", justifyContent: "space-between", height: 3 }}>
        <text><strong fg="#ff6600">faber</strong>{"  "}<span fg="#555555">{repoName}{currentBranch ? `:${currentBranch}${commitsAhead > 0 ? ` ↑ ${commitsAhead}` : ""}` : ""}</span></text>
        <box style={{ flexDirection: "row", gap: 1 }}>
          {runningCount > 0 && (
            <text fg="#00aaff">{SPINNER_FRAMES[spinnerFrame]} {runningCount}</text>
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

      {bottomBar}
    </box>
  )
}

export function App(props: Props) {
  const tickValue = useTickProvider()
  return (
    <TickContext.Provider value={tickValue}>
      <AppInner {...props} />
    </TickContext.Provider>
  )
}
