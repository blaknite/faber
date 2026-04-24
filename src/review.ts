import { existsSync } from "node:fs"
import { watch as fsWatch } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { ensureFaberDir, stateFilePath, readState } from "./lib/state.js"
import { createAndDispatchTask } from "./lib/dispatch.js"
import { resolveReviewTarget, type ReviewMode } from "./lib/reviewTarget.js"
import { loadConfig } from "./lib/config.js"
import { readLogEntries } from "./lib/logParser.js"
import type { Tier } from "./types.js"

const DEFAULT_REVIEW_TIER: Tier = "deep"

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

function lastActivityLabel(repoRoot: string, taskId: string): string {
  const entries = readLogEntries(repoRoot, taskId)
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!
    if (entry.kind === "tool_use" && entry.title) return entry.title
    if (entry.kind === "text" && entry.text) {
      const firstLine = entry.text.split("\n")[0]!.trim()
      return firstLine.length > 60 ? firstLine.slice(0, 57) + "..." : firstLine
    }
  }
  return "Starting..."
}

function startProgressSpinner(repoRoot: string, taskId: string): () => void {
  let tick = 0

  process.stdout.write("Reviewing...\n")

  const spinInterval = setInterval(() => {
    const frame = SPINNER_FRAMES[tick % SPINNER_FRAMES.length]!
    const label = lastActivityLabel(repoRoot, taskId)
    process.stdout.write(`\r\x1b[K${frame} ${label}`)
    tick++
  }, 100)

  return () => {
    clearInterval(spinInterval)
    process.stdout.write("\r\x1b[K")
  }
}

async function waitForTask(repoRoot: string, taskId: string): Promise<string> {
  const statePath = stateFilePath(repoRoot)

  return new Promise<string>((resolve) => {
    let settled = false
    let watcher: ReturnType<typeof fsWatch> | null = null

    function check() {
      if (settled) return
      const state = readState(repoRoot)
      const task = state.tasks.find((t) => t.id === taskId)
      if (!task || task.status !== "running") {
        settled = true
        watcher?.close()
        clearInterval(interval)
        resolve(task?.status ?? "unknown")
      }
    }

    if (existsSync(statePath)) {
      watcher = fsWatch(statePath, () => check())
      watcher.on("error", () => {})
    }

    const interval = setInterval(check, 1000)
  })
}

function lastAgentMessage(repoRoot: string, taskId: string): string | null {
  const entries = readLogEntries(repoRoot, taskId)
  const last = [...entries].reverse().find((e) => e.kind === "text")
  return last?.text ?? null
}

export async function runReview(
  repoRoot: string,
  mode: ReviewMode,
  tier: Tier = DEFAULT_REVIEW_TIER,
  explicitModel?: string,
  background: boolean = false,
): Promise<void> {
  if (!existsSync(`${repoRoot}/.git`)) {
    throw new Error(`Not a git repository: ${repoRoot}`)
  }

  ensureFaberDir(repoRoot)

  const target = await resolveReviewTarget(repoRoot, mode)

  const promptLines = [
    `Review ${target.summary} against \`${target.reviewBase}\`.`,
    "",
    "Load the skill `reviewing-code`.",
  ]
  if (target.contextLine) {
    promptLines.push("", target.contextLine)
  }
  const prompt = promptLines.join("\n")

  const globalConfigPath = join(homedir(), ".faber", "faber.json")
  const projectConfigPath = join(repoRoot, ".faber", "faber.json")
  const loadedConfig = loadConfig(globalConfigPath, projectConfigPath)

  const task = await createAndDispatchTask({
    repoRoot,
    prompt,
    tier,
    baseBranch: target.worktreeBase,
    callSite: "review.ts:runReview",
    loadedConfig,
    explicitModel,
  })

  if (background) {
    console.log(`Task ${task.id} running`)
    return
  }

  const stopProgress = startProgressSpinner(repoRoot, task.id)
  await waitForTask(repoRoot, task.id)
  stopProgress()

  const message = lastAgentMessage(repoRoot, task.id)
  if (message) {
    console.log(message)
  }
}
