import { readState, findTask, removeTask } from "./state.js"
import { removeWorktree as defaultRemoveWorktree } from "./worktree.js"

// Delete a task: validate it exists and isn't running, remove its worktree,
// then remove it from state.
//
// The optional `doRemoveWorktree` parameter exists for testing -- pass a stub
// to avoid needing a real git repository in unit tests. Worktree removal
// failures are non-fatal; the task is removed from state regardless (matches
// the behaviour in useAppActions handleDelete).
//
// Returns the full task ID so callers can print a confirmation message.
export async function deleteTask(
  repoRoot: string,
  taskId: string,
  doRemoveWorktree: (root: string, slug: string) => Promise<void> = defaultRemoveWorktree,
): Promise<string> {
  const state = readState(repoRoot)
  const task = findTask(state.tasks, taskId)

  if (!task) {
    throw new Error(`No task matching "${taskId}"`)
  }

  if (task.status === "running") {
    throw new Error(`Task "${task.id}" is currently running. Stop it before deleting.`)
  }

  try {
    await doRemoveWorktree(repoRoot, task.id)
  } catch {
    // Non-fatal -- the task is removed from state even if the worktree can't
    // be cleaned up (e.g. it was already deleted manually).
  }

  removeTask(repoRoot, task.id)

  return task.id
}
