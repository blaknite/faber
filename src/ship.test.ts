import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execSync } from "node:child_process"
import type { Task } from "./types.js"

const dispatchMock = mock(async (_opts: unknown) => fakeTask)

const fakeTask: Task = {
  id: "abcd12-fake-ship-task",
  prompt: "ship something",
  model: "anthropic/claude-sonnet-4-6",
  status: "running",
  pid: null,
  worktree: ".worktrees/abcd12-fake-ship-task",
  sessionId: null,
  startedAt: new Date().toISOString(),
  completedAt: null,
  exitCode: null,
  hasCommits: false,
  baseBranch: "feature-x",
}

mock.module("./lib/dispatch.js", () => ({
  createAndDispatchTask: dispatchMock,
}))

const stopProgressMock = mock(() => {})
const startProgressSpinnerMock = mock((_repoRoot: string, _taskId: string, _intro: string) => stopProgressMock)
const waitForTaskMock = mock(async (_repoRoot: string, _taskId: string) => "ready")
const lastAgentMessageMock = mock((_repoRoot: string, _taskId: string): string | null => null)

mock.module("./lib/managedStep.js", () => ({
  startProgressSpinner: startProgressSpinnerMock,
  waitForTask: waitForTaskMock,
  lastAgentMessage: lastAgentMessageMock,
}))

import { runShip } from "./ship.js"

let tmpRoot: string
let logLines: string[]

function git(args: string, cwd?: string) {
  execSync(`git ${args}`, { cwd: cwd ?? tmpRoot, stdio: "pipe" })
}

