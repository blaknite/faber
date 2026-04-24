export type TaskStatus = "running" | "done" | "ready" | "failed" | "stopped" | "unknown"

export type FilterMode = "active" | "all"

export const ACTIVE_STATUSES: TaskStatus[] = ["running", "ready", "failed", "stopped"]

export type Mode = "normal" | "input" | "delete" | "kill" | "done" | "merge" | "push" | "pushing" | "continue" | "switch_branch"

export type Tier = 'fast' | 'smart' | 'deep'

export type DefaultModelId =
  | "anthropic/claude-haiku-4-5"
  | "anthropic/claude-sonnet-4-6"
  | "anthropic/claude-opus-4-6"

export const DEFAULT_MODELS: Record<Tier, DefaultModelId> = {
  fast: "anthropic/claude-haiku-4-5",
  smart: "anthropic/claude-sonnet-4-6",
  deep: "anthropic/claude-opus-4-6",
}

export const DEFAULT_TIER: Tier = 'smart'

export const TIERS: Record<Tier, { label: string; color: string; dimColor: string; contextWindow: number }> = {
  smart: { label: "Smart", color: "#0088ff", dimColor: "#1a4466", contextWindow: 200000 },
  fast:  { label: "Fast",  color: "#00cc66", dimColor: "#1a4d36", contextWindow: 200000 },
  deep:  { label: "Deep",  color: "#9966ff", dimColor: "#3d2d55", contextWindow: 200000 },
}

export const TIER_ORDER: Tier[] = ['smart', 'fast', 'deep']

export function resolveTier(input: string): Tier | null {
  const lower = input.toLowerCase()
  for (const tier of TIER_ORDER) {
    if (tier === lower) return tier
    if (TIERS[tier].label.toLowerCase() === lower) return tier
  }
  for (const tier of TIER_ORDER) {
    if (DEFAULT_MODELS[tier].toLowerCase() === lower) return tier
  }
  return null
}

export interface Task {
  id: string              // e.g. "a3f2-resolve-issue-uic-002"
  prompt: string          // the raw prompt sent to opencode
  summaryText?: string    // LLM-generated summary of the prompt, used for fuzzy matching in the selector
  model: string           // the opencode model to use (may be a custom model from faber.json)
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

// Returns true when a task should open in the diff view. Both the keyboard
// router and the auto-transition effect in useAppState rely on this same rule,
// so keep it here as the single source of truth.
export function taskUsesDiffView(task: Task): boolean {
  return task.status === "ready" && task.hasCommits
}

// TaskPatch represents the subset of Task fields that can be legitimately updated
// after task creation. Immutable fields (id, prompt, worktree, startedAt) are excluded.
export type TaskPatch = Partial<Pick<Task, 'status' | 'pid' | 'sessionId' | 'completedAt' | 'exitCode' | 'hasCommits' | 'summaryText' | 'model' | 'baseBranch'>>

export interface State {
  tasks: Task[]
}
