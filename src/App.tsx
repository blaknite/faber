import { useCallback, useEffect, useRef, useState } from "react"
import { useKeyboard } from "@opentui/react"
import type { CliRenderer } from "@opentui/core"
import { AgentList, ACTIVE_STATUSES, type FilterMode } from "./components/AgentList.js"
import { AgentLog } from "./components/AgentLog.js"
import { DiffView } from "./components/DiffView.js"
import { RequestChangesInput } from "./components/RequestChangesInput.js"
import { StatusBar } from "./components/StatusBar.js"
import { spawnAgent, killAgent } from "./lib/agent.js"
import { removeWorktree, mergeBranch } from "./lib/worktree.js"
import { generateSlug } from "./lib/slug.js"
import { addTask, readState, removeTask, updateTask } from "./lib/state.js"
import { createWorktree } from "./lib/worktree.js"
import { logTaskFailure } from "./lib/failureLog.js"
import type { Task, Model } from "./types.js"
import { DEFAULT_MODEL } from "./types.js"

type Mode = "normal" | "input" | "delete" | "kill" | "merge" | "request_changes"

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

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

export function App({ repoRoot, repoName, initialTasks, onExit }: Props) {
  const [tasks, setTasks] = useState<Task[]>(sortDescending(initialTasks))
  const [filterMode, setFilterMode] = useState<FilterMode>("active")
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [mode, setMode] = useState<Mode>("normal")
  const [flashMessage, setFlashMessage] = useState<string | null>(null)
  const [logPaneTaskId, setLogPaneTaskId] = useState<string | null>(null)
  const [diffPaneTaskId, setDiffPaneTaskId] = useState<string | null>(null)
  const [spinnerFrame, setSpinnerFrame] = useState(0)
  const prevSelectedIdx = useRef(0)

  const visibleTasks = filterMode === "active"
    ? tasks.filter((t) => ACTIVE_STATUSES.includes(t.status))
    : tasks

  const selectedTask = visibleTasks[selectedIdx] ?? null

  const refreshTasks = useCallback(() => {
    const state = readState(repoRoot)
    setTasks(sortDescending(state.tasks))
  }, [repoRoot])

  useEffect(() => {
    const interval = setInterval(refreshTasks, 2000)
    return () => clearInterval(interval)
  }, [refreshTasks])

  const runningCount = tasks.filter(t => t.status === "running").length

  useEffect(() => {
    if (runningCount === 0) return
    const interval = setInterval(() => {
      setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length)
    }, 100)
    return () => clearInterval(interval)
  }, [runningCount])

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

  const handleKill = useCallback(() => {
    if (!selectedTask || selectedTask.status !== "running" || !selectedTask.pid) return
    killAgent(selectedTask.pid)
    updateTaskInState(selectedTask.id, {
      status: "failed",
      completedAt: new Date().toISOString(),
      pid: null,
    })
    setMode("normal")
  }, [selectedTask, updateTaskInState])

  const handleClone = useCallback(() => {
    if (!selectedTask) return
    handleDispatch(selectedTask.prompt, selectedTask.model)
  }, [selectedTask, handleDispatch])

  const handleResume = useCallback(() => {
    if (!selectedTask || (selectedTask.status !== "failed" && selectedTask.status !== "done") || !selectedTask.sessionId) return
    if (selectedTask.pid) killAgent(selectedTask.pid)
    const patch: Partial<Task> = {
      status: "running",
      completedAt: null,
      exitCode: null,
    }
    updateTaskInState(selectedTask.id, patch)
    const task = { ...selectedTask, ...patch }
    spawnAgent(task, repoRoot, (p) => {
      updateTaskInState(selectedTask.id, p)
    }, selectedTask.sessionId)
  }, [selectedTask, repoRoot, updateTaskInState])

  const handleOpenLog = useCallback(() => {
    if (!selectedTask) return
    setLogPaneTaskId(selectedTask.id)
  }, [selectedTask])

  const handleOpenDiff = useCallback(() => {
    const taskId = logPaneTaskId ?? selectedTask?.id
    if (!taskId) return
    setDiffPaneTaskId(taskId)
  }, [logPaneTaskId, selectedTask])

  const handleRequestChanges = useCallback((prompt: string) => {
    if (!selectedTask || !selectedTask.sessionId) return
    setMode("normal")
    if (selectedTask.pid) killAgent(selectedTask.pid)
    const patch: Partial<Task> = {
      status: "running",
      completedAt: null,
      exitCode: null,
    }
    updateTaskInState(selectedTask.id, patch)
    const task = { ...selectedTask, ...patch }
    spawnAgent(task, repoRoot, (p) => {
      updateTaskInState(selectedTask.id, p)
    }, selectedTask.sessionId, prompt)
    setDiffPaneTaskId(null)
    setLogPaneTaskId(selectedTask.id)
  }, [selectedTask, repoRoot, updateTaskInState])

  const handleMerge = useCallback(async () => {
    if (!selectedTask) { setMode("normal"); return }
    setMode("normal")
    try {
      await mergeBranch(repoRoot, selectedTask.id)
      updateTaskInState(selectedTask.id, { status: "done" })
      showFlash(`Merged ${selectedTask.id} into HEAD`)
    } catch (err) {
      showFlash(`Merge failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [selectedTask, repoRoot, showFlash, updateTaskInState])

  useKeyboard((key) => {
    if (mode === "input" || mode === "request_changes") return

    if (key.name === "escape") {
      if (mode === "kill" || mode === "delete" || mode === "merge") { setMode("normal"); return }
      if (diffPaneTaskId !== null) { setDiffPaneTaskId(null); setLogPaneTaskId(null); return }
      if (logPaneTaskId !== null) { setLogPaneTaskId(null); return }
      return
    }

    if (key.ctrl && key.name === "c") { onExit(); return }

    if (mode === "kill") {
      if (key.name === "y") { handleKill(); return }
      if (key.name === "n" || key.name === "q") { setMode("normal"); return }
      return
    }

    if (mode === "delete") {
      if (key.name === "y") {
        if (!selectedTask) { setMode("normal"); return }
        if (selectedTask.pid) killAgent(selectedTask.pid)
        removeWorktree(repoRoot, selectedTask.id).catch(() => {})
        if (logPaneTaskId === selectedTask.id) setLogPaneTaskId(null)
        if (diffPaneTaskId === selectedTask.id) setDiffPaneTaskId(null)
        removeTaskFromState(selectedTask.id)
        setMode("normal")
        return
      }
      if (key.name === "n" || key.name === "q") { setMode("normal"); return }
      return
    }

    if (mode === "merge") {
      if (key.name === "y") { handleMerge(); return }
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
        if (selectedTask && selectedTask.sessionId) setMode("request_changes")
        return
      }
      if (key.name === "l") { handleOpenLog(); setDiffPaneTaskId(null); return }
      if (key.name === "m") {
        if (selectedTask) setMode("merge")
        return
      }
      if (key.name === "d") {
        if (selectedTask) setMode("delete")
        return
      }
      return
    }

    if (logPaneTaskId !== null) {
      if (mode === "request_changes") return
      if (key.name === "x") {
        if (selectedTask && selectedTask.status === "running" && selectedTask.pid) setMode("kill")
        return
      }
      if (key.name === "r") { handleResume(); return }
      if (key.name === "f") { handleOpenDiff(); return }
      if (key.name === "c") {
        if (selectedTask && selectedTask.sessionId) setMode("request_changes")
        return
      }
      if (key.name === "d") {
        if (selectedTask) setMode("delete")
        return
      }
      return
    }

    if (key.name === "n") { prevSelectedIdx.current = selectedIdx; setMode("input"); setSelectedIdx(-1); return }
    if (key.name === "up" || key.name === "k") { setSelectedIdx((i) => Math.max(0, i - 1)); return }
    if (key.name === "down" || key.name === "j") { setSelectedIdx((i) => Math.min(visibleTasks.length - 1, i + 1)); return }
    if (key.name === "x") {
      if (selectedTask && selectedTask.status === "running" && selectedTask.pid) setMode("kill")
      return
    }
    if (key.name === "o" || key.name === "return") { handleOpenLog(); return }
    if (key.name === "r") { handleResume(); return }
    if (key.name === "c") { handleClone(); return }
    if (key.name === "d") {
      if (selectedTask) setMode("delete")
      return
    }
  })

  const normalBindings = diffPaneTaskId ? [
    { key: "q", label: "back to list" },
    { key: "l", label: "back to log", disabled: !selectedTask },
    { key: "↑↓", label: "scroll" },
    { key: "c", label: "request changes", disabled: !selectedTask?.sessionId },
    { key: "m", label: "merge into HEAD", disabled: !selectedTask },
    { key: "d", label: "delete", disabled: !selectedTask },
  ] : logPaneTaskId ? [
    { key: "q", label: "back to list" },
    { key: "↑↓", label: "scroll" },
    { key: "x", label: "kill", disabled: !selectedTask || selectedTask.status !== "running" || !selectedTask.pid },
    { key: "r", label: "resume", disabled: !selectedTask || (selectedTask.status !== "failed" && selectedTask.status !== "done") || !selectedTask.sessionId },
    { key: "f", label: "diff", disabled: !selectedTask },
    { key: "c", label: "request changes", disabled: !selectedTask?.sessionId },
    { key: "d", label: "delete", disabled: !selectedTask },
  ] : [
    { key: "n", label: "new task" },
    { key: "↑↓", label: "select", disabled: tasks.length === 0 },
    { key: "enter", label: "open", disabled: !selectedTask },
    { key: "x", label: "kill", disabled: !selectedTask || selectedTask.status !== "running" || !selectedTask.pid },
    { key: "r", label: "resume", disabled: !selectedTask || (selectedTask.status !== "failed" && selectedTask.status !== "done") || !selectedTask.sessionId },
    { key: "c", label: "clone", disabled: !selectedTask },
    { key: "d", label: "delete", disabled: !selectedTask },
    { key: "q", label: "quit" },
  ]

  const bottomBar = flashMessage ? (
    <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222" }}>
      <text fg="#ff8800">{flashMessage}</text>
    </box>
  ) : mode === "request_changes" && (diffPaneTaskId || logPaneTaskId) ? (
    <RequestChangesInput
      onSubmit={(prompt) => handleRequestChanges(prompt)}
      onCancel={() => setMode("normal")}
    />
  ) : mode === "kill" && selectedTask ? (
    <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222" }}>
      <text><strong>{`Kill ${selectedTask.id}?`}</strong>{` [y/n]`}</text>
    </box>
  ) : mode === "delete" && selectedTask ? (
    <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222" }}>
      <text><strong>{`Delete ${selectedTask.id}?`}</strong>{` [y/n]`}</text>
    </box>
  ) : mode === "merge" && selectedTask ? (
    <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222" }}>
      <text><strong>{`Merge ${selectedTask.id} into HEAD?`}</strong>{` [y/n]`}</text>
    </box>
  ) : (
    <StatusBar bindings={normalBindings} />
  )

  return (
    <box style={{ flexDirection: "column", height: "100%", backgroundColor: "#000000" }}>
      <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222", flexDirection: "row", justifyContent: "space-between" }}>
        <text><strong fg="#ff6600">faber</strong>{"  "}<span fg="#555555">{repoName}</span></text>
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

      <box style={{ flexGrow: 1, flexDirection: "row" }}>
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
