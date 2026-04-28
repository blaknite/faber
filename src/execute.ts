import { existsSync, readFileSync } from "node:fs"
import { resolve, isAbsolute } from "node:path"
import { join } from "node:path"
import { homedir } from "node:os"
import { Marked } from "marked"
import { markedTerminal } from "marked-terminal"
import { ensureFaberDir } from "./lib/state.js"
import { createAndDispatchTask } from "./lib/dispatch.js"
import { readCurrentBranch } from "./lib/worktree.js"
import { loadConfig } from "./lib/config.js"
import { startProgressSpinner, waitForTask, lastAgentMessage } from "./lib/managedStep.js"
import type { Tier } from "./types.js"

const DEFAULT_EXECUTE_TIER: Tier = "smart"

export async function runExecute(
  repoRoot: string,
  planPath: string,
  tier: Tier = DEFAULT_EXECUTE_TIER,
  explicitModel?: string,
  background: boolean = false,
): Promise<void> {
  if (!existsSync(`${repoRoot}/.git`)) {
    throw new Error(`Not a git repository: ${repoRoot}`)
  }

  const absPlan = isAbsolute(planPath) ? planPath : resolve(process.cwd(), planPath)
  if (!existsSync(absPlan)) {
    throw new Error(`Plan not found: ${absPlan}`)
  }
  const planContents = readFileSync(absPlan, "utf8")

  ensureFaberDir(repoRoot)

  const baseBranch = readCurrentBranch(repoRoot) || "HEAD"

  const prompt = [
    `Execute the plan at ${absPlan}.`,
    "",
    "Load the skill `executing-work`.",
    "",
    "## Plan",
    "",
    planContents,
  ].join("\n")

  const globalConfigPath = join(homedir(), ".faber", "faber.json")
  const projectConfigPath = join(repoRoot, ".faber", "faber.json")
  const loadedConfig = loadConfig(globalConfigPath, projectConfigPath)

  const task = await createAndDispatchTask({
    repoRoot,
    prompt,
    tier,
    baseBranch,
    callSite: "execute.ts:runExecute",
    loadedConfig,
    explicitModel,
  })

  if (background) {
    console.log(`Task ${task.id} running`)
    return
  }

  const stopProgress = startProgressSpinner(repoRoot, task.id, "Working through the plan 🛠")
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
  process.stdout.write(`Next steps:\n`)
  process.stdout.write(`  faber review --task ${shortId}    # review the implementation\n`)
  process.stdout.write(`  faber merge ${shortId}            # merge the work into the base branch\n`)
  process.stdout.write(`  faber continue ${shortId} "..."   # continue with feedback\n`)
  process.stdout.write(`  faber done ${shortId}             # dismiss without merging\n`)
}
