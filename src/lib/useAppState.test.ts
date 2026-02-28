import { describe, expect, it } from "bun:test"
import { sortDescending } from "./useAppState.js"
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
