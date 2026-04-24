import { existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { ensureFaberDir } from "./lib/state.js"
import { createAndDispatchTask } from "./lib/dispatch.js"
import { resolveReviewTarget, type ReviewMode } from "./lib/reviewTarget.js"
import { loadConfig } from "./lib/config.js"
import type { Model } from "./types.js"
import { DEFAULT_MODEL } from "./types.js"

export async function runReview(
  repoRoot: string,
  mode: ReviewMode,
  model: Model = DEFAULT_MODEL,
  explicitModel?: string,
): Promise<void> {
  if (!existsSync(`${repoRoot}/.git`)) {
    throw new Error(`Not a git repository: ${repoRoot}`)
  }

  ensureFaberDir(repoRoot)

  const target = await resolveReviewTarget(repoRoot, mode)

  const promptLines = [
    `Review ${target.summary} against \`${target.reviewBase}\`.`,
    "",
    "Load the skill `reviewing-code-autonomously`.",
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
    model,
    baseBranch: target.worktreeBase,
    callSite: "review.ts:runReview",
    loadedConfig,
    explicitModel,
  })

  console.log(`Task ${task.id} running`)
}
