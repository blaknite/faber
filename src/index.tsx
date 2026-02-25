import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { resolve, basename } from "node:path"
import { existsSync } from "node:fs"
import { App } from "./App.js"
import { acquireLock, ensureFaberDir, readState, reconcileRunningTasks, addTask, updateTask } from "./lib/state.js"
import { generateSlug } from "./lib/slug.js"
import { createWorktree } from "./lib/worktree.js"
import { spawnAgent } from "./lib/agent.js"
import type { Task } from "./types.js"

async function main() {
  const args = process.argv.slice(2)

  // faber dispatch "prompt" [--dir /path/to/repo]
  if (args[0] === "dispatch") {
    const prompt = args[1]
    if (!prompt) {
      console.error("Usage: faber dispatch \"<prompt>\" [--dir <repo>]")
      process.exit(1)
    }
    const dirFlag = args.indexOf("--dir")
    const repoRoot = resolve(dirFlag !== -1 && args[dirFlag + 1] ? args[dirFlag + 1]! : process.cwd())
    await dispatchHeadless(repoRoot, prompt)
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

  const renderer = await createCliRenderer({ exitOnCtrlC: false })
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
        renderer.stop()
        process.exit(0)
      }}
    />
  )

  renderer.start()
}

async function dispatchHeadless(repoRoot: string, prompt: string) {
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
