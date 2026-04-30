import { spawn } from "node:child_process"
import { readState, updateTask } from "./lib/state.js"
import { appendEvent } from "./lib/events.js"
import { worktreeHasCommits } from "./lib/worktree.js"
import { logTaskFailure } from "./lib/failureLog.js"
import { readLogEntries, summarizeErrorEntry } from "./lib/logParser.js"

function lastFatalError(repoRoot: string, taskId: string): string | null {
  const entries = readLogEntries(repoRoot, taskId)
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!
    if (entry.kind === "error") {
      return summarizeErrorEntry(entry)
    }
  }
  return null
}

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

        let parsed: Record<string, unknown> | undefined
        try { parsed = JSON.parse(line) as Record<string, unknown> } catch { /* skip */ }
        if (parsed === undefined) continue

        appendEvent(repoRoot, taskId, {
          type: "opencode",
          timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : Date.now(),
          data: parsed,
        })

        if (sessionId === null) {
          if (parsed.sessionID && typeof parsed.sessionID === "string") {
            sessionId = parsed.sessionID
            updateTask(repoRoot, taskId, { sessionId })
          }
        }
      }
    })

    child.stdout.on("end", () => {
      if (lineBuffer.length > 0) {
        let parsed: Record<string, unknown> | undefined
        try { parsed = JSON.parse(lineBuffer) as Record<string, unknown> } catch { /* skip */ }
        if (parsed !== undefined) {
          appendEvent(repoRoot, taskId, {
            type: "opencode",
            timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : Date.now(),
            data: parsed,
          })
        }
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
  const fatalError = lastFatalError(repoRoot, taskId)

  if (fatalError) {
    logTaskFailure(repoRoot, {
      taskId,
      callSite: "spawn",
      reason: "Agent logged a fatal error",
      exitCode,
      error: fatalError,
    })
  }

  if (freshTask.status === "stopped" || freshTask.status === "failed") {
    updateTask(repoRoot, taskId, { exitCode, pid: null, completedAt: now })
  } else if (fatalError) {
    updateTask(repoRoot, taskId, {
      status: "failed",
      exitCode,
      pid: null,
      completedAt: now,
    })
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
