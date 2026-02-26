import { spawn } from "node:child_process"
import { execaSync } from "execa"
import type { Task } from "../types.js"
import { readState, updateTask, taskOutputPath } from "./state.js"

export function spawnAgent(
  task: Task,
  repoRoot: string,
  onUpdate: (patch: Partial<Task>) => void,
  resumeSessionId?: string
): void {
  const opencodebin = (() => {
    try { return execaSync("which", ["opencode"]).stdout.trim() }
    catch { return null }
  })()
  if (!opencodebin) throw new Error("opencode not found in PATH")

  // Reconstruct the faber invocation so it works in dev (bun src/index.tsx),
  // via the package bin (bun dist/index.js), or as a compiled binary.
  const [runtime, script] = process.argv
  const faberCmd = script ? `${runtime} ${script}` : runtime

  const worktreePath = `${repoRoot}/${task.worktree}`

  const outputFile = taskOutputPath(repoRoot, task.id)

  const opencodeCmd = resumeSessionId
    ? (() => {
        const resumePrompt = "The task was interrupted. Please continue where you left off."
        const prompt = resumePrompt.replace(/'/g, `'\\''`)
        return `${opencodebin} run --format json --model ${task.model} -s ${resumeSessionId} --fork '${prompt}'`
      })()
    : (() => {
        const fullPrompt = `Load the skill \`working-in-faber\`\n\n${task.prompt}`
        const prompt = fullPrompt.replace(/'/g, `'\\''`)
        return `${opencodebin} run --format json --model ${task.model} '${prompt}'`
      })()
  const finishCmd = `; ${faberCmd} --finish ${task.id} $?`
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
          onUpdate({ pid: opencodePid })
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
          const patch = { sessionId: event.sessionID }
          onUpdate(patch)
          updateTask(repoRoot, task.id, patch)
          lineBuffer = ""
          break
        }
      } catch {
        // not valid JSON -- keep scanning
      }
    }
  })

  child.stderr?.resume()

  child.on("close", (code) => {
    const current = readState(repoRoot).tasks.find((t) => t.id === task.id)
    if (current?.status !== "running") return

    const status = code === 0 ? "done" : "failed"
    const patch: Partial<Task> = {
      status,
      exitCode: code,
      completedAt: new Date().toISOString(),
      pid: null,
    }
    onUpdate(patch)
    updateTask(repoRoot, task.id, patch)
  })

  child.on("error", () => {
    const patch: Partial<Task> = {
      status: "failed",
      exitCode: -1,
      completedAt: new Date().toISOString(),
      pid: null,
    }
    onUpdate(patch)
    updateTask(repoRoot, task.id, patch)
  })
}

export function killAgent(pid: number): void {
  try {
    process.kill(pid, "SIGTERM")
  } catch {
    // already gone
  }
}
