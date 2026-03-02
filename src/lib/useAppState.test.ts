import { describe, expect, it } from "bun:test"
import { filterByBranch, sortDescending } from "./useAppState.js"
import type { Task } from "../types.js"

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

describe("sortDescending", () => {
  it("returns an empty array when given an empty array", () => {
    expect(sortDescending([])).toEqual([])
  })

  it("returns a single task unchanged", () => {
    const task = makeTask({ id: "only-one", startedAt: "2025-01-01T00:00:00Z" })
    const result = sortDescending([task])
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe("only-one")
  })

  it("sorts tasks by startedAt in descending order (newest first)", () => {
    const older = makeTask({ id: "older", startedAt: "2025-01-01T00:00:00Z" })
    const newer = makeTask({ id: "newer", startedAt: "2025-01-02T00:00:00Z" })
    const result = sortDescending([older, newer])
    expect(result[0]!.id).toBe("newer")
    expect(result[1]!.id).toBe("older")
  })

  it("handles multiple tasks with varied timestamps", () => {
    const a = makeTask({ id: "a", startedAt: "2025-01-03T00:00:00Z" })
    const b = makeTask({ id: "b", startedAt: "2025-01-01T00:00:00Z" })
    const c = makeTask({ id: "c", startedAt: "2025-01-02T00:00:00Z" })
    const result = sortDescending([a, b, c])
    expect(result.map((t) => t.id)).toEqual(["a", "c", "b"])
  })

  it("does not mutate the original array", () => {
    const older = makeTask({ id: "older", startedAt: "2025-01-01T00:00:00Z" })
    const newer = makeTask({ id: "newer", startedAt: "2025-01-02T00:00:00Z" })
    const original = [older, newer]
    sortDescending(original)
    expect(original[0]!.id).toBe("older")
    expect(original[1]!.id).toBe("newer")
  })

  it("preserves relative order for tasks with identical timestamps", () => {
    const ts = "2025-01-01T00:00:00Z"
    const a = makeTask({ id: "a", startedAt: ts })
    const b = makeTask({ id: "b", startedAt: ts })
    const c = makeTask({ id: "c", startedAt: ts })
    const result = sortDescending([a, b, c])
    // All have the same timestamp; localeCompare returns 0 so the sort should
    // be stable and preserve the original order.
    expect(result.map((t) => t.id)).toEqual(["a", "b", "c"])
  })
})

describe("filterByBranch", () => {
  it("returns only tasks whose baseBranch matches currentBranch", () => {
    const matching = makeTask({ id: "match", baseBranch: "feature-x" })
    const other = makeTask({ id: "other", baseBranch: "main" })
    const result = filterByBranch([matching, other], "feature-x")
    expect(result.map((t) => t.id)).toEqual(["match"])
  })

  it("includes tasks with an empty baseBranch regardless of currentBranch", () => {
    const legacy = makeTask({ id: "legacy", baseBranch: "" })
    const other = makeTask({ id: "other", baseBranch: "main" })
    const result = filterByBranch([legacy, other], "feature-x")
    expect(result.map((t) => t.id)).toEqual(["legacy"])
  })

  it("includes both matching and legacy tasks together", () => {
    const matching = makeTask({ id: "match", baseBranch: "feature-x" })
    const legacy = makeTask({ id: "legacy", baseBranch: "" })
    const other = makeTask({ id: "other", baseBranch: "main" })
    const result = filterByBranch([matching, legacy, other], "feature-x")
    expect(result.map((t) => t.id)).toEqual(["match", "legacy"])
  })

  it("shows only legacy tasks when currentBranch is empty (initial state)", () => {
    // When currentBranch hasn't loaded yet it's "". Legacy tasks (baseBranch "")
    // still show up; tasks created on a specific branch don't match until the
    // branch is resolved.
    const legacy = makeTask({ id: "legacy", baseBranch: "" })
    const withBranch = makeTask({ id: "with-branch", baseBranch: "main" })
    const result = filterByBranch([legacy, withBranch], "")
    expect(result.map((t) => t.id)).toEqual(["legacy"])
  })

  it("returns an empty array when no tasks match", () => {
    const task = makeTask({ id: "a", baseBranch: "other" })
    expect(filterByBranch([task], "feature-x")).toEqual([])
  })

  it("does not mutate the original array", () => {
    const tasks = [
      makeTask({ id: "a", baseBranch: "main" }),
      makeTask({ id: "b", baseBranch: "feature-x" }),
    ]
    filterByBranch(tasks, "feature-x")
    expect(tasks).toHaveLength(2)
  })
})
