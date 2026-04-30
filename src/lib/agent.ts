import { spawn } from "node:child_process"
import { execaSync } from "execa"
import type { Task } from "../types.js"
import type { AgentConfig } from "./config.js"
import { cleanroomEnabled } from "./config.js"
import { appendEvent, truncateEvents } from "./events.js"

export const DEFAULT_RESUME_PROMPT = "The task was interrupted. Please continue where you left off."

function shellQuote(args: string[]): string {
  return args.map((arg) => `'${arg.replace(/'/g, `'\\''`)}'`).join(" ")
}

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

  const script = process.argv[1]
  const faberParts = script?.startsWith("/") && !script.startsWith("/$bunfs/")
    ? [process.execPath, script]
    : [process.execPath]

  const worktreePath = `${repoRoot}/${task.worktree}`

  const agentPrompt = resumeSessionId
    ? (resumePrompt ?? DEFAULT_RESUME_PROMPT)
    : `Load the skill \`working-in-faber\`\n\n${task.prompt}\n\nBase branch: ${task.baseBranch}`

  const logPrompt = resumeSessionId
    ? (resumePrompt ?? DEFAULT_RESUME_PROMPT)
    : task.prompt

  if (!resumeSessionId) truncateEvents(repoRoot, task.id)
  appendEvent(repoRoot, task.id, {
    type: "prompt",
    timestamp: Date.now(),
    data: { prompt: logPrompt, model: task.model },
  })

  const opencodeArgv = [opencodebin, "run", "--format", "json", "--model", task.model, agentPrompt]
  if (resumeSessionId) {
    opencodeArgv.push("-s", resumeSessionId, "--fork")
  }

  const shellCmd = `${shellQuote(faberParts)} spawn ${task.id} -- ${shellQuote(opencodeArgv)}`

  const child = spawn("sh", ["-c", shellCmd], {
    cwd: worktreePath,
    stdio: ["ignore", "ignore", "ignore"],
    detached: true,
    env: {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        permission: {
          external_directory: {
            [`${repoRoot}/**`]: "allow",
          },
          edit: {
            "*": "allow",
            "../*": "deny",
          },
          ...(cleanroomEnabled(loadedConfig) ? {
            bash: {
              "*": "deny",
              "git *": "allow",
              "faber *": "allow",
            },
            cleanroom_exec: "allow",
          } : {}),
        },
      }),
    },
  })
  child.unref()
}

export function killAgent(pid: number): void {
  try {
    process.kill(pid, "SIGTERM")
  } catch {
    // already gone
  }
}
