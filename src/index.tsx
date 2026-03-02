import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { resolve, join } from "node:path"
import { homedir } from "node:os"
import { existsSync, mkdirSync, readFileSync, writeFileSync, watch as fsWatch } from "node:fs"
import { App } from "./App.js"
import { acquireLock, ensureFaberDir, readState, reconcileRunningTasks, addTask, updateTask, findRepoRoot, taskOutputPath, stateFilePath } from "./lib/state.js"
import { generateSlug } from "./lib/slug.js"
import { createWorktree, worktreeHasCommits } from "./lib/worktree.js"
import { spawnAgent } from "./lib/agent.js"
import { logTaskFailure } from "./lib/failureLog.js"
import { checkAndUpdate } from "./lib/update.js"
import type { Task } from "./types.js"
import { DEFAULT_MODEL, MODELS, resolveModel } from "./types.js"

// Single exit point for the process. Everything routes through here so it's
// easy to find all the places we terminate and to add any future cleanup.
function exit(code: number): never {
  process.exit(code)
}

// Parse --dir <path> from an args array, returning the resolved path or null.
function parseDirFlag(args: string[]): string | null {
  const i = args.indexOf("--dir")
  if (i !== -1 && args[i + 1]) return resolve(args[i + 1]!)
  return null
}

// Parse --model <value> from an args array, resolving it to a model ID.
// Accepts case-insensitive labels (smart, fast, deep) or literal model ID strings.
// Exits with an error if the value doesn't match any known model.
// Returns the default model if --model is not present.
function parseModelFlag(args: string[]): Task["model"] {
  const i = args.indexOf("--model")
  if (i === -1 || !args[i + 1]) return DEFAULT_MODEL
  const input = args[i + 1]!
  const resolved = resolveModel(input)
  if (!resolved) {
    const valid = MODELS.map((m) => m.label).join(", ")
    console.error(`Unknown model "${input}". Valid options: ${valid}`)
    exit(1)
  }
  return resolved
}

// Read the task log and return the sessionID from the last log entry that has
// one. Returns null if the log doesn't exist or contains no sessionID.
function sessionIdFromLog(repoRoot: string, taskId: string): string | null {
  const logPath = taskOutputPath(repoRoot, taskId)
  if (!existsSync(logPath)) return null
  const lines = readFileSync(logPath, "utf8").split("\n")
  let sessionId: string | null = null
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line) as { sessionID?: string }
      if (event.sessionID) sessionId = event.sessionID
    } catch {
      // not valid JSON -- skip
    }
  }
  return sessionId
}

