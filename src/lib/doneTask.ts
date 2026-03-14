import { findTask, readState, updateTask } from "./state.js"

// Mark a ready task as done. This is a terminal state: the task is considered
// reviewed and closed, and won't show up in normal listings.
//
// Exits with code 1 if the task is not found or is not in "ready" status.
export function doneTask(repoRoot: string, taskId: string): void {
  const state = readState(repoRoot)

  let task
  try {
    task = findTask(state.tasks, taskId)
  } catch (err: any) {
    console.error(err.message)
    process.exit(1)
  }

  if (!task) {
    console.error(`Task "${taskId}" not found`)
    process.exit(1)
  }

  if (task.status !== "ready") {
    console.error(`Task "${task.id}" has status "${task.status}" -- only "ready" tasks can be marked done`)
    process.exit(1)
  }

  updateTask(repoRoot, task.id, { status: "done" })
  console.log(task.id)
}