function initRepo() {
  tmpRoot = join(tmpdir(), `faber-ship-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpRoot, { recursive: true })
  git("init -b main")
  git("config user.email test@test.com")
  git("config user.name Test")
  writeFileSync(join(tmpRoot, "README.md"), "# test\n")
  git("add .")
  git('commit -m "initial commit"')
}

function makeFeatureBranch(name: string = "feature-x") {
  git(`checkout -b ${name}`)
  writeFileSync(join(tmpRoot, "feature.txt"), "feature\n")
  git("add .")
  git(`commit -m "feature commit"`)
  git("checkout main")
  git(`checkout ${name}`)
}

beforeEach(() => {
  initRepo()
  logLines = []
  dispatchMock.mockClear()
  dispatchMock.mockImplementation(async (_opts: unknown) => fakeTask)
  startProgressSpinnerMock.mockClear()
  startProgressSpinnerMock.mockImplementation((_repoRoot: string, _taskId: string, _intro: string) => stopProgressMock)
  waitForTaskMock.mockClear()
  waitForTaskMock.mockImplementation(async (_repoRoot: string, _taskId: string) => "ready")
  lastAgentMessageMock.mockClear()
  lastAgentMessageMock.mockImplementation((_repoRoot: string, _taskId: string): string | null => null)
  stopProgressMock.mockClear()
  spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logLines.push(args.map(String).join(" "))
  })
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe("runShip", () => {
  describe("branch resolution", () => {
    it("resolves to the current branch when on a feature branch", async () => {
      makeFeatureBranch("feature-x")
      const written: string[] = []
      spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        written.push(String(chunk))
        return true
      })

      await runShip(tmpRoot, null)

      const callOpts = dispatchMock.mock.calls[0]?.[0] as any
      expect(callOpts.baseBranch).toBe("feature-x")
    })

    it("uses branchOverride when provided", async () => {
      makeFeatureBranch("feature-y")
      git("checkout main")
      const written: string[] = []
      spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        written.push(String(chunk))
        return true
      })

      await runShip(tmpRoot, "feature-y")

      const callOpts = dispatchMock.mock.calls[0]?.[0] as any
      expect(callOpts.baseBranch).toBe("feature-y")
    })
  })

  describe("error cases", () => {
    it("throws when not a git repository", async () => {
      const notAGitRepo = join(tmpdir(), `not-git-${Date.now()}`)
      mkdirSync(notAGitRepo, { recursive: true })
      try {
        await runShip(notAGitRepo, null)
        expect(true).toBe(false)
      } catch (e) {
        expect(String(e)).toContain("Not a git repository")
      } finally {
        rmSync(notAGitRepo, { recursive: true, force: true })
      }
    })

    it("throws when HEAD is detached and no branchOverride is passed", async () => {
      const sha = execSync("git rev-parse HEAD", { cwd: tmpRoot, stdio: "pipe" }).toString().trim()
      execSync(`git checkout ${sha}`, { cwd: tmpRoot, stdio: "pipe" })

      try {
        await runShip(tmpRoot, null)
        expect(true).toBe(false)
      } catch (e) {
        expect(String(e)).toContain("HEAD is detached")
      }
    })

    it("throws when the named branch does not exist locally", async () => {
      try {
        await runShip(tmpRoot, "nonexistent-branch")
        expect(true).toBe(false)
      } catch (e) {
        expect(String(e)).toContain("does not exist locally")
      }
    })

    it("throws when the target equals the default branch", async () => {
      try {
        await runShip(tmpRoot, "main")
        expect(true).toBe(false)
      } catch (e) {
        expect(String(e)).toContain("it is the default branch")
      }
    })

    it("throws when the target has no commits ahead of the default branch", async () => {
      git("checkout -b no-commits-branch")

      try {
        await runShip(tmpRoot, "no-commits-branch")
        expect(true).toBe(false)
      } catch (e) {
        expect(String(e)).toContain("Nothing to ship")
      }
    })

    it("throws when cleanroom mode is enabled in config", async () => {
      const faberDir = join(tmpRoot, ".faber")
      mkdirSync(faberDir, { recursive: true })
      writeFileSync(join(faberDir, "faber.json"), JSON.stringify({ cleanroom: true }))
      makeFeatureBranch("feature-clean")

      try {
        await runShip(tmpRoot, "feature-clean")
        expect(true).toBe(false)
      } catch (e) {
        expect(String(e)).toContain("cleanroom mode disabled")
      }
    })
  })

  describe("prompt content", () => {
    it("names the target branch in the prompt", async () => {
      makeFeatureBranch("feature-prompt-test")
      const written: string[] = []
      spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        written.push(String(chunk))
        return true
      })

      await runShip(tmpRoot, "feature-prompt-test")

      const callOpts = dispatchMock.mock.calls[0]?.[0] as any
      expect(callOpts.prompt).toContain("feature-prompt-test")
    })

    it("tells the agent not to push its own branch", async () => {
      makeFeatureBranch("feature-x")
      const written: string[] = []
      spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        written.push(String(chunk))
        return true
      })

      await runShip(tmpRoot, "feature-x")

      const callOpts = dispatchMock.mock.calls[0]?.[0] as any
      expect(callOpts.prompt).toContain("Do not push your current branch")
    })

    it("asks the agent to end with 'PR: <url>' for orchestrator parsing", async () => {
      makeFeatureBranch("feature-x")
      const written: string[] = []
      spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        written.push(String(chunk))
        return true
      })

      await runShip(tmpRoot, "feature-x")

      const callOpts = dispatchMock.mock.calls[0]?.[0] as any
      expect(callOpts.prompt).toContain("PR: <url>")
    })
  })

  describe("foreground mode", () => {
    it("prints the status line regardless of terminal status", async () => {
      makeFeatureBranch("feature-x")
      waitForTaskMock.mockImplementation(async () => "failed")
      const written: string[] = []
      spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        written.push(String(chunk))
        return true
      })

      await runShip(tmpRoot, "feature-x")

      const output = written.join("")
      expect(output).toContain(`Task ${fakeTask.id.slice(0, 6)} ended in status: failed`)
    })

    it("prints the routing hint regardless of terminal status", async () => {
      makeFeatureBranch("feature-x")
      waitForTaskMock.mockImplementation(async () => "ready")
      const written: string[] = []
      spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        written.push(String(chunk))
        return true
      })

      await runShip(tmpRoot, "feature-x")

      const output = written.join("")
      expect(output).toContain("faber continue")
      expect(output).toContain("faber done")
      expect(output).toContain("faber delete")
    })

    it("does not call updateTask, removeTask, or removeWorktree", async () => {
      makeFeatureBranch("feature-x")
      const written: string[] = []
      spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        written.push(String(chunk))
        return true
      })

      const updateTaskSpy = mock(() => {})
      const removeTaskSpy = mock(() => {})
      const removeWorktreeSpy = mock(async () => {})

      await runShip(tmpRoot, "feature-x")

      expect(updateTaskSpy).not.toHaveBeenCalled()
      expect(removeTaskSpy).not.toHaveBeenCalled()
      expect(removeWorktreeSpy).not.toHaveBeenCalled()
    })
  })

  describe("background mode", () => {
    it("prints 'Task <id> running' and does not wait", async () => {
      makeFeatureBranch("feature-x")

      await runShip(tmpRoot, "feature-x", undefined, undefined, true)

      expect(logLines.some((l) => l.includes(fakeTask.id))).toBe(true)
      expect(waitForTaskMock).not.toHaveBeenCalled()
    })
  })
})
