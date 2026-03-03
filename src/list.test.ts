import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ensureFaberDir, writeState } from "./lib/state.js"
import { listTasks } from "./index.js"
import type { Task } from "./types.js"

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "a3f2-fix-login-bug",
    prompt: "Fix the crash when users with no avatar try to log in",
    model: "anthropic/claude-sonnet-4-6",
    status: "ready",
    pid: null,
    worktree: ".worktrees/a3f2-fix-login-bug",
    sessionId: null,
    startedAt: new Date(Date.now() - 150_000).toISOString(), // 2m 30s ago
    completedAt: new Date(Date.now() - 120_000).toISOString(),
    exitCode: 0,
    hasCommits: true,
    baseBranch: "main",
    ...overrides,
  }
}

let tmpRoot: string
let lines: string[]

beforeEach(() => {
  tmpRoot = join(tmpdir(), `faber-list-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpRoot, { recursive: true })
  ensureFaberDir(tmpRoot)
  lines = []
  spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "))
  })
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe("listTasks", () => {
  it("prints nothing when there are no tasks", () => {
    listTasks(tmpRoot, null)
    expect(lines).toHaveLength(0)
  })

  it("prints one row per task", () => {
    writeState(tmpRoot, {
      tasks: [
        makeTask({ id: "a3f2-fix-login-bug" }),
        makeTask({ id: "b7c1-add-csv-export", status: "running" }),
      ],
    })
    listTasks(tmpRoot, null)
    expect(lines).toHaveLength(2)
  })

  it("each row contains the task ID", () => {
    writeState(tmpRoot, { tasks: [makeTask({ id: "a3f2-fix-login-bug" })] })
    listTasks(tmpRoot, null)
    expect(lines[0]).toContain("a3f2-fix-login-bug")
  })

  it("each row contains the task status", () => {
    writeState(tmpRoot, { tasks: [makeTask({ status: "ready" })] })
    listTasks(tmpRoot, null)
    expect(lines[0]).toContain("ready")
  })

  it("each row contains the elapsed time", () => {
    writeState(tmpRoot, {
      tasks: [
        makeTask({
          startedAt: new Date(Date.now() - 150_000).toISOString(),
          completedAt: new Date(Date.now() - 120_000).toISOString(),
        }),
      ],
    })
    listTasks(tmpRoot, null)
    // Elapsed is 30s (completedAt - startedAt = 30s)
    expect(lines[0]).toContain("0m 30s")
  })

  it("each row contains a portion of the prompt", () => {
    const prompt = "Fix the crash when users with no avatar try to log in"
    writeState(tmpRoot, { tasks: [makeTask({ prompt })] })
    listTasks(tmpRoot, null)
    // At least the start of the prompt should appear
    expect(lines[0]).toContain("Fix the crash")
  })

  it("truncates long prompts with ellipsis", () => {
    const prompt = "A".repeat(500)
    writeState(tmpRoot, { tasks: [makeTask({ prompt })] })
    // Force a narrow terminal width so truncation kicks in
    const originalColumns = process.stdout.columns
    Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true })
    try {
      listTasks(tmpRoot, null)
    } finally {
      Object.defineProperty(process.stdout, "columns", { value: originalColumns, configurable: true })
    }
    expect(lines[0]).toContain("...")
    // Should not contain the full prompt
    expect(lines[0]).not.toContain("A".repeat(200))
  })

  it("filters tasks by status when statusFilter is set", () => {
    writeState(tmpRoot, {
      tasks: [
        makeTask({ id: "a3f2-fix-login-bug", status: "ready" }),
        makeTask({ id: "b7c1-add-csv-export", status: "running" }),
        makeTask({ id: "9e01-refactor-auth", status: "done" }),
      ],
    })
    listTasks(tmpRoot, "ready")
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("a3f2-fix-login-bug")
  })

  it("prints nothing when status filter matches no tasks", () => {
    writeState(tmpRoot, {
      tasks: [makeTask({ status: "running" })],
    })
    listTasks(tmpRoot, "done")
    expect(lines).toHaveLength(0)
  })

  it("aligns columns using padding so rows have the same length", () => {
    const prompt = "Do something useful"
    writeState(tmpRoot, {
      tasks: [
        makeTask({ id: "short", status: "ready", prompt }),
        makeTask({ id: "a-much-longer-task-id", status: "running", prompt }),
      ],
    })
    listTasks(tmpRoot, null)
    // Both rows should have the same total length because the shorter ID gets padded
    expect(lines[0]!.length).toBe(lines[1]!.length)
  })
})
