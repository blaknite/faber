export type TaskStatus = "running" | "done" | "failed" | "unknown"

export type Model = "anthropic/claude-haiku-4-5" | "anthropic/claude-sonnet-4-6" | "anthropic/claude-opus-4-6"

export const MODELS: { label: string; value: Model; color: string }[] = [
  { label: "Sonnet", value: "anthropic/claude-sonnet-4-6", color: "#0088ff" },
  { label: "Haiku", value: "anthropic/claude-haiku-4-5", color: "#00cc66" },
  { label: "Opus", value: "anthropic/claude-opus-4-6", color: "#9966ff" },
]

export const DEFAULT_MODEL: Model = "anthropic/claude-sonnet-4-6"

export interface Task {
  id: string              // e.g. "a3f2-resolve-issue-uic-002"
  prompt: string          // the raw prompt sent to opencode
  model: Model            // the opencode model to use
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
