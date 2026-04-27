import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execSync } from "node:child_process"
import type { Task } from "./types.js"

// createAndDispatchTask creates a worktree and spawns an agent process, so
// mock it out. We only care that runHeadless passes the right args through.
const dispatchMock = mock(async (_opts: unknown) => fakeTask)
mock.module("./lib/dispatch.js", () => ({
  createAndDispatchTask: dispatchMock,
}))

const fakeTask: Task = {
  id: "abcd-fake-task",
  prompt: "do something",
  model: "anthropic/claude-sonnet-4-6",
  status: "running",
  pid: null,
  worktree: ".worktrees/abcd-fake-task",
  sessionId: null,
  startedAt: new Date().toISOString(),
  completedAt: null,
  exitCode: null,
  hasCommits: false,
  baseBranch: "main",
}

import { runHeadless } from "./index.js"

let tmpRoot: string
let logLines: string[]
let errorLines: string[]
let exitCode: number | null

function git(args: string, cwd?: string) {
  execSync(`git ${args}`, { cwd: cwd ?? tmpRoot, stdio: "pipe" })
}

function initRepo() {
  tmpRoot = join(tmpdir(), `faber-rh-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpRoot, { recursive: true })
  git("init -b main")
  git("config user.email test@test.com")
  git("config user.name Test")
  writeFileSync(join(tmpRoot, "README.md"), "# test\n")
  git("add .")
  git('commit -m "initial commit"')
}

beforeEach(() => {
  initRepo()
  logLines = []
  errorLines = []
  exitCode = null
  dispatchMock.mockClear()
  dispatchMock.mockImplementation(async (_opts: unknown) => fakeTask)
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

describe("runHeadless", () => {
  describe("not a git repo", () => {
    it("prints an error and exits 1 when the directory has no .git", async () => {
      const noGit = join(tmpdir(), `faber-no-git-${Date.now()}`)
      mkdirSync(noGit, { recursive: true })
      try {
        await expect(runHeadless(noGit, "do something")).rejects.toThrow()
        expect(exitCode).toBe(1)
        expect(errorLines.some((l) => l.includes("Not a git repository"))).toBe(true)
      } finally {
        rmSync(noGit, { recursive: true, force: true })
      }
    })
  })

  describe("happy path", () => {
    it("calls createAndDispatchTask with the prompt and repo root", async () => {
      await runHeadless(tmpRoot, "fix the thing")
      expect(dispatchMock).toHaveBeenCalledTimes(1)
      const opts = dispatchMock.mock.calls[0]?.[0] as Record<string, unknown>
      expect(opts.repoRoot).toBe(tmpRoot)
      expect(opts.prompt).toBe("fix the thing")
    })

    it("prints the task ID to stdout", async () => {
      await runHeadless(tmpRoot, "fix the thing")
      expect(logLines.some((l) => l.includes("abcd-fake-task"))).toBe(true)
    })
  })

  describe("custom tier flag", () => {
    it("passes the tier through to createAndDispatchTask", async () => {
      await runHeadless(tmpRoot, "do a thing", "deep")
      const opts = dispatchMock.mock.calls[0]?.[0] as Record<string, unknown>
      expect(opts.tier).toBe("deep")
    })
  })

  describe("explicitModel and faber.json config interaction", () => {
    it("passes explicitModel through when a raw model string is given", async () => {
      await runHeadless(tmpRoot, "do a thing", "smart", undefined, {}, "google/gemini-2.5-pro")
      const opts = dispatchMock.mock.calls[0]?.[0] as Record<string, unknown>
      expect(opts.explicitModel).toBe("google/gemini-2.5-pro")
    })

    it("passes undefined explicitModel when no explicit override is given", async () => {
      await runHeadless(tmpRoot, "do a thing", "smart", undefined, { models: { smart: "openai/gpt-4o" } })
      const opts = dispatchMock.mock.calls[0]?.[0] as Record<string, unknown>
      expect(opts.explicitModel).toBeUndefined()
    })

    it("uses config model when explicitModel is undefined and loadedConfig has an override", async () => {
      const loadedConfig = { models: { smart: "openai/gpt-4o" } }
      await runHeadless(tmpRoot, "do a thing", "smart", undefined, loadedConfig, undefined)
      const opts = dispatchMock.mock.calls[0]?.[0] as Record<string, unknown>
      expect(opts.explicitModel).toBeUndefined()
      expect(opts.loadedConfig).toEqual(loadedConfig)
    })
  })

  describe("custom base branch", () => {
    it("passes the provided baseBranch through to createAndDispatchTask", async () => {
      await runHeadless(tmpRoot, "do a thing", undefined, "my-feature-branch")
      const opts = dispatchMock.mock.calls[0]?.[0] as Record<string, unknown>
      expect(opts.baseBranch).toBe("my-feature-branch")
    })

    it("resolves the current branch when no baseBranch is provided", async () => {
      await runHeadless(tmpRoot, "do a thing")
      const opts = dispatchMock.mock.calls[0]?.[0] as Record<string, unknown>
      expect(opts.baseBranch).toBe("main")
    })
  })
})
