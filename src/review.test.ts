import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execSync } from "node:child_process"
import type { Task } from "./types.js"

const dispatchMock = mock(async (_opts: unknown) => fakeTask)

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

mock.module("./lib/dispatch.js", () => ({
  createAndDispatchTask: dispatchMock,
}))

import { runReview } from "./review.js"

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

describe("runReview", () => {
  describe("current branch mode", () => {
    it("calls dispatch with baseBranch on feature branch", async () => {
      git("checkout -b feature-x")
      try {
        await runReview(tmpRoot, { kind: "current" })
      } catch {
        // expected
      }

      const callOpts = dispatchMock.mock.calls[0]?.[0] as any
      expect(callOpts.baseBranch).toBe("feature-x")
      expect(callOpts.prompt).toContain("reviewing-code")
      expect(callOpts.prompt).toContain("feature-x")
    })

    it("throws on default branch", async () => {
      try {
        await runReview(tmpRoot, { kind: "current" })
        expect(true).toBe(false)
      } catch (e) {
        expect(String(e)).toContain("nothing to review")
      }
    })

    it("prints task ID in background mode", async () => {
      git("checkout -b feature-x")
      try {
        await runReview(tmpRoot, { kind: "current" }, undefined, undefined, true)
      } catch {
        // expected
      }

      expect(logLines.some((l) => l.includes(fakeTask.id))).toBe(true)
    })
  })

  describe("branch mode", () => {
    it("calls dispatch with specified branch", async () => {
      git("checkout -b feature-x")
      try {
        await runReview(tmpRoot, { kind: "branch", name: "feature-x" })
      } catch {
        // expected
      }

      const callOpts = dispatchMock.mock.calls[0]?.[0] as any
      expect(callOpts.baseBranch).toBe("feature-x")
    })

    it("rejects default branch", async () => {
      try {
        await runReview(tmpRoot, { kind: "branch", name: "main" })
        expect(true).toBe(false)
      } catch (e) {
        expect(String(e)).toContain("is the default branch")
      }
    })
  })

  describe("error cases", () => {
    it("throws on not a git repo", async () => {
      const notAGitRepo = join(tmpdir(), `not-git-${Date.now()}`)
      mkdirSync(notAGitRepo, { recursive: true })
      try {
        await runReview(notAGitRepo, { kind: "current" })
        expect(true).toBe(false)
      } catch (e) {
        expect(String(e)).toContain("Not a git repository")
      }
    })

    it("throws on missing default branch", async () => {
      const testRoot = join(tmpdir(), `no-default-${Date.now()}`)
      mkdirSync(testRoot, { recursive: true })
      execSync(`git init -b develop`, { cwd: testRoot, stdio: "pipe" })
      execSync(`git config user.email test@test.com`, { cwd: testRoot, stdio: "pipe" })
      execSync(`git config user.name Test`, { cwd: testRoot, stdio: "pipe" })
      writeFileSync(join(testRoot, "README.md"), "# test\n")
      execSync(`git add .`, { cwd: testRoot, stdio: "pipe" })
      execSync(`git commit -m "initial"`, { cwd: testRoot, stdio: "pipe" })

      try {
        await runReview(testRoot, { kind: "current" })
        expect(true).toBe(false)
      } catch (e) {
        expect(String(e)).toContain("default branch")
      }
    })
  })
})
