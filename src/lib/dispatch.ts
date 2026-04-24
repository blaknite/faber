import { addTask, updateTask } from "./state.js"
import { createWorktree } from "./worktree.js"
import { spawnAgent } from "./agent.js"
import { generateSlug } from "./slug.js"
import { generateFilterText } from "./filterText.js"
import { logTaskFailure } from "./failureLog.js"
import type { Task, Tier } from "../types.js"
import { DEFAULT_TIER } from "../types.js"
import type { AgentConfig } from "./config.js"
import { modelForTier } from "./config.js"

export interface DispatchOptions {
  repoRoot: string
  prompt: string
  tier?: Tier
  baseBranch: string
  callSite?: string
  loadedConfig?: AgentConfig
  explicitModel?: string
}

// Creates a task, registers it in state, sets up its git worktree, and starts
// the agent process. The filter text is generated asynchronously in the
// background after the function returns.
//
// Throws if the worktree creation fails. Callers are responsible for any
// caller-specific cleanup or logging around that error.
export async function createAndDispatchTask({
  repoRoot,
  prompt,
  tier = DEFAULT_TIER,
  baseBranch,
  callSite = "dispatch",
  loadedConfig = {},
  explicitModel,
}: DispatchOptions): Promise<Task> {
  const slug = generateSlug(prompt)
  const worktree = `.worktrees/${slug}`

  const resolvedModel = explicitModel ?? modelForTier(tier, loadedConfig)

  const task: Task = {
    id: slug,
    prompt,
    model: resolvedModel,
    status: "running",
    pid: null,
    worktree,
    sessionId: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    exitCode: null,
    hasCommits: false,
    baseBranch,
  }

  addTask(repoRoot, task)

  try {
    await createWorktree(repoRoot, slug, baseBranch)
  } catch (err) {
    logTaskFailure(repoRoot, {
      taskId: slug,
      callSite,
      reason: "Failed to create git worktree",
      exitCode: -1,
      error: err instanceof Error ? err.message : String(err),
    })
    updateTask(repoRoot, slug, {
      status: "failed",
      completedAt: new Date().toISOString(),
      exitCode: -1,
    })
    throw err
  }

  spawnAgent(task, repoRoot, loadedConfig)
  generateFilterText(prompt, repoRoot, loadedConfig).then(filterText => {
    if (filterText) updateTask(repoRoot, task.id, { summaryText: filterText })
  })

  return task
}
