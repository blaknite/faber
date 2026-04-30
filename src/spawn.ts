import { spawn } from "node:child_process"
import { appendFileSync } from "node:fs"
import { readState, updateTask, taskOutputPath } from "./lib/state.js"
import { worktreeHasCommits } from "./lib/worktree.js"
import { logTaskFailure } from "./lib/failureLog.js"

export async function runSpawn(repoRoot: string, taskId: string, command: string[]): Promise<number> {
  if (command.length === 0) {
    process.stderr.write("faber spawn: command must not be empty\n")
    return 1
  }

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

  if (child.stdout) {
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

    child.stdout.on("end", () => {
      if (lineBuffer.length > 0) {
        appendFileSync(outputFile, lineBuffer + "\n")
        lineBuffer = ""
      }
    })
  }

  if (child.stderr) {
    child.stderr.resume()
  }

  let errored = false

  const exitCode = await new Promise<number>((resolve) => {
    child.on("close", (code) => {
      resolve(code ?? 1)
    })

    child.on("error", (err) => {
      errored = true
      logTaskFailure(repoRoot, { taskId, callSite: "spawn", reason: "Child process failed to start", exitCode: -1, error: err.message })
      updateTask(repoRoot, taskId, { status: "failed", exitCode: -1, pid: null, completedAt: new Date().toISOString() })
      resolve(-1)
    })
  })

  if (errored) {
    return exitCode
  }

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
