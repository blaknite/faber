import { existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { Marked } from "marked"
import { markedTerminal } from "marked-terminal"
import { ensureFaberDir, updateTask } from "./lib/state.js"
import { createAndDispatchTask } from "./lib/dispatch.js"
import { resolveReviewTarget, type ReviewMode } from "./lib/reviewTarget.js"
import { loadConfig } from "./lib/config.js"
import { startProgressSpinner, waitForTask, lastAgentMessage } from "./lib/managedStep.js"
import type { Tier } from "./types.js"

const DEFAULT_REVIEW_TIER: Tier = "deep"

export function trimToReviewFindings(text: string): string {
  const headingMatch = text.match(/(^|\n)(# Review Findings\b)/)
  if (!headingMatch) return text
  return text.slice(headingMatch.index! + (headingMatch[1]?.length ?? 0))
}

export async function runReview(
  repoRoot: string,
  mode: ReviewMode,
  tier: Tier = DEFAULT_REVIEW_TIER,
  explicitModel?: string,
  background: boolean = false,
  extraContext?: string,
  post: boolean = false,
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
  if (target.originalTask) {
    promptLines.push("", "## Original task", "", target.originalTask)
  }
  if (extraContext && extraContext.trim()) {
    promptLines.push("", "## Additional context", "", extraContext)
  }
  if (post) {
    promptLines.push(
      "",
      "When you finish reviewing, submit the review to GitHub.",
      "Follow the Submitting section of the `reviewing-code-in-faber` skill.",
      "Your final message must be the submission report described in that skill, not the review prose.",
    )
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

  const stopProgress = startProgressSpinner(repoRoot, task.id, "Putting on my monocle and judging your code 🧐")
  const finalStatus = await waitForTask(repoRoot, task.id)
  stopProgress()

  const rawMessage = lastAgentMessage(repoRoot, task.id)
  const message = rawMessage ? trimToReviewFindings(rawMessage) : null
  if (message) {
    const m = new Marked()
    m.use(markedTerminal({ reflowText: true, width: process.stdout.columns || 80 }) as any)
    const formatted = m.parse(message) as string
    process.stdout.write(formatted)
  }

  let autoCompleted = false
  if (finalStatus === "ready") {
    updateTask(repoRoot, task.id, { status: "done" })
    autoCompleted = true
  }

  if (post) {
    process.stdout.write(`\nTo follow up on this review, run:\n\n  faber continue ${task.id.slice(0, 6)} "your instructions here"\n`)
  } else if (autoCompleted) {
    process.stdout.write(`\nReview complete. To ask follow-up questions, run:\n\n  faber continue ${task.id.slice(0, 6)} "your instructions here"\n`)
  } else {
    process.stdout.write(`\nTo ask follow-up questions or request changes, run:\n\n  faber continue ${task.id.slice(0, 6)} "your instructions here"\n`)
  }
}
