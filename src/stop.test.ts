import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ensureFaberDir, readState, writeState } from "./lib/state.js"
import { stopTask } from "./index.js"
import type { Task } from "./types.js"

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "a3f2-fix-login-bug",
    prompt: "Fix the crash when users with no avatar try to log in",
    model: "anthropic/claude-sonnet-4-6",
    status: "running",
    pid: 12345,
    worktree: ".worktrees/a3f2-fix-login-bug",
    sessionId: "sess-abc123",
    startedAt: new Date(Date.now() - 30_000).toISOString(),
    completedAt: null,
    exitCode: null,
    hasCommits: false,
    baseBranch: "main",
    ...overrides,
  }
}

let tmpRoot: string
let logLines: string[]
let errorLines: string[]
let exitCode: number | null

beforeEach(() => {
  tmpRoot = join(tmpdir(), `faber-stop-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

describe("stopTask", () => {
  describe("guard: task not found", () => {
    it("prints an error and exits 1 when the task ID does not exist", () => {
      writeState(tmpRoot, { tasks: [] })
      expect(() => stopTask(tmpRoot, "nonexistent-task-id")).toThrow()
      expect(exitCode).toBe(1)
      expect(errorLines.some((l) => l.includes("not found"))).toBe(true)
    })
  })

  describe("guard: task not running", () => {
    it("prints an error and exits 1 when the task is ready", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "ready" })] })
      expect(() => stopTask(tmpRoot, "a3f2-fix-login-bug")).toThrow()
      expect(exitCode).toBe(1)
      expect(errorLines.some((l) => l.includes("not running"))).toBe(true)
    })

    it("prints an error and exits 1 when the task is already stopped", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "stopped" })] })
      expect(() => stopTask(tmpRoot, "a3f2-fix-login-bug")).toThrow()
      expect(exitCode).toBe(1)
      expect(errorLines.some((l) => l.includes("not running"))).toBe(true)
    })

    it("includes the current status in the error message", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "failed" })] })
      expect(() => stopTask(tmpRoot, "a3f2-fix-login-bug")).toThrow()
      expect(errorLines.some((l) => l.includes("failed"))).toBe(true)
    })
  })

  describe("success", () => {
    it("patches the task status to stopped", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "running" })] })
      expect(() => stopTask(tmpRoot, "a3f2-fix-login-bug")).toThrow()
      const state = readState(tmpRoot)
      const task = state.tasks.find((t) => t.id === "a3f2-fix-login-bug")
      expect(task?.status).toBe("stopped")
    })

    it("sets completedAt to a non-null ISO timestamp", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "running", completedAt: null })] })
      expect(() => stopTask(tmpRoot, "a3f2-fix-login-bug")).toThrow()
      const state = readState(tmpRoot)
      const task = state.tasks.find((t) => t.id === "a3f2-fix-login-bug")
      expect(task?.completedAt).not.toBeNull()
      expect(new Date(task!.completedAt!).getTime()).toBeGreaterThan(0)
    })

    it("clears exitCode", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "running", exitCode: 0 })] })
      expect(() => stopTask(tmpRoot, "a3f2-fix-login-bug")).toThrow()
      const state = readState(tmpRoot)
      const task = state.tasks.find((t) => t.id === "a3f2-fix-login-bug")
      expect(task?.exitCode).toBeNull()
    })

    it("clears pid", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "running", pid: 99999 })] })
      expect(() => stopTask(tmpRoot, "a3f2-fix-login-bug")).toThrow()
      const state = readState(tmpRoot)
      const task = state.tasks.find((t) => t.id === "a3f2-fix-login-bug")
      expect(task?.pid).toBeNull()
    })

    it("prints the task ID to stdout", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "running" })] })
      expect(() => stopTask(tmpRoot, "a3f2-fix-login-bug")).toThrow()
      expect(logLines).toContain("a3f2-fix-login-bug")
    })

    it("exits with code 130", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "running" })] })
      expect(() => stopTask(tmpRoot, "a3f2-fix-login-bug")).toThrow()
      expect(exitCode).toBe(130)
    })
  })
})
