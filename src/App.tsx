import { useCallback, useEffect, useState } from "react"
import { useKeyboard } from "@opentui/react"
import type { CliRenderer } from "@opentui/core"
import { execa } from "execa"
import { AgentList } from "./components/AgentList.js"
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

interface Props {
  repoRoot: string
  repoName: string
  initialTasks: Task[]
  renderer: CliRenderer
  onExit: () => void
}

export function App({ repoRoot, repoName, initialTasks, onExit }: Props) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [mode, setMode] = useState<Mode>("normal")
  const [flashMessage, setFlashMessage] = useState<string | null>(null)

  const selectedTask = tasks[selectedIdx] ?? null

  const refreshTasks = useCallback(() => {
    const state = readState(repoRoot)
    setTasks(state.tasks)
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
    setTimeout(() => setFlashMessage(null), 4000)
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
      const next = [...prev, task]
      setSelectedIdx(next.length - 1)
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

  useKeyboard((key) => {
    if (mode === "input") return

    if (mode === "kill") {
      if (key.name === "y") { handleKill(); return }
      if (key.name === "n" || key.name === "escape" || key.name === "q") { setMode("normal"); return }
      return
    }

    if (mode === "delete") {
      if (key.name === "y") {
        if (!selectedTask) { setMode("normal"); return }
        if (selectedTask.pid) killAgent(selectedTask.pid)
        removeWorktree(repoRoot, selectedTask.id).catch(() => {})
        removeTaskFromState(selectedTask.id)
        setMode("normal")
        return
      }
      if (key.name === "n" || key.name === "escape" || key.name === "q") { setMode("normal"); return }
      return
    }

    if (key.name === "n") { setMode("input"); return }
    if (key.name === "q" || (key.ctrl && key.name === "c")) { onExit(); return }
    if (key.name === "up" || key.name === "k") { setSelectedIdx((i) => Math.max(0, i - 1)); return }
    if (key.name === "down" || key.name === "j") { setSelectedIdx((i) => Math.min(tasks.length - 1, i + 1)); return }
    if (key.name === "x") {
      if (selectedTask && selectedTask.status === "running" && selectedTask.pid) setMode("kill")
      return
    }
    if (key.name === "o") { handleSession(); return }
    if (key.name === "d") {
      if (selectedTask) setMode("delete")
      return
    }
  })

  const normalBindings = [
    { key: "n", label: "new task" },
    { key: "↑↓", label: "select", disabled: tasks.length === 0 },
    { key: "o", label: "open", disabled: !selectedTask?.sessionId },
    { key: "x", label: "kill", disabled: !selectedTask || selectedTask.status !== "running" || !selectedTask.pid },
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
      <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222" }}>
        <text><strong fg="#ff6600">faber</strong>{"  "}<span fg="#555555">{repoName}</span></text>
      </box>

      <box style={{ flexGrow: 1, flexDirection: "column" }}>
        <AgentList tasks={tasks} selectedId={selectedTask?.id ?? null} />
      </box>

      {bottomBar}
    </box>
  )
}
