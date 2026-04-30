import { spawn } from "node:child_process"
import { appendFileSync } from "node:fs"
import { readState, updateTask, taskOutputPath } from "./lib/state.js"
import { worktreeHasCommits } from "./lib/worktree.js"
import { logTaskFailure } from "./lib/failureLog.js"

export async function runSpawn(repoRoot: string, taskId: string, command: string[]): Promise<number> {
  const state = readState(repoRoot)
  const task = state.tasks.find((t) => t.id === taskId)

  if (!task) {
    process.stderr.write(`faber spawn: task "${taskId}" not found\n`)
    return 1
  }

  const outputFile = taskOutputPath(repoRoot, taskId)

  const child = spawn(command[0]!, command.slice(1), {
    cwd: `${repoRoot}/${task.worktree}`,
    stdio: ["ignore", "pipe", "pipe"],
  })

  if (child.pid) {
    updateTask(repoRoot, taskId, { pid: child.pid })
  }

  let sessionId: string | null = null
  let lineBuffer = ""

  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString()
    lineBuffer += text

    let newline: number
    while ((newline = lineBuffer.indexOf("\n")) !== -1) {
      const line = lineBuffer.slice(0, newline)
      lineBuffer = lineBuffer.slice(newline + 1)

      appendFileSync(outputFile, line + "\n")

      if (sessionId === null) {
        try {
          const event = JSON.parse(line) as { sessionID?: string }
          if (event.sessionID) {
            sessionId = event.sessionID
            updateTask(repoRoot, taskId, { sessionId })
          }
        } catch {
          // not valid JSON -- keep scanning
        }
      }
    }
  })

  child.stderr.resume()
  ;(child.stderr as any).unref()

  const exitCode = await new Promise<number>((resolve) => {
    child.on("close", (code) => {
      resolve(code ?? 1)
    })
  })

  const freshState = readState(repoRoot)
  const freshTask = freshState.tasks.find((t) => t.id === taskId)

  if (!freshTask) {
    return exitCode
  }

  const now = new Date().toISOString()

  if (freshTask.status === "stopped" || freshTask.status === "failed") {
    updateTask(repoRoot, taskId, { exitCode, pid: null, completedAt: now })
  } else if (exitCode === 0) {
    const hasCommits = await worktreeHasCommits(repoRoot, taskId, task.baseBranch)
    updateTask(repoRoot, taskId, {
      status: "ready",
      hasCommits,
      exitCode: 0,
      pid: null,
      completedAt: now,
    })
  } else {
    logTaskFailure(repoRoot, {
      taskId,
      callSite: "spawn",
      reason: "Process exited with non-zero exit code",
      exitCode,
    })
    updateTask(repoRoot, taskId, {
      status: "failed",
      exitCode,
      pid: null,
      completedAt: now,
    })
  }

  return exitCode
}
