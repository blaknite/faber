import { existsSync } from "node:fs"
import { watch as fsWatch } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { Marked } from "marked"
import { markedTerminal } from "marked-terminal"
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

  process.stdout.write("Putting on my monocle and judging your code 🧐\n\n")

  const spinInterval = setInterval(() => {
    const frame = SPINNER_FRAMES[tick % SPINNER_FRAMES.length]!
    const label = lastActivityLabel(repoRoot, taskId)
    process.stdout.write(`\r\x1b[K${frame} ${label}`)
    tick++
  }, 100)

  return () => {
    clearInterval(spinInterval)
    process.stdout.write("\r\x1b[K\n")
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

export function trimToReviewFindings(text: string): string {
  const headingMatch = text.match(/(^|\n)(# Review Findings\b)/)
  if (!headingMatch) return text
  return text.slice(headingMatch.index! + (headingMatch[1]?.length ?? 0))
}

function lastAgentMessage(repoRoot: string, taskId: string): string | null {
  const entries = readLogEntries(repoRoot, taskId)
  const last = [...entries].reverse().find((e) => e.kind === "text")
  const text = last?.text ?? null
  if (!text) return null
  return trimToReviewFindings(text)
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
    "Load the skill `reviewing-code-in-faber`.",
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
    const m = new Marked()
    m.use(markedTerminal({ reflowText: true, width: process.stdout.columns || 80 }) as any)
    const formatted = m.parse(message) as string
    process.stdout.write(formatted)
  }

  process.stdout.write(`\nTo ask follow-up questions or request changes, run:\n\n  faber continue ${task.id.slice(0, 6)} "your instructions here"\n`)
}
