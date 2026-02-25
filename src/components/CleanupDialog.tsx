import { useKeyboard } from "@opentui/react"
import type { Task } from "../types.js"
import { removeWorktree } from "../lib/worktree.js"

interface Props {
  task: Task
  repoRoot: string
  onDone: () => void
  onCancel: () => void
}

export function CleanupDialog({ task, repoRoot, onDone, onCancel }: Props) {
  useKeyboard(async (key) => {
    if (key.name === "escape" || key.name === "q") {
      onCancel()
      return
    }
    if (key.name === "r") {
      try {
        await removeWorktree(repoRoot, task.id)
      } catch {
        // Worktree may already be gone
      }
      onDone()
    }
  })

  const statusColor = task.status === "done" ? "#00cc66" : "#cc3333"

  return (
    <box
      style={{ flexDirection: "column", padding: 1, marginLeft: 4, marginRight: 4, marginTop: 1, marginBottom: 1 }}
      border={true}
    >
      <box style={{ marginBottom: 1 }}>
        <text><strong>{task.id}</strong><span fg={statusColor}>{` [${task.status}]`}</span></text>
      </box>
      <box style={{ marginBottom: 1 }}>
        <text fg="#555555">{`Worktree: ${task.worktree}`}</text>
      </box>
      <box style={{ gap: 3 }}>
        <text><strong>[r]</strong>{" remove worktree"}</text>
        <text><strong>[esc]</strong>{" cancel"}</text>
      </box>
    </box>
  )
}
