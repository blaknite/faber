import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, rmdirSync } from "node:fs"
import { join, dirname } from "node:path"
import lockfile from "proper-lockfile"
import type { State, Task } from "../types.js"

const FABER_DIR = ".faber"
const STATE_FILE = "state.json"
const TASKS_DIR = "tasks"

// Separate lock file for per-operation mutual exclusion.
// The TUI instance lock uses the default `state.json.lock` path; this uses
// `state.json.op.lock` so the two locks don't interfere with each other.
const OP_LOCK_SUFFIX = ".op.lock"

function faberDir(repoRoot: string): string {
  return join(repoRoot, FABER_DIR)
}

function statePath(repoRoot: string): string {
  return join(faberDir(repoRoot), STATE_FILE)
}

export function stateFilePath(repoRoot: string): string {
  return statePath(repoRoot)
}

export function taskOutputPath(repoRoot: string, taskId: string): string {
  return join(faberDir(repoRoot), TASKS_DIR, `${taskId}.jsonl`)
}

export function ensureFaberDir(repoRoot: string): void {
  const dir = faberDir(repoRoot)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  // Ensure the tasks output directory exists
  const tasksDir = join(dir, TASKS_DIR)
  if (!existsSync(tasksDir)) {
    mkdirSync(tasksDir, { recursive: true })
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

// Wraps a read-modify-write cycle in a short-lived per-operation lock so
// concurrent callers (e.g. two agents finishing at the same time) don't
// overwrite each other's updates.
//
// We use a simple filesystem-based lock: try to exclusively create the lock
// directory using mkdir (atomic on all platforms). If it fails with EEXIST,
// the lock is held elsewhere. lockSync doesn't support retries, so we
// implement a simple spin-wait: try to acquire the lock up to `maxAttempts`
// times with a short sleep between each attempt. Each operation should
// complete in well under a millisecond so a 200 ms total budget with 20 ms
// sleeps is more than enough headroom.
function withOpLock(repoRoot: string, fn: () => void): void {
  const lockDirPath = join(faberDir(repoRoot), STATE_FILE + OP_LOCK_SUFFIX)

  const maxAttempts = 10
  const sleepMs = 20

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      mkdirSync(lockDirPath)
      break
    } catch (err: any) {
      if (err?.code !== "EEXIST" || attempt === maxAttempts - 1) throw err
      // Busy-wait using a shared buffer so we don't need async.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleepMs)
    }
  }

  try {
    fn()
  } finally {
    rmdirSync(lockDirPath)
  }
}

export function addTask(repoRoot: string, task: Task): void {
  withOpLock(repoRoot, () => {
    const state = readState(repoRoot)
    state.tasks.push(task)
    writeState(repoRoot, state)
  })
}

export function updateTask(repoRoot: string, id: string, patch: Partial<Task>): void {
  withOpLock(repoRoot, () => {
    const state = readState(repoRoot)
    const idx = state.tasks.findIndex((t) => t.id === id)
    if (idx === -1) return
    state.tasks[idx] = { ...state.tasks[idx]!, ...patch }
    writeState(repoRoot, state)
  })
}

export function removeTask(repoRoot: string, id: string): void {
  withOpLock(repoRoot, () => {
    const state = readState(repoRoot)
    state.tasks = state.tasks.filter((t) => t.id !== id)
    writeState(repoRoot, state)
  })

  const logPath = taskOutputPath(repoRoot, id)
  if (existsSync(logPath)) {
    rmSync(logPath)
  }
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
  withOpLock(repoRoot, () => {
    const state = readState(repoRoot)
    let changed = false
    for (const task of state.tasks) {
      if (task.status === "running" && task.pid !== null) {
        const alive = isPidAlive(task.pid)
        if (!alive) {
          task.status = "unknown"
          task.completedAt = new Date().toISOString()
          task.exitCode = null
          task.pid = null
          changed = true
        }
      }
    }
    if (changed) writeState(repoRoot, state)
  })
}

// Walk up from `startDir` until we find a directory containing `.faber/state.json`.
// Returns the repo root, or null if not found.
export function findRepoRoot(startDir: string): string | null {
  let dir = startDir
  while (true) {
    if (existsSync(join(dir, FABER_DIR, STATE_FILE))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
