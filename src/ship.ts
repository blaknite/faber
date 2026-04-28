import { existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { Marked } from "marked"
import { markedTerminal } from "marked-terminal"
import { ensureFaberDir } from "./lib/state.js"
import { createAndDispatchTask } from "./lib/dispatch.js"
import { branchExists, commitsAhead, readCurrentBranch } from "./lib/worktree.js"
import { findDefaultBranch } from "./lib/defaultBranch.js"
import { loadConfig, cleanroomEnabled } from "./lib/config.js"
import { startProgressSpinner, waitForTask, lastAgentMessage } from "./lib/managedStep.js"
import type { Tier } from "./types.js"

const DEFAULT_SHIP_TIER: Tier = "smart"

export async function runShip(
  repoRoot: string,
  branchOverride: string | null,
  tier: Tier = DEFAULT_SHIP_TIER,
  explicitModel?: string,
  background: boolean = false,
): Promise<void> {
  if (!existsSync(`${repoRoot}/.git`)) {
    throw new Error(`Not a git repository: ${repoRoot}`)
  }

  ensureFaberDir(repoRoot)

  const target = branchOverride ?? readCurrentBranch(repoRoot)
  if (!target) {
    throw new Error("HEAD is detached; cannot ship. Pass --branch <name>.")
  }
  if (!branchExists(repoRoot, target)) {
    throw new Error(`Branch \`${target}\` does not exist locally.`)
  }

  const defaultBranch = findDefaultBranch(repoRoot)
  if (!defaultBranch) {
    throw new Error("Could not determine the default branch (no origin/HEAD and no local main or master).")
  }
  if (target === defaultBranch) {
    throw new Error(`Cannot ship \`${target}\`: it is the default branch.`)
  }

  const ahead = await commitsAhead(repoRoot, target, defaultBranch)
  if (ahead === 0) {
    throw new Error(`Branch \`${target}\` has no commits ahead of \`${defaultBranch}\`. Nothing to ship.`)
  }

  const globalConfigPath = join(homedir(), ".faber", "faber.json")
  const projectConfigPath = join(repoRoot, ".faber", "faber.json")
  const loadedConfig = loadConfig(globalConfigPath, projectConfigPath)

  if (cleanroomEnabled(loadedConfig)) {
    throw new Error("faber ship requires cleanroom mode disabled (the gh CLI is needed to open the pull request).")
  }

  const prompt = [
    `Ship branch \`${target}\` against \`${defaultBranch}\`.`,
    "",
    "Load the skill `shipping-work`.",
    "",
    `The target branch is \`${target}\`. Push that branch to \`origin\` and open the pull request for it. Do not push your current branch — you are running in a sandbox worktree and your current branch is throwaway.`,
    "",
    `You are running in a worktree, so you cannot \`git checkout ${target}\` (it may be checked out in the user's main checkout). Push it directly with \`git push origin ${target}\`. If the push is rejected because the remote has diverged, fetch and use \`git push --force-with-lease\`; do not rebase the target branch locally.`,
    "",
    "End your final message with a line in the form `PR: <url>` so the URL can be parsed by an orchestrator. If the PR was not opened, end with `PR: none` and a short reason on the line above.",
  ].join("\n")

  const task = await createAndDispatchTask({
    repoRoot,
    prompt,
    tier,
    baseBranch: target,
    callSite: "ship.ts:runShip",
    loadedConfig,
    explicitModel,
  })

  if (background) {
    console.log(`Task ${task.id} running`)
    return
  }

  const stopProgress = startProgressSpinner(repoRoot, task.id, "Shipping it 🚢")
  const finalStatus = await waitForTask(repoRoot, task.id)
  stopProgress()

  const message = lastAgentMessage(repoRoot, task.id)
  if (message) {
    const m = new Marked()
    m.use(markedTerminal({ reflowText: true, width: process.stdout.columns || 80 }) as any)
    process.stdout.write(m.parse(message) as string)
  }

  const shortId = task.id.slice(0, 6)
  process.stdout.write(`\nTask ${shortId} ended in status: ${finalStatus}\n`)
  process.stdout.write(`Verify the PR is up (check the message above or run \`gh pr list --head ${target}\`), then route the task:\n`)
  process.stdout.write(`  faber continue ${shortId} "..."   # send follow-up instructions to the ship agent\n`)
  process.stdout.write(`  faber done ${shortId}             # dismiss the task without removing the sandbox\n`)
  process.stdout.write(`  faber delete ${shortId}           # remove the sandbox worktree, slug branch, and task\n`)
}
