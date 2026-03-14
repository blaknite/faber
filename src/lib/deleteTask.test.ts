import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { deleteTask } from "./deleteTask.js"
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
    status: "ready",
    pid: null,
    worktree: ".worktrees/abc123-test-task",
    sessionId: null,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    exitCode: 0,
    hasCommits: false,
    baseBranch: "main",
    ...overrides,
  }
}

// A no-op stub for removeWorktree that records whether it was called.
function makeWorktreeStub(opts: { shouldFail?: boolean } = {}) {
  let called = false
  const fn = async (_root: string, _slug: string) => {
    called = true
    if (opts.shouldFail) throw new Error("worktree removal failed")
  }
  return { fn, wasCalled: () => called }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpRoot: string

beforeEach(() => {
  tmpRoot = join(tmpdir(), `faber-delete-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpRoot, { recursive: true })
  ensureFaberDir(tmpRoot)
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// deleteTask
// ---------------------------------------------------------------------------

describe("deleteTask", () => {
  it("deletes the task and returns its ID on the happy path", async () => {
    const task = makeTask()
    addTask(tmpRoot, task)

    const stub = makeWorktreeStub()
    const result = await deleteTask(tmpRoot, task.id, stub.fn)

    expect(result).toBe(task.id)
    expect(stub.wasCalled()).toBe(true)

    const state = readState(tmpRoot)
    expect(state.tasks.find((t) => t.id === task.id)).toBeUndefined()
  })

  it("supports prefix matching on the task ID", async () => {
    const task = makeTask({ id: "abc123-some-work" })
    addTask(tmpRoot, task)

    const stub = makeWorktreeStub()
    const result = await deleteTask(tmpRoot, "abc123", stub.fn)

    expect(result).toBe("abc123-some-work")
    const state = readState(tmpRoot)
    expect(state.tasks).toHaveLength(0)
  })

  it("throws when the task ID is not found", async () => {
    const stub = makeWorktreeStub()
    await expect(deleteTask(tmpRoot, "nonexistent-id", stub.fn)).rejects.toThrow(
      'No task matching "nonexistent-id"',
    )
    expect(stub.wasCalled()).toBe(false)
  })

  it("throws when the task is currently running", async () => {
    const task = makeTask({ status: "running", pid: 99999 })
    addTask(tmpRoot, task)

    const stub = makeWorktreeStub()
    await expect(deleteTask(tmpRoot, task.id, stub.fn)).rejects.toThrow(
      `Task "${task.id}" is currently running. Stop it before deleting.`,
    )

    // Task should still be in state -- nothing was removed.
    const state = readState(tmpRoot)
    expect(state.tasks.find((t) => t.id === task.id)).toBeDefined()
    expect(stub.wasCalled()).toBe(false)
  })

  it("removes the task from state even when worktree removal fails", async () => {
    const task = makeTask()
    addTask(tmpRoot, task)

    const stub = makeWorktreeStub({ shouldFail: true })
    // Should not throw -- worktree errors are swallowed.
    const result = await deleteTask(tmpRoot, task.id, stub.fn)

    expect(result).toBe(task.id)
    expect(stub.wasCalled()).toBe(true)

    const state = readState(tmpRoot)
    expect(state.tasks.find((t) => t.id === task.id)).toBeUndefined()
  })
})
