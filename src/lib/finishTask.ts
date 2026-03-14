import { existsSync, readFileSync } from "node:fs"
import { readState, updateTask, taskOutputPath } from "./state.js"
import { worktreeHasCommits as defaultWorktreeHasCommits } from "./worktree.js"
import { logTaskFailure } from "./failureLog.js"

// Read the task log and return the sessionID from the last log entry that has
// one. Returns null if the log doesn't exist or contains no sessionID.
export function sessionIdFromLog(repoRoot: string, taskId: string): string | null {
  const logPath = taskOutputPath(repoRoot, taskId)
  if (!existsSync(logPath)) return null
  const lines = readFileSync(logPath, "utf8").split("\n")
  let sessionId: string | null = null
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line) as { sessionID?: string }
      if (event.sessionID) sessionId = event.sessionID
    } catch {
      // not valid JSON -- skip
    }
  }
  return sessionId
}

// Handle the end of an agent shell process. This is the single place where a
// task's terminal state is written: ready, failed, or stopped (unchanged).
//
// Called after the detached agent process exits. `exitCode` is the real exit
// code from the process (or -1 if the code is unknown / the process was
// killed without a code).
//
// The optional `checkHasCommits` parameter exists for testing -- pass a stub
// to avoid needing a real git repository in unit tests.
export async function finishTask(
  repoRoot: string,
  taskId: string,
  exitCode: number,
  checkHasCommits: (root: string, slug: string, baseBranch?: string) => Promise<boolean> = defaultWorktreeHasCommits,
): Promise<void> {
  const currentState = readState(repoRoot)
  const currentTask = currentState.tasks.find((t) => t.id === taskId)

  if (!currentTask) {
    // Nothing to update -- task was deleted or never existed.
    return
  }

  // Log failures for diagnostics, but don't let them block state updates.
  if (exitCode !== 0) {
    logTaskFailure(repoRoot, {
      taskId,
      callSite: "finishTask",
      reason: "Process exited with non-zero exit code",
      exitCode,
    })
  }

  // If the session ID wasn't captured while the agent was running (e.g. faber
  // exited before the first line of opencode's stdout was processed), recover
  // it from the log now.
  if (!currentTask.sessionId) {
    const sessionId = sessionIdFromLog(repoRoot, taskId)
    if (sessionId) {
      try {
        updateTask(repoRoot, taskId, { sessionId })
      } catch (err) {
        console.error("Failed to recover session ID from log:", (err as Error).message)
      }
    }
  }

  // If the task was already marked failed or stopped (e.g. the user killed it),
  // don't overwrite that status. Just record the exit code and clear the pid.
  if (currentTask.status === "failed" || currentTask.status === "stopped") {
    try {
      updateTask(repoRoot, taskId, { exitCode, pid: null })
    } catch (err) {
      console.error("Failed to write task status:", (err as Error).message)
    }
    return
  }

  // All finished tasks move to "ready" so the user can review their output.
  // We record whether the branch has commits so the UI knows whether to offer
  // the merge flow or just let the user dismiss the task.
  const hasCommits = await checkHasCommits(repoRoot, taskId, currentTask.baseBranch)

  try {
    updateTask(repoRoot, taskId, {
      status: "ready",
      hasCommits,
      exitCode,
      completedAt: new Date().toISOString(),
      pid: null,
    })
  } catch (err) {
    // If we can't write the state, log it but don't throw -- the caller
    // (the CLI finish command) will still exit with the correct code.
    console.error("Failed to write task status:", (err as Error).message)
  }
}
