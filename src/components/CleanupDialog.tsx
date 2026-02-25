import React from "react"
import { Box, Text, useInput } from "ink"
import type { Task } from "../types.js"
import { removeWorktree } from "../lib/worktree.js"

interface Props {
  task: Task
  repoRoot: string
  onDone: () => void
  onCancel: () => void
}

export function CleanupDialog({ task, repoRoot, onDone, onCancel }: Props) {
  useInput(async (input, key) => {
    if (key.escape || input === "q") {
      onCancel()
      return
    }
    if (input === "r") {
      try {
        await removeWorktree(repoRoot, task.id)
      } catch {
        // Worktree may already be gone
      }
      onDone()
    }
  })

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      padding={1}
      marginX={4}
      marginY={1}
    >
      <Box marginBottom={1}>
        <Text bold>{task.id}</Text>
        <Text color={task.status === "done" ? "green" : "red"}> [{task.status}]</Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>Worktree: {task.worktree}</Text>
      </Box>
      <Box gap={3}>
        <Box>
          <Text bold>[r]</Text>
          <Text> remove worktree</Text>
        </Box>
        <Box>
          <Text bold>[esc]</Text>
          <Text> cancel</Text>
        </Box>
      </Box>
    </Box>
  )
}
