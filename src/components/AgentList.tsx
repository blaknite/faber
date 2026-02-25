import React, { useEffect, useState } from "react"
import { Box, Text } from "ink"
import type { Task, TaskStatus } from "../types.js"

interface Props {
  tasks: Task[]
  selectedId: string | null
}

const STATUS_COLOR: Record<TaskStatus, string> = {
  running: "cyan",
  done: "green",
  failed: "red",
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  running: "running",
  done: "done   ",
  failed: "failed ",
}

function Elapsed({ startedAt, completedAt }: { startedAt: string; completedAt: string | null }) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (completedAt) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [completedAt])

  const end = completedAt ? new Date(completedAt).getTime() : now
  const elapsed = Math.floor((end - new Date(startedAt).getTime()) / 1000)
  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  return <Text dimColor>{mins}m {String(secs).padStart(2, "0")}s</Text>
}

export function AgentList({ tasks, selectedId }: Props) {
  if (tasks.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text dimColor>No tasks yet. Press [n] to dispatch one.</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {tasks.map((task) => {
        const selected = task.id === selectedId
        return (
          <Box
            key={task.id}
            flexDirection="column"
            paddingX={1}
            paddingY={0}
            borderStyle={selected ? "single" : undefined}
            borderColor={selected ? "white" : undefined}
          >
            <Box gap={2}>
              <Text bold={selected} color={selected ? "white" : "gray"}>{task.id.slice(0, 6)}</Text>
              <Text color={STATUS_COLOR[task.status]}>{STATUS_LABEL[task.status]}</Text>
              <Elapsed startedAt={task.startedAt} completedAt={task.completedAt} />
            </Box>
            <Box paddingLeft={2}>
              <Text dimColor={!selected} wrap="truncate">{task.prompt}</Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
