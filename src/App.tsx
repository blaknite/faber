import { useCallback, useEffect, useState } from "react"
import { useKeyboard } from "@opentui/react"
import type { CliRenderer } from "@opentui/core"
import { execa } from "execa"
import { AgentList } from "./components/AgentList.js"
import { AgentLog } from "./components/AgentLog.js"
import { StatusBar } from "./components/StatusBar.js"
import { TaskInput } from "./components/TaskInput.js"
import { spawnAgent, killAgent } from "./lib/agent.js"
import { removeWorktree } from "./lib/worktree.js"
import { generateSlug } from "./lib/slug.js"
import { addTask, readState, removeTask, updateTask } from "./lib/state.js"
import { createWorktree } from "./lib/worktree.js"
import type { Task, Model } from "./types.js"
import { DEFAULT_MODEL } from "./types.js"

type Mode = "normal" | "input" | "delete" | "kill"

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
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [mode, setMode] = useState<Mode>("normal")
  const [flashMessage, setFlashMessage] = useState<string | null>(null)
  const [logPaneTaskId, setLogPaneTaskId] = useState<string | null>(null)
  const selectedTask = tasks[selectedIdx] ?? null

  const refreshTasks = useCallback(() => {
    const state = readState(repoRoot)
    setTasks(sortDescending(state.tasks))
  }, [repoRoot])

  useEffect(() => {
    const interval = setInterval(refreshTasks, 2000)
    return () => clearInterval(interval)
  }, [refreshTasks])

  const updateTaskInState = useCallback((id: string, patch: Partial<Task>) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
    )
    updateTask(repoRoot, id, patch)
  }, [repoRoot])

  const removeTaskFromState = useCallback((id: string) => {
    setTasks((prev) => {
      const next = prev.filter((t) => t.id !== id)
      setSelectedIdx((i) => Math.min(i, Math.max(0, next.length - 1)))
      return next
    })
    removeTask(repoRoot, id)
  }, [repoRoot])

  const showFlash = useCallback((msg: string) => {
    setFlashMessage(msg)
    setTimeout(() => setFlashMessage(null), 2000)
  }, [])

  const handleDispatch = useCallback(async (prompt: string, model: Model = DEFAULT_MODEL) => {
    setMode("normal")
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
    } catch {
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
    setMode("normal")
  }, [selectedTask])

  const handleSession = useCallback(() => {
    if (!selectedTask) return
    if (!selectedTask.sessionId) { showFlash("No session ID yet -- task may still be starting."); return }
    const cmd = `opencode -s ${selectedTask.sessionId}`
    execa("pbcopy", { input: cmd }).catch(() => {})
    showFlash(`Run \`${cmd}\` (copied to clipboard)`)
  }, [selectedTask, showFlash])

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

  useKeyboard((key) => {
    if (mode === "input") return

    if (key.name === "escape") {
      if (mode === "kill" || mode === "delete") { setMode("normal"); return }
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
        removeTaskFromState(selectedTask.id)
        setMode("normal")
        return
      }
      if (key.name === "n" || key.name === "q") { setMode("normal"); return }
      return
    }

    if (key.name === "q") {
      if (logPaneTaskId !== null) { setLogPaneTaskId(null); return }
      onExit()
      return
    }

    if (logPaneTaskId !== null) {
      if (key.name === "x") {
        if (selectedTask && selectedTask.status === "running" && selectedTask.pid) setMode("kill")
        return
      }
      if (key.name === "r") { handleResume(); return }
      if (key.name === "s") { handleSession(); return }
      if (key.name === "d") {
        if (selectedTask) setMode("delete")
        return
      }
      return
    }

    if (key.name === "n") { setMode("input"); return }
    if (key.name === "up" || key.name === "k") { setSelectedIdx((i) => Math.max(0, i - 1)); return }
    if (key.name === "down" || key.name === "j") { setSelectedIdx((i) => Math.min(tasks.length - 1, i + 1)); return }
    if (key.name === "x") {
      if (selectedTask && selectedTask.status === "running" && selectedTask.pid) setMode("kill")
      return
    }
    if (key.name === "o" || key.name === "return") { handleOpenLog(); return }
    if (key.name === "s") { handleSession(); return }
    if (key.name === "r") { handleResume(); return }
    if (key.name === "c") { handleClone(); return }
    if (key.name === "d") {
      if (selectedTask) setMode("delete")
      return
    }
  })

  const normalBindings = logPaneTaskId ? [
    { key: "q", label: "back to list" },
    { key: "↑↓", label: "scroll" },
    { key: "x", label: "kill", disabled: !selectedTask || selectedTask.status !== "running" || !selectedTask.pid },
    { key: "r", label: "resume", disabled: !selectedTask || (selectedTask.status !== "failed" && selectedTask.status !== "done") || !selectedTask.sessionId },
    { key: "s", label: "session", disabled: !selectedTask?.sessionId },
    { key: "d", label: "delete", disabled: !selectedTask },
  ] : [
    { key: "n", label: "new task" },
    { key: "↑↓", label: "select", disabled: tasks.length === 0 },
    { key: "o/enter", label: "open", disabled: !selectedTask },
    { key: "x", label: "kill", disabled: !selectedTask || selectedTask.status !== "running" || !selectedTask.pid },
    { key: "r", label: "resume", disabled: !selectedTask || (selectedTask.status !== "failed" && selectedTask.status !== "done") || !selectedTask.sessionId },
    { key: "s", label: "session", disabled: !selectedTask?.sessionId },
    { key: "c", label: "clone", disabled: !selectedTask },
    { key: "d", label: "delete", disabled: !selectedTask },
    { key: "q", label: "quit" },
  ]

  const bottomBar = flashMessage ? (
    <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222" }}>
      <text fg="#0088ff">{flashMessage}</text>
    </box>
  ) : mode === "input" ? (
    <TaskInput onSubmit={(prompt, model) => handleDispatch(prompt, model)} onCancel={() => setMode("normal")} />
  ) : mode === "kill" && selectedTask ? (
    <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222" }}>
      <text><strong>{`Kill ${selectedTask.id}?`}</strong>{` [y/n]`}</text>
    </box>
  ) : mode === "delete" && selectedTask ? (
    <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222" }}>
      <text><strong>{`Delete ${selectedTask.id}?`}</strong>{` [y/n]`}</text>
    </box>
  ) : (
    <StatusBar bindings={normalBindings} />
  )

  return (
    <box style={{ flexDirection: "column", height: "100%", backgroundColor: "#000000" }}>
      <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222", flexDirection: "row", justifyContent: "space-between" }}>
        <text><strong fg="#ff6600">faber</strong>{"  "}<span fg="#555555">{repoName}</span></text>
        {tasks.filter(t => t.status === "running").length > 0 && (
          <text fg="#ff6600">{tasks.filter(t => t.status === "running").length} running</text>
        )}
      </box>

      <box style={{ flexGrow: 1, flexDirection: "row" }}>
        {logPaneTaskId ? (() => {
          const logTask = tasks.find((t) => t.id === logPaneTaskId) ?? null
          return logTask ? (
            <AgentLog
              repoRoot={repoRoot}
              task={logTask}
            />
          ) : null
        })() : (
          <AgentList tasks={tasks} selectedId={selectedTask?.id ?? null} />
        )}
      </box>

      {bottomBar}
    </box>
  )
}
