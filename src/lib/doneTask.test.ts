import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ensureFaberDir, readState, writeState } from "./state.js"
import { doneTask } from "./doneTask.js"
import type { Task } from "../types.js"

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "a3f2-fix-login-bug",
    prompt: "Fix the crash when users with no avatar try to log in",
    model: "anthropic/claude-sonnet-4-6",
    status: "ready",
    pid: null,
    worktree: ".worktrees/a3f2-fix-login-bug",
    sessionId: "sess-abc123",
    startedAt: new Date(Date.now() - 150_000).toISOString(),
    completedAt: new Date(Date.now() - 120_000).toISOString(),
    exitCode: 0,
    hasCommits: true,
    baseBranch: "main",
    ...overrides,
  }
}

let tmpRoot: string
let logLines: string[]
let errorLines: string[]
let exitCode: number | null

beforeEach(() => {
  tmpRoot = join(tmpdir(), `faber-done-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpRoot, { recursive: true })
  ensureFaberDir(tmpRoot)
  logLines = []
  errorLines = []
  exitCode = null
  spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logLines.push(args.map(String).join(" "))
  })
  spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errorLines.push(args.map(String).join(" "))
  })
  spyOn(process, "exit").mockImplementation((code?: number) => {
    exitCode = code ?? 0
    throw new Error(`process.exit(${code})`)
  })
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe("doneTask", () => {
  describe("guard: task not found", () => {
    it("prints an error and exits 1 when the task ID does not exist", () => {
      writeState(tmpRoot, { tasks: [] })
      expect(() => doneTask(tmpRoot, "nonexistent-task-id")).toThrow()
      expect(exitCode).toBe(1)
      expect(errorLines.some((l) => l.includes("not found"))).toBe(true)
    })
  })

  describe("guard: wrong status", () => {
    it("prints an error and exits 1 when the task is running", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "running" })] })
      expect(() => doneTask(tmpRoot, "a3f2-fix-login-bug")).toThrow()
      expect(exitCode).toBe(1)
      expect(errorLines.some((l) => l.includes('"running"'))).toBe(true)
    })

    it("prints an error and exits 1 when the task has failed", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "failed" })] })
      expect(() => doneTask(tmpRoot, "a3f2-fix-login-bug")).toThrow()
      expect(exitCode).toBe(1)
      expect(errorLines.some((l) => l.includes('"failed"'))).toBe(true)
    })

    it("prints an error and exits 1 when the task is stopped", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "stopped" })] })
      expect(() => doneTask(tmpRoot, "a3f2-fix-login-bug")).toThrow()
      expect(exitCode).toBe(1)
      expect(errorLines.some((l) => l.includes('"stopped"'))).toBe(true)
    })

    it("prints an error and exits 1 when the task is already done", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "done" })] })
      expect(() => doneTask(tmpRoot, "a3f2-fix-login-bug")).toThrow()
      expect(exitCode).toBe(1)
      expect(errorLines.some((l) => l.includes('"done"'))).toBe(true)
    })
  })

  describe("success", () => {
    it("marks the task as done", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "ready" })] })
      doneTask(tmpRoot, "a3f2-fix-login-bug")
      const state = readState(tmpRoot)
      const task = state.tasks.find((t) => t.id === "a3f2-fix-login-bug")
      expect(task?.status).toBe("done")
    })

    it("prints the task ID to stdout", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "ready" })] })
      doneTask(tmpRoot, "a3f2-fix-login-bug")
      expect(logLines).toContain("a3f2-fix-login-bug")
    })

    it("works with a prefix match on the task ID", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "ready" })] })
      doneTask(tmpRoot, "a3f2")
      const state = readState(tmpRoot)
      const task = state.tasks.find((t) => t.id === "a3f2-fix-login-bug")
      expect(task?.status).toBe("done")
    })
  })
})