// FABER_VERSION is injected at compile time via --define. When running from
// source with `bun src/index.tsx` (dev mode) it won't be set, so we fall back
// to "dev".
declare const FABER_VERSION: string | undefined
const VERSION = typeof FABER_VERSION !== "undefined" ? FABER_VERSION : "dev"

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  // faber --help | faber help
  if (command === "--help" || command === "-h" || command === "help") {
    console.log(`faber ${VERSION}

Usage: faber [command] [options]

Commands:
  (none)            Launch the TUI and manage tasks interactively
  run "<prompt>"    Dispatch a task headlessly without the TUI
  watch <taskId>    Watch a task and exit when it stops running
  setup             Initialise .faber/ and .worktrees/ in the repo
  update            Check for a new release and install it
  version           Print the version and exit
  help              Show this help message

Options:
  --dir <path>      Path to the git repo root (defaults to nearest repo from cwd)
  --model <label>   Model to use for the task: smart, fast, or deep
                    (only applies to the run command)

Examples:
  faber
  faber run "Fix the login bug"
  faber run "Refactor the auth module" --model deep
  faber watch a3f2-fix-the-login-bug
  faber setup --dir /path/to/repo`)
    exit(0)
  }

  // faber version
  if (command === "version") {
    console.log(VERSION)
    exit(0)
  }

  // faber finish <taskId> <exitCode>
  // Called via command chaining after opencode exits, passing the real exit code via $?.
  // This is the single place where task exit status is written to state.
  if (command === "finish") {
    const taskId = args[1]
    const exitCode = args[2] !== undefined ? parseInt(args[2], 10) : 0
    if (!taskId) {
      console.error("Usage: faber finish <taskId> <exitCode>")
      exit(1)
    }
    const dirArg = parseDirFlag(args)
    const repoRoot = dirArg ?? findRepoRoot(process.cwd())
    if (!repoRoot) {
      console.error("Could not find faber state file from current directory")
      exit(exitCode)
    }
    // Always mark the task as done (or ready) so intermittent non-zero
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

    // If the task was already marked failed or stopped (e.g. the user killed it),
    // don't overwrite that status. Just record the exit code and clear the pid.
    const currentState = readState(repoRoot)
    const currentTask = currentState.tasks.find((t) => t.id === taskId)

    // If the session ID wasn't captured while the agent was running (e.g. faber
    // exited before the first line of opencode's stdout was processed), recover
    // it from the log now.
    if (currentTask && !currentTask.sessionId) {
      const sessionId = sessionIdFromLog(repoRoot, taskId)
      if (sessionId) {
        try {
          updateTask(repoRoot, taskId, { sessionId })
        } catch (err) {
          console.error("Failed to recover session ID from log:", (err as Error).message)
        }
      }
    }

    if (currentTask?.status === "failed" || currentTask?.status === "stopped") {
      try {
        updateTask(repoRoot, taskId, { exitCode, pid: null })
      } catch (err) {
        console.error("Failed to write task status:", (err as Error).message)
      }
      exit(exitCode)
    }

    // All finished tasks move to "ready" so the user can review their output.
    // We record whether the branch has commits so the UI knows whether to offer
    // the merge flow or just let the user dismiss the task.
    const hasCommits = await worktreeHasCommits(repoRoot, taskId)

    try {
      updateTask(repoRoot, taskId, {
        status: "ready",
        hasCommits,
        exitCode,
        completedAt: new Date().toISOString(),
        pid: null,
      })
    } catch (err) {
      // If we can't write the state, log it but still exit with the correct code.
      console.error("Failed to write task status:", (err as Error).message)
    }
    exit(exitCode)
  }

  // faber run "<prompt>" [--dir <repo>] [--model <label>]
  if (command === "run") {
    const prompt = args[1]
    if (!prompt) {
      console.error('Usage: faber run "<prompt>" [--dir <repo>] [--model <label>]')
      exit(1)
    }
    const dirArg = parseDirFlag(args)
    const repoRoot = dirArg ?? findRepoRoot(process.cwd()) ?? resolve(process.cwd())
    const model = parseModelFlag(args)
    await runHeadless(repoRoot, prompt, model)
    return
  }

  // faber watch <taskId> [--dir <repo>]
  // Watches a task's status and exits when it stops running.
  if (command === "watch") {
    const taskId = args[1]
    if (!taskId) {
      console.error("Usage: faber watch <taskId> [--dir <repo>]")
      exit(1)
    }
    const dirArg = parseDirFlag(args)
    const repoRoot = dirArg ?? findRepoRoot(process.cwd())
    if (!repoRoot) {
      console.error("Could not find faber state file from current directory")
      exit(1)
    }
    await watchTask(repoRoot, taskId)
    return
  }

  // faber update
  if (command === "update") {
    try {
      await checkAndUpdate(VERSION)
    } catch (err: any) {
      console.error(`Update failed: ${err.message}`)
      exit(1)
    }
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
  const repoRoot = dirArg ?? findRepoRoot(process.cwd()) ?? resolve(process.cwd())

  if (!existsSync(`${repoRoot}/.git`)) {
    console.error(`Not a git repository: ${repoRoot}`)
    exit(1)
  }

  ensureFaberDir(repoRoot)
  reconcileRunningTasks(repoRoot)

  let releaseLock: (() => Promise<void>) | null = null
  try {
    releaseLock = await acquireLock(repoRoot)
  } catch (err: any) {
    console.error(err.message)
    exit(1)
  }

  const state = readState(repoRoot)
  const repoName = repoRoot.replace(homedir(), "~")

  const renderer = await createCliRenderer({ exitOnCtrlC: false, useMouse: false })
  const root = createRoot(renderer)

  root.render(
    <App
      repoRoot={repoRoot}
      repoName={repoName}
      version={VERSION}
      initialTasks={state.tasks}
      renderer={renderer}
      onExit={async () => {
        root.unmount()
        await releaseLock?.()
        renderer.destroy()
        exit(0)
      }}
    />
  )

  renderer.start()
}

async function runHeadless(repoRoot: string, prompt: string, model: Task["model"] = DEFAULT_MODEL) {
  if (!existsSync(`${repoRoot}/.git`)) {
    console.error(`Not a git repository: ${repoRoot}`)
    exit(1)
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
    hasCommits: false,
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
    throw err
  }

  spawnAgent(task, repoRoot)
  console.log(`Task ${slug} running`)
}

async function setup(repoRoot: string) {
  if (!existsSync(join(repoRoot, ".git"))) {
    console.error(`Not a git repository: ${repoRoot}`)
    exit(1)
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

// Poll state.json until the given task is no longer running, then exit.
// Uses fs.watch for low-latency change detection, with a 1-second fallback
// interval to handle cases where file-system events are dropped (common on
// macOS with FSEvents under high I/O).
async function watchTask(repoRoot: string, taskId: string): Promise<void> {
  const statePath = stateFilePath(repoRoot)

  function getStatus(): string | null {
    const state = readState(repoRoot)
    const task = state.tasks.find((t) => t.id === taskId)
    return task ? task.status : null
  }

  const initial = getStatus()
  if (initial === null) {
    console.error(`Task "${taskId}" not found`)
    exit(1)
  }

  console.log(`Watching task ${taskId} (status: ${initial})`)

  if (initial !== "running") {
    console.log(`Task ${taskId} is not running (status: ${initial})`)
    exit(0)
  }

  return new Promise<void>((resolve) => {
    let settled = false

    function check() {
      if (settled) return
      const status = getStatus()
      if (status === null) {
        // Task was removed from state.
        settled = true
        watcher.close()
        clearInterval(interval)
        console.log(`Task ${taskId} was removed`)
        resolve()
        exit(0)
      }
      if (status !== "running") {
        settled = true
        watcher.close()
        clearInterval(interval)
        console.log(`Task ${taskId} finished (status: ${status})`)
        resolve()
        exit(0)
      }
    }

    const watcher = fsWatch(statePath, () => check())
    const interval = setInterval(check, 1000)

    watcher.on("error", () => {
      // If the watch itself errors, fall back to polling only.
    })
  })
}

main().catch((err) => {
  console.error(err)
  exit(1)
})
