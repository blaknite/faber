import { spawn } from "node:child_process"
import { execaSync } from "execa"
import type { Task } from "../types.js"
import { updateTask } from "./state.js"

export function spawnAgent(
  task: Task,
  repoRoot: string,
  onUpdate: (patch: Partial<Task>) => void
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

  const fullPrompt = `Load the skill \`working-in-faber\`\n\n${task.prompt}`
  const prompt = fullPrompt.replace(/'/g, `'\\''`)
  const opencodeCmd = `${opencodebin} run --format json --model ${task.model} '${prompt}'`
  const finishCmd = `; ${faberCmd} --finish ${task.id} $?`
  const shellCmd = `${opencodeCmd}${finishCmd}`

  const child = spawn("sh", ["-c", shellCmd], {
    cwd: worktreePath,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  })

  onUpdate({ pid: child.pid ?? null })

  let sessionIdCaptured = false
  let stdoutBuffer = ""

  child.stdout?.on("data", (chunk: Buffer) => {
    if (sessionIdCaptured) return
    stdoutBuffer += chunk.toString()
    const newline = stdoutBuffer.indexOf("\n")
    if (newline === -1) return
    const firstLine = stdoutBuffer.slice(0, newline)
    stdoutBuffer = ""
    try {
      const event = JSON.parse(firstLine) as { sessionID?: string }
      if (event.sessionID) {
        sessionIdCaptured = true
        const patch = { sessionId: event.sessionID }
        onUpdate(patch)
        updateTask(repoRoot, task.id, patch)
      }
    } catch {
      // not valid JSON -- ignore
    }
  })

  child.stderr?.resume()

  child.on("close", (code) => {
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
