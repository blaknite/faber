import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { resolve, join } from "node:path"
import { homedir } from "node:os"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { App } from "./App.js"
import { acquireLock, ensureFaberDir, readState, reconcileRunningTasks, addTask, updateTask, findRepoRoot } from "./lib/state.js"
import { generateSlug } from "./lib/slug.js"
import { createWorktree, worktreeHasCommits } from "./lib/worktree.js"
import { spawnAgent } from "./lib/agent.js"
import { logTaskFailure } from "./lib/failureLog.js"
import type { Task } from "./types.js"
import { DEFAULT_MODEL } from "./types.js"

// Parse --dir <path> from an args array, returning the resolved path or null.
function parseDirFlag(args: string[]): string | null {
  const i = args.indexOf("--dir")
  if (i !== -1 && args[i + 1]) return resolve(args[i + 1]!)
  return null
}

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  // faber finish <taskId> <exitCode>
  // Called via command chaining after opencode exits, passing the real exit code via $?.
  // This is the single place where task exit status is written to state.
  if (command === "finish") {
    const taskId = args[1]
    const exitCode = args[2] !== undefined ? parseInt(args[2], 10) : 0
    if (!taskId) {
      console.error("Usage: faber finish <taskId> <exitCode>")
      process.exit(1)
    }
    const dirArg = parseDirFlag(args)
    const repoRoot = dirArg ?? findRepoRoot(process.cwd())
    if (!repoRoot) {
      console.error("Could not find faber state file from current directory")
      process.exit(exitCode)
    }
    // Always mark the task as done (or ready_to_merge) so intermittent non-zero
    // exit codes from the agent process don't permanently flip a completed task to
    // "failed". The exit code is still recorded for diagnostics.
    if (exitCode !== 0) {
      logTaskFailure(repoRoot, {
        taskId,
        callSite: "index.tsx:finish",
        reason: "Process exited with non-zero exit code",
        exitCode,
      })
    }

    // If the task was already marked failed (e.g. the user killed it), don't
    // overwrite that status. Just record the exit code and clear the pid.
    const currentState = readState(repoRoot)
    const currentTask = currentState.tasks.find((t) => t.id === taskId)
    if (currentTask?.status === "failed") {
      try {
        updateTask(repoRoot, taskId, { exitCode, pid: null })
      } catch (err) {
        console.error("Failed to write task status:", (err as Error).message)
      }
      process.exit(exitCode)
    }

    // If the agent committed work to its branch, surface that so the user knows
    // a merge is waiting. If nothing was committed, it's just done.
    const hasCommits = await worktreeHasCommits(repoRoot, taskId)
    const status = hasCommits ? "ready_to_merge" : "done"

    try {
      updateTask(repoRoot, taskId, {
        status,
        exitCode,
        completedAt: new Date().toISOString(),
        pid: null,
      })
    } catch (err) {
      // If we can't write the state, log it but still exit with the correct code.
      console.error("Failed to write task status:", (err as Error).message)
    }
    process.exit(exitCode)
  }

  // faber run "<prompt>" [--dir <repo>] [--model <provider/model>]
  if (command === "run") {
    const prompt = args[1]
    if (!prompt) {
      console.error('Usage: faber run "<prompt>" [--dir <repo>] [--model <provider/model>]')
      process.exit(1)
    }
    const dirArg = parseDirFlag(args)
    const repoRoot = dirArg ?? resolve(process.cwd())
    const modelFlag = args.indexOf("--model")
    const model = (modelFlag !== -1 && args[modelFlag + 1] ? args[modelFlag + 1]! : DEFAULT_MODEL) as Task["model"]
    await runHeadless(repoRoot, prompt, model)
    return
  }

  // faber setup [--dir <repo>]
  if (command === "setup") {
    const dirArg = parseDirFlag(args)
    const repoRoot = dirArg ?? resolve(process.cwd())
    await setup(repoRoot)
    return
  }

  // faber [start] [--dir <repo>]
  // "start" is an optional explicit subcommand; bare "faber" does the same thing.
  const dirArg = parseDirFlag(args)
  const repoRoot = dirArg ?? resolve(process.cwd())

  if (!existsSync(`${repoRoot}/.git`)) {
    console.error(`Not a git repository: ${repoRoot}`)
    process.exit(1)
  }

  ensureFaberDir(repoRoot)
  reconcileRunningTasks(repoRoot)

  let releaseLock: (() => Promise<void>) | null = null
  try {
    releaseLock = await acquireLock(repoRoot)
  } catch (err: any) {
    console.error(err.message)
    process.exit(1)
  }

  const state = readState(repoRoot)
  const repoName = repoRoot.replace(homedir(), "~")

  const renderer = await createCliRenderer({ exitOnCtrlC: false, useMouse: false })
  const root = createRoot(renderer)

  root.render(
    <App
      repoRoot={repoRoot}
      repoName={repoName}
      initialTasks={state.tasks}
      renderer={renderer}
      onExit={async () => {
        root.unmount()
        await releaseLock?.()
        renderer.destroy()
        process.exit(0)
      }}
    />
  )

  renderer.start()
}

async function runHeadless(repoRoot: string, prompt: string, model: Task["model"] = DEFAULT_MODEL) {
  if (!existsSync(`${repoRoot}/.git`)) {
    console.error(`Not a git repository: ${repoRoot}`)
    process.exit(1)
  }

  ensureFaberDir(repoRoot)

  const slug = generateSlug(prompt)
  const worktree = `.worktrees/${slug}`
  const task: Task = {
    id: slug,
    prompt,
    model,
    status: "running",
    pid: null,
    worktree,
    sessionId: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    exitCode: null,
  }

  addTask(repoRoot, task)
  console.log(`Dispatching task: ${slug}`)

  try {
    await createWorktree(repoRoot, slug)
  } catch (err: any) {
    console.error(`Failed to create worktree: ${err.message}`)
    logTaskFailure(repoRoot, {
      taskId: slug,
      callSite: "index.tsx:runHeadless",
      reason: "Failed to create git worktree",
      exitCode: -1,
      error: err.message,
    })
    updateTask(repoRoot, slug, { status: "failed", completedAt: new Date().toISOString(), exitCode: -1 })
    process.exit(1)
  }

  spawnAgent(task, repoRoot)
  console.log(`Task ${slug} running`)
}

async function setup(repoRoot: string) {
  if (!existsSync(join(repoRoot, ".git"))) {
    console.error(`Not a git repository: ${repoRoot}`)
    process.exit(1)
  }

  // Create .faber/ and .worktrees/
  ensureFaberDir(repoRoot)
  const worktreesDir = join(repoRoot, ".worktrees")
  if (!existsSync(worktreesDir)) {
    mkdirSync(worktreesDir, { recursive: true })
  }

  // Add .faber/ and .worktrees/ to the repo's .gitignore if not already present
  const gitignorePath = join(repoRoot, ".gitignore")
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : ""
  const lines = existing.split("\n")

  const toAdd: string[] = []
  if (!lines.some((l) => l.trim() === ".faber/")) toAdd.push(".faber/")
  if (!lines.some((l) => l.trim() === ".worktrees/")) toAdd.push(".worktrees/")

  if (toAdd.length > 0) {
    const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : ""
    writeFileSync(gitignorePath, existing + separator + toAdd.join("\n") + "\n")
    console.log(`Added to .gitignore: ${toAdd.join(", ")}`)
  }

  console.log("Faber setup complete.")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
