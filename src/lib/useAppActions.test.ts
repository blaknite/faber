import { describe, expect, it } from "bun:test"
import { taskUsesDiffView, type Task } from "../types.js"

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
    baseBranch: "",
    ...overrides,
  }
}

describe("taskUsesDiffView", () => {
  it("returns true when status is ready and hasCommits is true", () => {
    const task = makeTask({ status: "ready", hasCommits: true })
    expect(taskUsesDiffView(task)).toBe(true)
  })

  it("returns false when status is ready but hasCommits is false", () => {
    const task = makeTask({ status: "ready", hasCommits: false })
    expect(taskUsesDiffView(task)).toBe(false)
  })

  it("returns false when hasCommits is true but status is not ready", () => {
    for (const status of ["running", "done", "failed", "stopped", "unknown"] as const) {
      const task = makeTask({ status, hasCommits: true })
      expect(taskUsesDiffView(task)).toBe(false)
    }
  })

  it("returns false when both conditions are unmet", () => {
    const task = makeTask({ status: "running", hasCommits: false })
    expect(taskUsesDiffView(task)).toBe(false)
  })
})
