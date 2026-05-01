import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execSync } from "node:child_process"
import type { Task } from "./types.js"
import { addTask, ensureFaberDir, readState } from "./lib/state.js"

const dispatchMock = mock(async (_opts: unknown) => fakeTask)

const fakeTask: Task = {
  id: "abcd12-fake-task",
  prompt: "do something",
  model: "anthropic/claude-sonnet-4-6",
  status: "running",
  pid: null,
  worktree: ".worktrees/abcd12-fake-task",
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

const stopProgressMock = mock(() => {})
const startProgressSpinnerMock = mock((_repoRoot: string, _taskId: string, _intro: string) => stopProgressMock)
const waitForTaskMock = mock(async (_repoRoot: string, _taskId: string): Promise<string> => "ready")
const lastAgentMessageMock = mock((_repoRoot: string, _taskId: string): string | null => null)

mock.module("./lib/managedStep.js", () => ({
  startProgressSpinner: startProgressSpinnerMock,
  waitForTask: waitForTaskMock,
  lastAgentMessage: lastAgentMessageMock,
}))

import { runReview, trimToReviewFindings } from "./review.js"

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
  waitForTaskMock.mockClear()
  waitForTaskMock.mockImplementation(async (_repoRoot: string, _taskId: string): Promise<string> => "ready")
  startProgressSpinnerMock.mockClear()
  lastAgentMessageMock.mockClear()
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

describe("marked rendering with suggestion fences", () => {
  it("does not throw when the agent message contains a suggestion code fence", async () => {
    git("checkout -b feature-x")
    lastAgentMessageMock.mockReturnValueOnce(
      "# Review Findings\n\nLooks good overall.\n\n## 1. `src/foo.ts:10`\n\nBlocking: rename this.\n\n```suggestion\nbetter code here\n```\n",
    )
    const written: string[] = []
    spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      written.push(String(chunk))
      return true
    })
    await expect(runReview(tmpRoot, { kind: "current" })).resolves.toBeUndefined()
    expect(written.some((chunk) => chunk.includes("better code here"))).toBe(true)
  })
})

