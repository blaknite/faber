import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import lockfile from "proper-lockfile"
import type { State, Task } from "../types.js"

const FABER_DIR = ".faber"
const STATE_FILE = "state.json"

function faberDir(repoRoot: string): string {
  return join(repoRoot, FABER_DIR)
}

function statePath(repoRoot: string): string {
  return join(faberDir(repoRoot), STATE_FILE)
}

export function ensureFaberDir(repoRoot: string): void {
  const dir = faberDir(repoRoot)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  // Ensure state file exists so lockfile can lock it
  const path = statePath(repoRoot)
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify({ tasks: [] }, null, 2))
  }
}

export function readState(repoRoot: string): State {
  const path = statePath(repoRoot)
  try {
    return JSON.parse(readFileSync(path, "utf8")) as State
  } catch {
    return { tasks: [] }
  }
}

export function writeState(repoRoot: string, state: State): void {
  writeFileSync(statePath(repoRoot), JSON.stringify(state, null, 2))
}

export function addTask(repoRoot: string, task: Task): void {
  const state = readState(repoRoot)
  state.tasks.push(task)
  writeState(repoRoot, state)
}

export function updateTask(repoRoot: string, id: string, patch: Partial<Task>): void {
  const state = readState(repoRoot)
  const idx = state.tasks.findIndex((t) => t.id === id)
  if (idx === -1) return
  state.tasks[idx] = { ...state.tasks[idx]!, ...patch }
  writeState(repoRoot, state)
}

export function removeTask(repoRoot: string, id: string): void {
  const state = readState(repoRoot)
  state.tasks = state.tasks.filter((t) => t.id !== id)
  writeState(repoRoot, state)
}

// Returns a release function. Throws if already locked (another instance running).
export async function acquireLock(repoRoot: string): Promise<() => Promise<void>> {
  ensureFaberDir(repoRoot)
  const path = statePath(repoRoot)
  try {
    const release = await lockfile.lock(path, { stale: 10000, retries: 0 })
    return release
  } catch {
    throw new Error(
      "faber is already running for this repo. Only one instance is allowed at a time."
    )
  }
}

// On startup, check any "running" tasks whose PID is no longer alive.
export function reconcileRunningTasks(repoRoot: string): void {
  const state = readState(repoRoot)
  let changed = false
  for (const task of state.tasks) {
    if (task.status === "running" && task.pid !== null) {
      const alive = isPidAlive(task.pid)
      if (!alive) {
        task.status = "failed"
        task.completedAt = new Date().toISOString()
        task.exitCode = null
        task.pid = null
        changed = true
      }
    }
  }
  if (changed) writeState(repoRoot, state)
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
