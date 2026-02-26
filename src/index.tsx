import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { resolve, basename } from "node:path"
import { existsSync } from "node:fs"
import { App } from "./App.js"
import { acquireLock, ensureFaberDir, readState, reconcileRunningTasks, addTask, updateTask, findRepoRoot } from "./lib/state.js"
import { generateSlug } from "./lib/slug.js"
import { createWorktree } from "./lib/worktree.js"
import { spawnAgent } from "./lib/agent.js"
import { logTaskFailure } from "./lib/failureLog.js"
import type { Task } from "./types.js"
import { DEFAULT_MODEL } from "./types.js"

async function main() {
  const args = process.argv.slice(2)

  // faber --finish <taskId> [exitCode]
  // Called via command chaining after opencode exits, passing the real exit code via $?.
  // This is the single place where task exit status is written to state.
  if (args[0] === "--finish") {
    const taskId = args[1]
    const exitCode = args[2] !== undefined ? parseInt(args[2], 10) : 0
    if (!taskId) {
      console.error("Usage: faber --finish <taskId> [exitCode]")
      process.exit(exitCode)
    }
    const repoRoot = findRepoRoot(process.cwd())
    if (!repoRoot) {
      console.error("Could not find faber state file from current directory")
      process.exit(exitCode)
    }
    // Always mark the task as done so intermittent non-zero exit codes from the
    // agent process don't permanently flip a completed task to "failed". The
    // exit code is still recorded for diagnostics.
    if (exitCode !== 0) {
      logTaskFailure(repoRoot, {
        taskId,
        callSite: "index.tsx:--finish",
        reason: "Process exited with non-zero exit code",
        exitCode,
      })
    }

    try {
      updateTask(repoRoot, taskId, {
        status: "done",
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

  // faber dispatch "prompt" [--dir /path/to/repo] [--model provider/model]
  if (args[0] === "dispatch") {
    const prompt = args[1]
    if (!prompt) {
      console.error("Usage: faber dispatch \"<prompt>\" [--dir <repo>] [--model <provider/model>]")
      process.exit(1)
    }
    const dirFlag = args.indexOf("--dir")
    const repoRoot = resolve(dirFlag !== -1 && args[dirFlag + 1] ? args[dirFlag + 1]! : process.cwd())
    const modelFlag = args.indexOf("--model")
    const model = (modelFlag !== -1 && args[modelFlag + 1] ? args[modelFlag + 1]! : DEFAULT_MODEL) as Task["model"]
    await dispatchHeadless(repoRoot, prompt, model)
    return
  }

  // faber [path/to/repo]
  const repoRoot = resolve(args[0] ?? process.cwd())

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
  const repoName = basename(repoRoot)

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

async function dispatchHeadless(repoRoot: string, prompt: string, model: Task["model"] = DEFAULT_MODEL) {
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
      callSite: "index.tsx:dispatchHeadless",
      reason: "Failed to create git worktree",
      exitCode: -1,
      error: err.message,
    })
    updateTask(repoRoot, slug, { status: "failed", completedAt: new Date().toISOString(), exitCode: -1 })
    process.exit(1)
  }

  await new Promise<void>((resolve) => {
    spawnAgent(task, repoRoot, (patch) => {
      updateTask(repoRoot, slug, patch)
      if (patch.status === "done" || patch.status === "failed") {
        console.log(`Task ${slug} ${patch.status} (exit ${patch.exitCode})`)
        resolve()
      }
    })
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