describe("trimToReviewFindings", () => {
  it("returns the full string when heading is absent", () => {
    const text = "Some preamble\n\nNo heading here."
    expect(trimToReviewFindings(text)).toBe(text)
  })

  it("strips content before the heading when heading is mid-string", () => {
    const text = "Preamble text.\n# Review Findings\n\nActual findings."
    expect(trimToReviewFindings(text)).toBe("# Review Findings\n\nActual findings.")
  })

  it("returns the full string when heading is at the start", () => {
    const text = "# Review Findings\n\nActual findings."
    expect(trimToReviewFindings(text)).toBe(text)
  })

  it("matches only the exact heading", () => {
    const text = "Some text.\n# Review Findings Extra\n\nContent."
    expect(trimToReviewFindings(text)).toBe("# Review Findings Extra\n\nContent.")
  })
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
      expect(callOpts.prompt).toContain("reviewing-code-in-faber")
      expect(callOpts.prompt).toContain("feature-x")
    })

    it("prints a faber continue hint after the review completes", async () => {
      git("checkout -b feature-x")
      const written: string[] = []
      const origWrite = process.stdout.write.bind(process.stdout)
      spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        written.push(String(chunk))
        return true
      })
      try {
        await runReview(tmpRoot, { kind: "current" })
      } catch {
        // expected
      }
      const output = written.join("")
      expect(output).toContain(`faber continue ${fakeTask.id.slice(0, 6)}`)
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

  describe("task mode", () => {
    function seedTask(root: string, patch: Partial<Task> = {}): Task {
      ensureFaberDir(root)
      const task: Task = {
        id: "a1b2c3-task-for-review",
        prompt: "Fix the login bug so users can sign in",
        model: "anthropic/claude-sonnet-4-6",
        status: "ready",
        pid: null,
        worktree: ".worktrees/a1b2c3-task-for-review",
        sessionId: null,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        exitCode: 0,
        hasCommits: true,
        baseBranch: "main",
        ...patch,
      }
      addTask(root, task)
      return task
    }

    it("resolves task branch and uses baseBranch as review base", async () => {
      const task = seedTask(tmpRoot)
      try {
        await runReview(tmpRoot, { kind: "task", id: task.id })
      } catch {
        // expected (worktree doesn't exist)
      }
      const callOpts = dispatchMock.mock.calls[0]?.[0] as any
      expect(callOpts.baseBranch).toBe(task.id)
      expect(callOpts.prompt).toContain(`Review task \`${task.id}\` against \`main\``)
    })

    it("includes the original task prompt under ## Original task", async () => {
      const task = seedTask(tmpRoot)
      try {
        await runReview(tmpRoot, { kind: "task", id: task.id })
      } catch {
        // expected
      }
      const callOpts = dispatchMock.mock.calls[0]?.[0] as any
      expect(callOpts.prompt).toContain("## Original task")
      expect(callOpts.prompt).toContain(task.prompt)
    })

    it("errors when the task is not found", async () => {
      ensureFaberDir(tmpRoot)
      try {
        await runReview(tmpRoot, { kind: "task", id: "nonexistent" })
        expect(true).toBe(false)
      } catch (e) {
        expect(String(e)).toContain('No task matching "nonexistent"')
      }
    })

    it("errors when the task status is running", async () => {
      seedTask(tmpRoot, { status: "running" })
      try {
        await runReview(tmpRoot, { kind: "task", id: "a1b2c3-task-for-review" })
        expect(true).toBe(false)
      } catch (e) {
        expect(String(e)).toContain('only "ready" tasks can be reviewed')
      }
    })

    it("errors when the task status is failed", async () => {
      seedTask(tmpRoot, { status: "failed" })
      try {
        await runReview(tmpRoot, { kind: "task", id: "a1b2c3-task-for-review" })
        expect(true).toBe(false)
      } catch (e) {
        expect(String(e)).toContain('only "ready" tasks can be reviewed')
      }
    })

    it("errors when the task status is done", async () => {
      seedTask(tmpRoot, { status: "done" })
      try {
        await runReview(tmpRoot, { kind: "task", id: "a1b2c3-task-for-review" })
        expect(true).toBe(false)
      } catch (e) {
        expect(String(e)).toContain('only "ready" tasks can be reviewed')
      }
    })

    it("errors when the task has no commits", async () => {
      seedTask(tmpRoot, { hasCommits: false })
      try {
        await runReview(tmpRoot, { kind: "task", id: "a1b2c3-task-for-review" })
        expect(true).toBe(false)
      } catch (e) {
        expect(String(e)).toContain("has no commits to review")
      }
    })

    it("errors when task.id equals task.baseBranch", async () => {
      seedTask(tmpRoot, { baseBranch: "a1b2c3-task-for-review" })
      try {
        await runReview(tmpRoot, { kind: "task", id: "a1b2c3-task-for-review" })
        expect(true).toBe(false)
      } catch (e) {
        expect(String(e)).toContain("its branch matches its base")
      }
    })
  })

  describe("extra context", () => {
    it("includes ## Additional context when extraContext is passed", async () => {
      git("checkout -b feature-x")
      try {
        await runReview(tmpRoot, { kind: "current" }, undefined, undefined, false, "pay attention to auth")
      } catch {
        // expected
      }
      const callOpts = dispatchMock.mock.calls[0]?.[0] as any
      expect(callOpts.prompt).toContain("## Additional context")
      expect(callOpts.prompt).toContain("pay attention to auth")
    })

    it("places ## Original task before ## Additional context in task mode", async () => {
      ensureFaberDir(tmpRoot)
      const task: Task = {
        id: "a1b2c3-task-for-review",
        prompt: "Fix the login bug",
        model: "anthropic/claude-sonnet-4-6",
        status: "ready",
        pid: null,
        worktree: ".worktrees/a1b2c3-task-for-review",
        sessionId: null,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        exitCode: 0,
        hasCommits: true,
        baseBranch: "main",
      }
      addTask(tmpRoot, task)
      try {
        await runReview(tmpRoot, { kind: "task", id: task.id }, undefined, undefined, false, "focus on error handling")
      } catch {
        // expected (worktree doesn't exist)
      }
      const callOpts = dispatchMock.mock.calls[0]?.[0] as any
      const prompt: string = callOpts.prompt
      const originalIdx = prompt.indexOf("## Original task")
      const additionalIdx = prompt.indexOf("## Additional context")
      expect(originalIdx).toBeGreaterThan(-1)
      expect(additionalIdx).toBeGreaterThan(-1)
      expect(originalIdx).toBeLessThan(additionalIdx)
    })

    it("does not add ## Additional context for empty string", async () => {
      git("checkout -b feature-x")
      try {
        await runReview(tmpRoot, { kind: "current" }, undefined, undefined, false, "")
      } catch {
        // expected
      }
      const callOpts = dispatchMock.mock.calls[0]?.[0] as any
      expect(callOpts.prompt).not.toContain("## Additional context")
    })

    it("does not add ## Additional context for whitespace-only string", async () => {
      git("checkout -b feature-x")
      try {
        await runReview(tmpRoot, { kind: "current" }, undefined, undefined, false, "   ")
      } catch {
        // expected
      }
      const callOpts = dispatchMock.mock.calls[0]?.[0] as any
      expect(callOpts.prompt).not.toContain("## Additional context")
    })
  })

  describe("post flag", () => {
    it("post=true includes submission directive in dispatched prompt", async () => {
      git("checkout -b feature-x")
      try {
        await runReview(tmpRoot, { kind: "current" }, undefined, undefined, false, undefined, true)
      } catch {
        // expected
      }
      const callOpts = dispatchMock.mock.calls[0]?.[0] as any
      expect(callOpts.prompt).toContain("submit the review to GitHub")
      expect(callOpts.prompt).toContain("Submitting section")
    })

    it("post=false does not include submission directive", async () => {
      git("checkout -b feature-x")
      try {
        await runReview(tmpRoot, { kind: "current" }, undefined, undefined, false, undefined, false)
      } catch {
        // expected
      }
      const callOpts = dispatchMock.mock.calls[0]?.[0] as any
      expect(callOpts.prompt).not.toContain("submit the review to GitHub")
    })

    it("post=true prints 'To follow up on this review' footer (not 'Review complete')", async () => {
      git("checkout -b feature-x")
      const written: string[] = []
      spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        written.push(String(chunk))
        return true
      })
      try {
        await runReview(tmpRoot, { kind: "current" }, undefined, undefined, false, undefined, true)
      } catch {
        // expected
      }
      const output = written.join("")
      expect(output).toContain("To follow up on this review")
      expect(output).not.toContain("Review complete")
    })
  })

  describe("auto-completion", () => {
    function seedReviewTask(root: string, status: Task["status"]): Task {
      ensureFaberDir(root)
      const task: Task = { ...fakeTask, status }
      addTask(root, task)
      return task
    }

    it("marks the review task done and prints 'Review complete' when it ends in ready status", async () => {
      git("checkout -b feature-x")
      seedReviewTask(tmpRoot, "running")
      waitForTaskMock.mockImplementation(async () => "ready")

      const written: string[] = []
      spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        written.push(String(chunk))
        return true
      })

      try {
        await runReview(tmpRoot, { kind: "current" })
      } catch {
        // expected
      }

      const output = written.join("")
      expect(output).toContain("Review complete.")

      const state = readState(tmpRoot)
      const reviewTask = state.tasks.find((t) => t.id === fakeTask.id)
      expect(reviewTask?.status).toBe("done")
    })

    it("does not mark done and prints original hint when task ends in non-ready status", async () => {
      git("checkout -b feature-x")
      seedReviewTask(tmpRoot, "failed")
      waitForTaskMock.mockImplementation(async () => "failed")

      const written: string[] = []
      spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        written.push(String(chunk))
        return true
      })

      try {
        await runReview(tmpRoot, { kind: "current" })
      } catch {
        // expected
      }

      const output = written.join("")
      expect(output).toContain("To ask follow-up questions or request changes")
      expect(output).not.toContain("Review complete.")

      const state = readState(tmpRoot)
      const reviewTask = state.tasks.find((t) => t.id === fakeTask.id)
      expect(reviewTask?.status).toBe("failed")
    })

    it("does not auto-complete in background mode", async () => {
      git("checkout -b feature-x")

      try {
        await runReview(tmpRoot, { kind: "current" }, undefined, undefined, true)
      } catch {
        // expected
      }

      expect(logLines.some((l) => l.includes(fakeTask.id))).toBe(true)
    })
  })
})
