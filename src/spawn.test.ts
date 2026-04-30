import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execSync } from "node:child_process"
import { ensureFaberDir, readState, addTask, taskOutputPath } from "./lib/state.js"
import { runSpawn } from "./spawn.js"
import type { Task } from "./types.js"

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "abc123-spawn-test",
    prompt: "do the thing",
    model: "anthropic/claude-sonnet-4-6",
    status: "running",
    pid: null,
    worktree: ".worktrees/abc123-spawn-test",
    sessionId: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    exitCode: null,
    hasCommits: false,
    baseBranch: "main",
    ...overrides,
  }
}

let tmpRoot: string

function git(args: string, cwd?: string) {
  execSync(`git ${args}`, { cwd: cwd ?? tmpRoot, stdio: "pipe" })
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "faber-spawn-test-"))
  ensureFaberDir(tmpRoot)
  git("init -b main")
  git("config user.email test@test.com")
  git("config user.name Test")
  writeFileSync(join(tmpRoot, "README.md"), "# test\n")
  git("add .")
  git('commit -m "initial commit"')
  mkdirSync(join(tmpRoot, ".worktrees", "abc123-spawn-test"), { recursive: true })
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe("runSpawn", () => {
  it("exit 0 sets status to ready", async () => {
    const task = makeTask()
    addTask(tmpRoot, task)

    const script = `printf '{"sessionID":"ses-abc"}\\n'; exit 0`
    const result = await runSpawn(tmpRoot, task.id, ["sh", "-c", script])

    expect(result).toBe(0)

    const state = readState(tmpRoot)
    const updated = state.tasks.find((t) => t.id === task.id)!
    expect(updated.status).toBe("ready")
    expect(updated.exitCode).toBe(0)
    expect(updated.pid).toBeNull()
    expect(updated.completedAt).not.toBeNull()
    expect(updated.sessionId).toBe("ses-abc")

    const outputPath = taskOutputPath(tmpRoot, task.id)
    expect(existsSync(outputPath)).toBe(true)
    const contents = readFileSync(outputPath, "utf8")
    expect(contents).toContain('"sessionID":"ses-abc"')
  })

  it("exit 1 sets status to failed", async () => {
    const task = makeTask()
    addTask(tmpRoot, task)

    const script = `printf 'not json\\n'; exit 1`
    const result = await runSpawn(tmpRoot, task.id, ["sh", "-c", script])

    expect(result).toBe(1)

    const state = readState(tmpRoot)
    const updated = state.tasks.find((t) => t.id === task.id)!
    expect(updated.status).toBe("failed")
    expect(updated.exitCode).toBe(1)
    expect(updated.pid).toBeNull()
    expect(updated.completedAt).not.toBeNull()

    const failureLogPath = join(tmpRoot, ".faber", "failures.log")
    expect(existsSync(failureLogPath)).toBe(true)
    const logContents = readFileSync(failureLogPath, "utf8")
    const entry = JSON.parse(logContents.trim().split("\n")[0]!)
    expect(entry.taskId).toBe(task.id)
  })

  it("pre-set status stopped is preserved on exit 0", async () => {
    const task = makeTask({ status: "stopped" })
    addTask(tmpRoot, task)

    const script = `exit 0`
    const result = await runSpawn(tmpRoot, task.id, ["sh", "-c", script])

    expect(result).toBe(0)

    const state = readState(tmpRoot)
    const updated = state.tasks.find((t) => t.id === task.id)!
    expect(updated.status).toBe("stopped")
    expect(updated.exitCode).toBe(0)
    expect(updated.pid).toBeNull()
    expect(updated.completedAt).not.toBeNull()

    const failureLogPath = join(tmpRoot, ".faber", "failures.log")
    expect(existsSync(failureLogPath)).toBe(false)
  })

  it("pre-set status failed is preserved on exit 2", async () => {
    const task = makeTask({ status: "failed" })
    addTask(tmpRoot, task)

    const script = `exit 2`
    const result = await runSpawn(tmpRoot, task.id, ["sh", "-c", script])

    expect(result).toBe(2)

    const state = readState(tmpRoot)
    const updated = state.tasks.find((t) => t.id === task.id)!
    expect(updated.status).toBe("failed")
    expect(updated.exitCode).toBe(2)
    expect(updated.pid).toBeNull()
  })

  it("sessionID emitted mid-stream is captured and both lines appear in JSONL", async () => {
    const task = makeTask()
    addTask(tmpRoot, task)

    const script = `printf '{"sessionID":"ses-xyz"}\\n{"type":"text"}\\n'; exit 0`
    await runSpawn(tmpRoot, task.id, ["sh", "-c", script])

    const state = readState(tmpRoot)
    const updated = state.tasks.find((t) => t.id === task.id)!
    expect(updated.sessionId).toBe("ses-xyz")

    const outputPath = taskOutputPath(tmpRoot, task.id)
    const contents = readFileSync(outputPath, "utf8")
    const lines = contents.trim().split("\n")
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('"sessionID":"ses-xyz"')
    expect(lines[1]).toContain('"type":"text"')
  })
})
