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
  name?: string,
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

  const globalConfigPath = join(homedir(), ".faber", "faber.json")
  const projectConfigPath = join(repoRoot, ".faber", "faber.json")
  const loadedConfig = loadConfig(globalConfigPath, projectConfigPath)

  if (cleanroomEnabled(loadedConfig)) {
    throw new Error("faber ship requires cleanroom mode disabled (the gh CLI is needed to open the pull request).")
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

  const prompt = [
    `Ship branch \`${target}\` against \`${defaultBranch}\`.`,
    "",
    "Load the skill `shipping-work`.",
    "",
    `You are running in a worktree on a slug branch created from the tip of \`${target}\`. Your slug branch name is your working ref — you can get it at any time with \`git branch --show-current\`. Commit any new work to your slug branch as normal. To push it to the remote target branch, use the refspec form:`,
    "",
    "    git push origin HEAD:" + target,
    "",
    `This pushes your slug's commits to \`origin/${target}\` without requiring you to check out \`${target}\` (which may be in use elsewhere). The user's local \`${target}\` is not affected; they will run \`faber merge\` to bring it up to date after the PR lands.`,
    "",
    `If your slug branch is already at the same tip as \`origin/${target}\` (no new commits), you do not need to push before opening the PR — \`gh pr create\` will work against the existing remote tip.`,
    "",
    "When CI fails, do not fix the code inline. Dispatch a faber task:",
    "",
    "    faber run --base $(git branch --show-current) \"Fix the following CI failure on branch $(git branch --show-current): <details>\"",
    "",
    "Wait for it to complete (the command blocks in the foreground), then fold its commits into your slug:",
    "",
    "    faber merge <fix-task-id>",
    "",
    "Then push again with the refspec form above. Dispatch fix tasks one at a time, not in parallel.",
    "",
    `If a push is rejected as non-fast-forward, stop. Something unexpected pushed to \`${target}\`; surface the error rather than rebasing. If a fix task fails, surface the failure rather than dispatching another.`,
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
    name,
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
  process.stdout.write(`The agent pushed commits to \`${target}\` on origin and opened the PR (see message above).\n`)
  process.stdout.write(`Next steps:\n`)
  process.stdout.write(`  faber merge ${shortId}             # fast-forward your local \`${target}\` over the shipped commits\n`)
  process.stdout.write(`  faber continue ${shortId} "..."   # send follow-up instructions to the ship agent\n`)
  process.stdout.write(`  faber done ${shortId}             # dismiss the task without cleaning up\n`)
  process.stdout.write(`  faber delete ${shortId}           # remove the worktree, slug branch, and task\n`)
}
