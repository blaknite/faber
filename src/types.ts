export type TaskStatus = "running" | "done" | "failed"

export interface Task {
  id: string              // e.g. "a3f2-resolve-issue-uic-002"
  prompt: string          // the raw prompt sent to opencode
  status: TaskStatus
  pid: number | null      // null after process exits
  worktree: string        // relative path, e.g. ".worktrees/a3f2-resolve-issue-uic-002"
  sessionId: string | null  // opencode session ID, parsed from first JSON line of stdout
  startedAt: string       // ISO 8601
  completedAt: string | null
  exitCode: number | null
}

export interface State {
  tasks: Task[]
}
