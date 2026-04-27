import { spawn } from "node:child_process"
import { writeFileSync, appendFileSync } from "node:fs"
import { execaSync } from "execa"
import type { Task } from "../types.js"
import { updateTask, taskOutputPath } from "./state.js"
import { logTaskFailure } from "./failureLog.js"
import type { AgentConfig } from "./config.js"

export const DEFAULT_RESUME_PROMPT = "The task was interrupted. Please continue where you left off."

export function spawnAgent(
  task: Task,
  repoRoot: string,
  loadedConfig: AgentConfig,
  resumeSessionId?: string,
  resumePrompt?: string,
): void {
  const opencodebin = (() => {
    try { return execaSync("which", ["opencode"]).stdout.trim() }
    catch { return null }
  })()
  if (!opencodebin) throw new Error("opencode not found in PATH")

  // process.execPath is always the real executable path.
  // In dev it's the bun binary, so we also need argv[1] (the script path).
  // In a compiled binary argv[1] is a /$bunfs/ virtual path, not a real file.
  const script = process.argv[1]
  const faberCmd = script?.startsWith("/") && !script.startsWith("/$bunfs/")
    ? `${process.execPath} ${script}`
    : process.execPath

  const worktreePath = `${repoRoot}/${task.worktree}`

  const outputFile = taskOutputPath(repoRoot, task.id)

  const agentPrompt = resumeSessionId
    ? (resumePrompt ?? DEFAULT_RESUME_PROMPT)
    : `Load the skill \`working-in-faber\`\n\n${task.prompt}\n\nBase branch: ${task.baseBranch}`

  // The log shows what the user asked for, not the internal scaffolding we
  // prepend. For new tasks that's task.prompt; for resumes it's whatever
  // follow-up prompt was provided (or the interruption fallback).
  const logPrompt = resumeSessionId
    ? (resumePrompt ?? DEFAULT_RESUME_PROMPT)
    : task.prompt

  // Write the prompt to the log before the agent starts so it's always visible,
  // even though the agent's own output won't include it. For new tasks we
  // create the file fresh; for resumes we append so the previous session's
  // log is preserved.
  const promptEvent = JSON.stringify({
    type: "prompt",
    timestamp: Date.now(),
    prompt: logPrompt,
    model: task.model,
  })
  if (resumeSessionId) {
    appendFileSync(outputFile, promptEvent + "\n")
  } else {
    writeFileSync(outputFile, promptEvent + "\n")
  }

  const opencodeCmd = resumeSessionId
    ? (() => {
        const prompt = agentPrompt.replace(/'/g, `'\\''`)
        return `${opencodebin} run --format json --model ${task.model} -s ${resumeSessionId} --fork '${prompt}'`
      })()
    : (() => {
        const prompt = agentPrompt.replace(/'/g, `'\\''`)
        return `${opencodebin} run --format json --model ${task.model} '${prompt}'`
      })()
  const finishCmd = `; ${faberCmd} finish ${task.id} $?`
  // pipefail ensures $? reflects opencode's exit code, not tee's.
  const shellCmd = `set -o pipefail; ${opencodeCmd} | tee -a "${outputFile}"${finishCmd}`

  const child = spawn("sh", ["-c", shellCmd], {
    cwd: worktreePath,
    stdio: ["ignore", "pipe", "pipe"],
    // detached creates a new process group so the shell and opencode survive
    // faber exiting. unref() allows faber to exit without waiting, but the
    // close event still fires while faber is running.
    detached: true,
    env: {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        permission: {
          // Allow tools to reach files in the repo root (outside the worktree cwd).
          external_directory: {
            [`${repoRoot}/**`]: "allow",
          },
          // Deny writes outside the worktree. Anything under the worktree is fine
          // (covered by workspace defaults), but the rest of the repo root should
          // be read-only from the agent's perspective.
          edit: {
            [`${worktreePath}/**`]: "allow",
            [`${repoRoot}/**`]: "deny",
          },
          bash: "deny",
          cleanroom_exec: "allow",
        },
      }),
    },
  })
  child.unref()

  // Capture opencode's pid (the shell's child) rather than the shell's pid.
  // The shell needs a moment to exec opencode, so we poll briefly.
  const shellPid = child.pid
  if (shellPid) {
    let attempts = 0
    const poll = setInterval(() => {
      attempts++
      try {
        const result = execaSync("pgrep", ["-P", String(shellPid)])
        const opencodePid = parseInt(result.stdout.trim(), 10)
        if (opencodePid) {
          clearInterval(poll)
          updateTask(repoRoot, task.id, { pid: opencodePid })
        }
      } catch {
        // not found yet
      }
      if (attempts >= 20) clearInterval(poll)
    }, 50)
  }

  let sessionIdCaptured = false
  let lineBuffer = ""

  child.stdout?.on("data", (chunk: Buffer) => {
    if (sessionIdCaptured) return

    lineBuffer += chunk.toString()
    let newline: number
    while ((newline = lineBuffer.indexOf("\n")) !== -1) {
      const line = lineBuffer.slice(0, newline)
      lineBuffer = lineBuffer.slice(newline + 1)
      try {
        const event = JSON.parse(line) as { sessionID?: string }
        if (event.sessionID) {
          sessionIdCaptured = true
          updateTask(repoRoot, task.id, { sessionId: event.sessionID })
          lineBuffer = ""
          // Unref stdout now that we've captured the session ID. This allows
          // the faber run CLI to exit without waiting for opencode to finish.
          // We defer until here so we don't drop the pipe before tee has had
          // a chance to start draining -- an unconditional unref would stall
          // opencode via pipe backpressure.
          ;(child.stdout as any)?.unref()
          break
        }
      } catch {
        // not valid JSON -- keep scanning
      }
    }
  })

  child.stderr?.resume()
  ;(child.stderr as any)?.unref()

  child.on("close", () => {
    // faber finish already wrote the final status to disk. The state.json
    // watcher in App.tsx will pick up that write and refresh the UI.
  })

  child.on("error", (err) => {
    logTaskFailure(repoRoot, {
      taskId: task.id,
      callSite: "agent.ts:child.on(error)",
      reason: "Child process emitted an error event",
      exitCode: -1,
      error: err.message,
    })

    updateTask(repoRoot, task.id, {
      status: "failed",
      exitCode: -1,
      completedAt: new Date().toISOString(),
      pid: null,
    })
  })
}

export function killAgent(pid: number): void {
  try {
    process.kill(pid, "SIGTERM")
  } catch {
    // already gone
  }
}
