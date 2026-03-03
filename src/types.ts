export type TaskStatus = "running" | "done" | "ready" | "failed" | "stopped" | "unknown"

export type Mode = "normal" | "input" | "delete" | "kill" | "merge" | "push" | "pushing" | "continue" | "switch_branch"

export type Model = "anthropic/claude-haiku-4-5" | "anthropic/claude-sonnet-4-6" | "anthropic/claude-opus-4-6"

export const MODELS: { label: string; value: Model; color: string; dimColor: string }[] = [
  { label: "Smart", value: "anthropic/claude-sonnet-4-6", color: "#0088ff", dimColor: "#1a4466" },
  { label: "Fast", value: "anthropic/claude-haiku-4-5", color: "#00cc66", dimColor: "#1a4d36" },
  { label: "Deep", value: "anthropic/claude-opus-4-6", color: "#9966ff", dimColor: "#3d2d55" },
]

export const DEFAULT_MODEL: Model = "anthropic/claude-sonnet-4-6"

// Resolves a --model flag value to a Model. Accepts case-insensitive labels
// (smart, fast, deep) or a literal model ID string. Returns null if the value
// doesn't match anything known.
export function resolveModel(input: string): Model | null {
  const lower = input.toLowerCase()
  const byLabel = MODELS.find((m) => m.label.toLowerCase() === lower)
  if (byLabel) return byLabel.value
  const byValue = MODELS.find((m) => m.value.toLowerCase() === lower)
  if (byValue) return byValue.value
  return null
}

export interface Task {
  id: string              // e.g. "a3f2-resolve-issue-uic-002"
  prompt: string          // the raw prompt sent to opencode
  summaryText?: string    // LLM-generated summary of the prompt, used for fuzzy matching in the selector
  model: Model            // the opencode model to use
  status: TaskStatus
  pid: number | null      // null after process exits
  worktree: string        // relative path, e.g. ".worktrees/a3f2-resolve-issue-uic-002"
  sessionId: string | null  // opencode session ID, parsed from first JSON line of stdout
  startedAt: string       // ISO 8601
  completedAt: string | null
  exitCode: number | null
  hasCommits: boolean     // true when the task branch has commits
  baseBranch: string      // the branch that was checked out when the task was created
}

export interface State {
  tasks: Task[]
}
