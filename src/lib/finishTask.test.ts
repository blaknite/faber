import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { finishTask, sessionIdFromLog } from "./finishTask.js"
import { ensureFaberDir, readState, addTask } from "./state.js"
import type { Task } from "../types.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "abc123-test-task",
    prompt: "do the thing",
    model: "anthropic/claude-sonnet-4-6",
    status: "running",
    pid: 12345,
    worktree: ".worktrees/abc123-test-task",
    sessionId: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    exitCode: null,
    hasCommits: false,
    baseBranch: "main",
    ...overrides,
  }
}

function writeLogLine(repoRoot: string, taskId: string, obj: object) {
  const tasksDir = join(repoRoot, ".faber", "tasks")
  mkdirSync(tasksDir, { recursive: true })
  const logPath = join(tasksDir, `${taskId}.jsonl`)
  writeFileSync(logPath, JSON.stringify(obj) + "\n", { flag: "a" })
}

// Stub for worktreeHasCommits that avoids real git calls.
const noCommits = async (_root: string, _slug: string) => false
const hasCommitsFn = async (_root: string, _slug: string) => true

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpRoot: string

beforeEach(() => {
  tmpRoot = join(tmpdir(), `faber-finish-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpRoot, { recursive: true })
  ensureFaberDir(tmpRoot)
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// sessionIdFromLog
// ---------------------------------------------------------------------------

describe("sessionIdFromLog", () => {
  it("returns null when the log file does not exist", () => {
    const result = sessionIdFromLog(tmpRoot, "missing-task")
    expect(result).toBeNull()
  })

  it("returns null when the log has no sessionID fields", () => {
    writeLogLine(tmpRoot, "task1", { type: "text", timestamp: 1 })
    const result = sessionIdFromLog(tmpRoot, "task1")
    expect(result).toBeNull()
  })

  it("returns the sessionID from a log entry", () => {
    writeLogLine(tmpRoot, "task1", { sessionID: "ses-abc123", type: "text" })
    const result = sessionIdFromLog(tmpRoot, "task1")
    expect(result).toBe("ses-abc123")
  })

  it("returns the last sessionID when multiple entries have one", () => {
    writeLogLine(tmpRoot, "task1", { sessionID: "ses-first", type: "text" })
    writeLogLine(tmpRoot, "task1", { sessionID: "ses-last", type: "text" })
    const result = sessionIdFromLog(tmpRoot, "task1")
    expect(result).toBe("ses-last")
  })

  it("skips blank lines and invalid JSON without throwing", () => {
    const logPath = join(tmpRoot, ".faber", "tasks", "task1.jsonl")
    writeFileSync(logPath, '\n  \nnot-valid-json\n{"sessionID":"ses-ok"}\n')
    const result = sessionIdFromLog(tmpRoot, "task1")
    expect(result).toBe("ses-ok")
  })
})

// ---------------------------------------------------------------------------
// finishTask
// ---------------------------------------------------------------------------

describe("finishTask", () => {
  it("sets status to ready on clean exit (exitCode 0)", async () => {
    const task = makeTask()
    addTask(tmpRoot, task)

    await finishTask(tmpRoot, task.id, 0, noCommits)

    const state = readState(tmpRoot)
    const updated = state.tasks.find((t) => t.id === task.id)!
    expect(updated.status).toBe("ready")
    expect(updated.exitCode).toBe(0)
    expect(updated.pid).toBeNull()
    expect(updated.completedAt).toBeTruthy()
  })

  it("sets status to ready even on non-zero exit code", async () => {
    const task = makeTask()
    addTask(tmpRoot, task)

    await finishTask(tmpRoot, task.id, 1, noCommits)

    const state = readState(tmpRoot)
    const updated = state.tasks.find((t) => t.id === task.id)!
    expect(updated.status).toBe("ready")
    expect(updated.exitCode).toBe(1)
  })

  it("records hasCommits as true when the stub says so", async () => {
    const task = makeTask()
    addTask(tmpRoot, task)

    await finishTask(tmpRoot, task.id, 0, hasCommitsFn)

    const state = readState(tmpRoot)
    const updated = state.tasks.find((t) => t.id === task.id)!
    expect(updated.hasCommits).toBe(true)
  })

  it("keeps stopped task stopped, only updates exitCode and pid", async () => {
    const task = makeTask({ status: "stopped" })
    addTask(tmpRoot, task)

    await finishTask(tmpRoot, task.id, 0, noCommits)

    const state = readState(tmpRoot)
    const updated = state.tasks.find((t) => t.id === task.id)!
    expect(updated.status).toBe("stopped")
    expect(updated.exitCode).toBe(0)
    expect(updated.pid).toBeNull()
    // completedAt should not have been set by finishTask for stopped tasks
    expect(updated.completedAt).toBeNull()
  })

  it("keeps failed task failed, only updates exitCode and pid", async () => {
    const task = makeTask({ status: "failed" })
    addTask(tmpRoot, task)

    await finishTask(tmpRoot, task.id, 2, noCommits)

    const state = readState(tmpRoot)
    const updated = state.tasks.find((t) => t.id === task.id)!
    expect(updated.status).toBe("failed")
    expect(updated.exitCode).toBe(2)
    expect(updated.pid).toBeNull()
  })

  it("is a silent no-op when the task ID does not exist", async () => {
    // No tasks added -- should not throw.
    await expect(finishTask(tmpRoot, "nonexistent-id", 0, noCommits)).resolves.toBeUndefined()
  })

  it("writes a failure log entry when exitCode is non-zero", async () => {
    const task = makeTask()
    addTask(tmpRoot, task)

    await finishTask(tmpRoot, task.id, 42, noCommits)

    const logPath = join(tmpRoot, ".faber", "failures.log")
    expect(existsSync(logPath)).toBe(true)
    const lines = readFileSync(logPath, "utf8").trim().split("\n")
    const entry = JSON.parse(lines[0]!)
    expect(entry.taskId).toBe(task.id)
    expect(entry.exitCode).toBe(42)
  })

  it("does not write a failure log entry for exitCode 0", async () => {
    const task = makeTask()
    addTask(tmpRoot, task)

    await finishTask(tmpRoot, task.id, 0, noCommits)

    const logPath = join(tmpRoot, ".faber", "failures.log")
    expect(existsSync(logPath)).toBe(false)
  })

  it("recovers sessionId from the log when it is missing on the task", async () => {
    const task = makeTask({ sessionId: null })
    addTask(tmpRoot, task)
    writeLogLine(tmpRoot, task.id, { sessionID: "ses-recovered", type: "text" })

    await finishTask(tmpRoot, task.id, 0, noCommits)

    const state = readState(tmpRoot)
    const updated = state.tasks.find((t) => t.id === task.id)!
    expect(updated.sessionId).toBe("ses-recovered")
  })

  it("does not overwrite an existing sessionId", async () => {
    const task = makeTask({ sessionId: "ses-existing" })
    addTask(tmpRoot, task)
    writeLogLine(tmpRoot, task.id, { sessionID: "ses-from-log", type: "text" })

    await finishTask(tmpRoot, task.id, 0, noCommits)

    const state = readState(tmpRoot)
    const updated = state.tasks.find((t) => t.id === task.id)!
    expect(updated.sessionId).toBe("ses-existing")
  })
})
