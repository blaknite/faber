import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ensureFaberDir, readState, writeState } from "./lib/state.js"
import { continueTask } from "./index.js"
import type { Task } from "./types.js"

// spawnAgent spawns a real child process, so mock it out for unit tests.
const agentMock = mock(() => {})
mock.module("./lib/agent.js", () => ({
  spawnAgent: agentMock,
  DEFAULT_RESUME_PROMPT: "The task was interrupted. Please continue where you left off.",
}))

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
  tmpRoot = join(tmpdir(), `faber-continue-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpRoot, { recursive: true })
  ensureFaberDir(tmpRoot)
  logLines = []
  errorLines = []
  exitCode = null
  agentMock.mockClear()
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

describe("continueTask", () => {
  describe("guard: task not found", () => {
    it("prints an error and exits 1 when the task ID does not exist", () => {
      writeState(tmpRoot, { tasks: [] })
      expect(() => continueTask(tmpRoot, "nonexistent-task-id")).toThrow()
      expect(exitCode).toBe(1)
      expect(errorLines.some((l) => l.includes("not found"))).toBe(true)
    })
  })

  describe("guard: no sessionId", () => {
    it("prints an error and exits 1 when the task has no sessionId", () => {
      writeState(tmpRoot, { tasks: [makeTask({ sessionId: null })] })
      expect(() => continueTask(tmpRoot, "a3f2-fix-login-bug")).toThrow()
      expect(exitCode).toBe(1)
      expect(errorLines.some((l) => l.includes("no session ID"))).toBe(true)
    })
  })

  describe("guard: already running", () => {
    it("prints an error and exits 1 when the task is already running", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "running" })] })
      expect(() => continueTask(tmpRoot, "a3f2-fix-login-bug")).toThrow()
      expect(exitCode).toBe(1)
      expect(errorLines.some((l) => l.includes("already running"))).toBe(true)
    })
  })

  describe("success", () => {
    it("patches the task status to running", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "ready" })] })
      continueTask(tmpRoot, "a3f2-fix-login-bug")
      const state = readState(tmpRoot)
      const task = state.tasks.find((t) => t.id === "a3f2-fix-login-bug")
      expect(task?.status).toBe("running")
    })

    it("clears completedAt", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "ready", completedAt: new Date().toISOString() })] })
      continueTask(tmpRoot, "a3f2-fix-login-bug")
      const state = readState(tmpRoot)
      const task = state.tasks.find((t) => t.id === "a3f2-fix-login-bug")
      expect(task?.completedAt).toBeNull()
    })

    it("clears exitCode", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "ready", exitCode: 1 })] })
      continueTask(tmpRoot, "a3f2-fix-login-bug")
      const state = readState(tmpRoot)
      const task = state.tasks.find((t) => t.id === "a3f2-fix-login-bug")
      expect(task?.exitCode).toBeNull()
    })

    it("calls spawnAgent with the task's sessionId", () => {
      const sessionId = "sess-abc123"
      writeState(tmpRoot, { tasks: [makeTask({ status: "ready", sessionId })] })
      continueTask(tmpRoot, "a3f2-fix-login-bug")
      expect(agentMock).toHaveBeenCalledTimes(1)
      const callArgs = agentMock.mock.calls[0] as unknown[]
      expect(callArgs[2]).toBe(sessionId)
    })

    it("uses the default resume prompt when none is provided", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "ready" })] })
      continueTask(tmpRoot, "a3f2-fix-login-bug")
      expect(agentMock).toHaveBeenCalledTimes(1)
      const callArgs = agentMock.mock.calls[0] as unknown[]
      expect(callArgs[3]).toBe("The task was interrupted. Please continue where you left off.")
    })

    it("uses a custom prompt when provided", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "ready" })] })
      continueTask(tmpRoot, "a3f2-fix-login-bug", "do X instead")
      expect(agentMock).toHaveBeenCalledTimes(1)
      const callArgs = agentMock.mock.calls[0] as unknown[]
      expect(callArgs[3]).toBe("do X instead")
    })

    it("prints the task ID to stdout", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "ready" })] })
      continueTask(tmpRoot, "a3f2-fix-login-bug")
      expect(logLines).toContain("a3f2-fix-login-bug")
    })

    it("works when the task status is failed", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "failed" })] })
      continueTask(tmpRoot, "a3f2-fix-login-bug")
      const state = readState(tmpRoot)
      const task = state.tasks.find((t) => t.id === "a3f2-fix-login-bug")
      expect(task?.status).toBe("running")
    })

    it("works when the task status is stopped", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "stopped" })] })
      continueTask(tmpRoot, "a3f2-fix-login-bug")
      const state = readState(tmpRoot)
      const task = state.tasks.find((t) => t.id === "a3f2-fix-login-bug")
      expect(task?.status).toBe("running")
    })

    it("works when the task status is unknown", () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "unknown" })] })
      continueTask(tmpRoot, "a3f2-fix-login-bug")
      const state = readState(tmpRoot)
      const task = state.tasks.find((t) => t.id === "a3f2-fix-login-bug")
      expect(task?.status).toBe("running")
    })
  })
})
