import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ensureFaberDir, stateFilePath, writeState } from "./lib/state.js"
import { watchTask } from "./index.js"
import type { Task } from "./types.js"

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "a3f2-fix-login-bug",
    prompt: "Fix the crash when users with no avatar try to log in",
    model: "anthropic/claude-sonnet-4-6",
    status: "running",
    pid: 12345,
    worktree: ".worktrees/a3f2-fix-login-bug",
    sessionId: null,
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
  tmpRoot = join(tmpdir(), `faber-watch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe("watchTask", () => {
  describe("task not found", () => {
    it("prints an error and exits 1 when the task does not exist", async () => {
      writeState(tmpRoot, { tasks: [] })

      spyOn(process, "exit").mockImplementation((code?: number) => {
        exitCode = code ?? 0
        throw new Error(`process.exit(${code})`)
      })

      await expect(watchTask(tmpRoot, "nonexistent-id")).rejects.toThrow()
      expect(exitCode).toBe(1)
      expect(errorLines.some((l) => l.includes("not found"))).toBe(true)
    })
  })

  describe("task already in terminal state", () => {
    for (const status of ["ready", "done", "failed", "stopped", "unknown"] as const) {
      it(`returns immediately when task is already ${status}`, async () => {
        writeState(tmpRoot, { tasks: [makeTask({ status })] })

        spyOn(process, "exit").mockImplementation((code?: number) => {
          exitCode = code ?? 0
          throw new Error(`process.exit(${code})`)
        })

        await expect(watchTask(tmpRoot, "a3f2-fix-login-bug")).rejects.toThrow()
        expect(exitCode).toBe(0)
        expect(logLines.some((l) => l.includes("not running"))).toBe(true)
        expect(logLines.some((l) => l.includes(status))).toBe(true)
      })
    }
  })

  describe("task transitions from running to terminal", () => {
    it("resolves when the state file is updated to a terminal status", async () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "running" })] })

      // Don't throw on exit — let resolve() settle the promise first, then exit() is a no-op.
      spyOn(process, "exit").mockImplementation((code?: number) => {
        exitCode = code ?? 0
        return undefined as never
      })

      const watching = watchTask(tmpRoot, "a3f2-fix-login-bug")

      // Give watchTask a tick to set up its watcher and interval.
      await Bun.sleep(50)

      // Write a new state with the task marked done. This triggers both the
      // fs.watch callback and the next interval poll.
      writeState(tmpRoot, { tasks: [makeTask({ status: "done", exitCode: 0 })] })

      // The promise should resolve within a reasonable timeout. We give it
      // 2 seconds to account for the 1-second fallback poll interval.
      await expect(Promise.race([
        watching,
        Bun.sleep(2500).then(() => Promise.reject(new Error("timed out waiting for watchTask to resolve"))),
      ])).resolves.toBeUndefined()

      expect(exitCode).toBe(0)
      expect(logLines.some((l) => l.includes("finished") && l.includes("done"))).toBe(true)
    })

    it("resolves when task transitions to failed", async () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "running" })] })

      spyOn(process, "exit").mockImplementation((code?: number) => {
        exitCode = code ?? 0
        return undefined as never
      })

      const watching = watchTask(tmpRoot, "a3f2-fix-login-bug")
      await Bun.sleep(50)

      writeState(tmpRoot, { tasks: [makeTask({ status: "failed", exitCode: 1 })] })

      await expect(Promise.race([
        watching,
        Bun.sleep(2500).then(() => Promise.reject(new Error("timed out waiting for watchTask to resolve"))),
      ])).resolves.toBeUndefined()

      expect(exitCode).toBe(0)
      expect(logLines.some((l) => l.includes("finished") && l.includes("failed"))).toBe(true)
    })

    it("resolves when task transitions to ready", async () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "running" })] })

      spyOn(process, "exit").mockImplementation((code?: number) => {
        exitCode = code ?? 0
        return undefined as never
      })

      const watching = watchTask(tmpRoot, "a3f2-fix-login-bug")
      await Bun.sleep(50)

      writeState(tmpRoot, { tasks: [makeTask({ status: "ready", exitCode: 0 }) ] })

      await expect(Promise.race([
        watching,
        Bun.sleep(2500).then(() => Promise.reject(new Error("timed out waiting for watchTask to resolve"))),
      ])).resolves.toBeUndefined()

      expect(logLines.some((l) => l.includes("finished") && l.includes("ready"))).toBe(true)
    })

    it("resolves when the task is removed from state", async () => {
      writeState(tmpRoot, { tasks: [makeTask({ status: "running" })] })

      spyOn(process, "exit").mockImplementation((code?: number) => {
        exitCode = code ?? 0
        return undefined as never
      })

      const watching = watchTask(tmpRoot, "a3f2-fix-login-bug")
      await Bun.sleep(50)

      // Remove the task entirely from state.
      writeState(tmpRoot, { tasks: [] })

      await expect(Promise.race([
        watching,
        Bun.sleep(2500).then(() => Promise.reject(new Error("timed out waiting for watchTask to resolve"))),
      ])).resolves.toBeUndefined()

      expect(exitCode).toBe(0)
      expect(logLines.some((l) => l.includes("removed"))).toBe(true)
    })
  })
})
