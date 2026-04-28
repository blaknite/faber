import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execSync } from "node:child_process"
import type { Task } from "./types.js"

const dispatchMock = mock(async (_opts: unknown) => fakeTask)

const fakeTask: Task = {
  id: "abcd12-fake-task",
  prompt: "execute the plan",
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

const startProgressSpinnerMock = mock((_repoRoot: string, _taskId: string, _intro: string) => stopProgressMock)
const stopProgressMock = mock(() => {})
const waitForTaskMock = mock(async (_repoRoot: string, _taskId: string) => "ready" as string)
const lastAgentMessageMock = mock((_repoRoot: string, _taskId: string) => null as string | null)

mock.module("./lib/managedStep.js", () => ({
  startProgressSpinner: startProgressSpinnerMock,
  waitForTask: waitForTaskMock,
  lastAgentMessage: lastAgentMessageMock,
}))

import { runExecute } from "./execute.js"

let tmpRoot: string
let planPath: string
let logLines: string[]
let errorLines: string[]
let exitCode: number | null

function git(args: string, cwd?: string) {
  execSync(`git ${args}`, { cwd: cwd ?? tmpRoot, stdio: "pipe" })
}

function initRepo() {
  tmpRoot = join(tmpdir(), `faber-exec-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpRoot, { recursive: true })
  git("init -b main")
  git("config user.email test@test.com")
  git("config user.name Test")
  writeFileSync(join(tmpRoot, "README.md"), "# test\n")
  git("add .")
  git('commit -m "initial commit"')
  planPath = join(tmpRoot, "plan.md")
  writeFileSync(planPath, "## Step 1\n\nDo the thing.\n")
}

beforeEach(() => {
  initRepo()
  logLines = []
  errorLines = []
  exitCode = null
  dispatchMock.mockClear()
  dispatchMock.mockImplementation(async (_opts: unknown) => fakeTask)
  startProgressSpinnerMock.mockClear()
  startProgressSpinnerMock.mockImplementation((_repoRoot: string, _taskId: string, _intro: string) => stopProgressMock)
  stopProgressMock.mockClear()
  waitForTaskMock.mockClear()
  waitForTaskMock.mockImplementation(async (_repoRoot: string, _taskId: string) => "ready")
  lastAgentMessageMock.mockClear()
  lastAgentMessageMock.mockImplementation((_repoRoot: string, _taskId: string) => null)
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

describe("runExecute", () => {
  describe("dispatch", () => {
    it("dispatches with baseBranch set to the current branch", async () => {
      git("checkout -b feature-x")
      await runExecute(tmpRoot, planPath)

      const callOpts = dispatchMock.mock.calls[0]?.[0] as any
      expect(callOpts.baseBranch).toBe("feature-x")
    })

    it("prompt includes 'Load the skill `executing-work`'", async () => {
      await runExecute(tmpRoot, planPath)

      const callOpts = dispatchMock.mock.calls[0]?.[0] as any
      expect(callOpts.prompt).toContain("Load the skill `executing-work`")
    })

    it("prompt inlines the plan file contents under '## Plan'", async () => {
      await runExecute(tmpRoot, planPath)

      const callOpts = dispatchMock.mock.calls[0]?.[0] as any
      expect(callOpts.prompt).toContain("## Plan")
      expect(callOpts.prompt).toContain("## Step 1")
      expect(callOpts.prompt).toContain("Do the thing.")
    })
  })

  describe("error cases", () => {
    it("errors when the plan file does not exist", async () => {
      try {
        await runExecute(tmpRoot, join(tmpRoot, "nonexistent.md"))
        expect(true).toBe(false)
      } catch (e) {
        expect(String(e)).toContain("Plan not found")
      }
    })

    it("errors when not in a git repo", async () => {
      const notAGitRepo = join(tmpdir(), `not-git-${Date.now()}`)
      mkdirSync(notAGitRepo, { recursive: true })
      const fakePlan = join(notAGitRepo, "plan.md")
      writeFileSync(fakePlan, "# Plan\n")
      try {
        await runExecute(notAGitRepo, fakePlan)
        expect(true).toBe(false)
      } catch (e) {
        expect(String(e)).toContain("Not a git repository")
      } finally {
        rmSync(notAGitRepo, { recursive: true, force: true })
      }
    })
  })

  describe("background mode", () => {
    it("prints 'Task <id> running' and does not wait", async () => {
      await runExecute(tmpRoot, planPath, "smart", undefined, true)

      expect(logLines.some((l) => l.includes(fakeTask.id))).toBe(true)
      expect(logLines.some((l) => l.includes("running"))).toBe(true)
      expect(waitForTaskMock.mock.calls.length).toBe(0)
    })
  })

  describe("foreground mode", () => {
    it("prints the status line 'Task <id> ended in status: <status>' regardless of terminal status", async () => {
      waitForTaskMock.mockImplementation(async () => "failed")
      const written: string[] = []
      spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        written.push(String(chunk))
        return true
      })

      await runExecute(tmpRoot, planPath)

      const output = written.join("")
      const shortId = fakeTask.id.slice(0, 6)
      expect(output).toContain(`Task ${shortId} ended in status: failed`)
    })

    it("prints the routing hint regardless of terminal status", async () => {
      waitForTaskMock.mockImplementation(async () => "unknown")
      const written: string[] = []
      spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        written.push(String(chunk))
        return true
      })

      await runExecute(tmpRoot, planPath)

      const output = written.join("")
      const shortId = fakeTask.id.slice(0, 6)
      expect(output).toContain(`faber review --task ${shortId}`)
      expect(output).toContain(`faber merge ${shortId}`)
      expect(output).toContain(`faber continue ${shortId}`)
      expect(output).toContain(`faber done ${shortId}`)
    })

    it("does NOT transition the task's status (no updateTask call); task status equals whatever waitForTask returned", async () => {
      const { ensureFaberDir, addTask, readState } = await import("./lib/state.js")

      ensureFaberDir(tmpRoot)
      const seededTask: Task = { ...fakeTask, status: "ready" }
      addTask(tmpRoot, seededTask)

      waitForTaskMock.mockImplementation(async () => "ready")

      spyOn(process.stdout, "write").mockImplementation(() => true)

      await runExecute(tmpRoot, planPath)

      const state = readState(tmpRoot)
      const found = state.tasks.find((t) => t.id === fakeTask.id)
      expect(found?.status).toBe("ready")
    })
  })
})
