import React, { useCallback, useEffect, useState } from "react"
import { Box, Text, useApp, useInput } from "ink"
import { execa } from "execa"
import { AgentList } from "./components/AgentList.js"
import { CleanupDialog } from "./components/CleanupDialog.js"
import { StatusBar } from "./components/StatusBar.js"
import { TaskInput } from "./components/TaskInput.js"
import { spawnAgent, killAgent } from "./lib/agent.js"
import { generateSlug } from "./lib/slug.js"
import { addTask, readState, removeTask, updateTask } from "./lib/state.js"
import { createWorktree } from "./lib/worktree.js"
import type { Task } from "./types.js"

type Mode = "normal" | "input" | "cleanup"

interface Props {
  repoRoot: string
  repoName: string
  initialTasks: Task[]
}

export function App({ repoRoot, repoName, initialTasks }: Props) {
  const { exit } = useApp()
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
    setTimeout(() => setFlashMessage(null), 2000)
  }, [])

  const handleDispatch = useCallback(async (prompt: string) => {
    setMode("normal")
    const slug = generateSlug(prompt)
    const worktree = `.worktrees/${slug}`
    const task: Task = {
      id: slug,
      prompt,
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
    } catch (err) {
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
  }, [selectedTask])

  const handleSession = useCallback(() => {
    if (!selectedTask) return
    if (!selectedTask.sessionId) { showFlash("No session ID yet -- task may still be starting."); return }
    const cmd = `opencode -s ${selectedTask.sessionId}`
    execa("pbcopy", { input: cmd }).catch(() => {
      // pbcopy not available on non-macOS -- flash still shows
    })
    showFlash(`Copied: ${cmd}`)
  }, [selectedTask, showFlash])

  useInput((input, key) => {
    if (mode === "cleanup") return
    if (mode === "input") return

    if (input === "n") { setMode("input"); return }
    if (input === "q" || (key.ctrl && input === "c")) { exit(); return }
    if (key.upArrow || input === "k") { setSelectedIdx((i) => Math.max(0, i - 1)); return }
    if (key.downArrow || input === "j") { setSelectedIdx((i) => Math.min(tasks.length - 1, i + 1)); return }
    if (input === "x") { handleKill(); return }
    if (input === "s") { handleSession(); return }
    if (input === "c") {
      if (selectedTask && selectedTask.status !== "running") setMode("cleanup")
      return
    }
  })

  const normalBindings = [
    { key: "n", label: "new task" },
    { key: "↑↓", label: "select" },
    { key: "s", label: "copy session" },
    { key: "x", label: "kill" },
    { key: "c", label: "clean up" },
    { key: "q", label: "quit" },
  ]

  const bottomBar = flashMessage ? (
    <Box paddingX={1}>
      <Text color="green">{flashMessage}</Text>
    </Box>
  ) : mode === "input" ? (
    <TaskInput onSubmit={handleDispatch} onCancel={() => setMode("normal")} />
  ) : mode === "cleanup" && selectedTask ? (
    <CleanupDialog
      task={selectedTask}
      repoRoot={repoRoot}
      onDone={() => {
        removeTaskFromState(selectedTask.id)
        setMode("normal")
      }}
      onCancel={() => setMode("normal")}
    />
  ) : (
    <StatusBar bindings={normalBindings} />
  )

  return (
    <Box flexDirection="column" height="100%">
      <Box paddingX={1} paddingY={0}>
        <Text bold>faber</Text>
        <Text dimColor>  {repoName}</Text>
      </Box>

      <Box flexGrow={1} flexDirection="column">
        <AgentList tasks={tasks} selectedId={selectedTask?.id ?? null} />
      </Box>

      {bottomBar}
    </Box>
  )
}
