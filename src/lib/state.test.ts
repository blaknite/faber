import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  acquireLock,
  addTask,
  ensureFaberDir,
  findRepoRoot,
  findTask,
  readState,
  reconcileRunningTasks,
  removeTask,
  stateFilePath,
  taskOutputPath,
  updateTask,
  writeState,
} from "./state.js"
import type { Task } from "../types.js"

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "abc123-test-task",
    prompt: "do the thing",
    model: "anthropic/claude-sonnet-4-6",
    status: "running",
    pid: 12345,
    worktree: ".worktrees/abc123-test-task",
    sessionId: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    exitCode: null,
    hasCommits: false,
    ...overrides,
  }
}

let tmpRoot: string

beforeEach(() => {
  // Each test gets its own temp directory so they don't interfere with each other
  tmpRoot = join(tmpdir(), `faber-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpRoot, { recursive: true })
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe("ensureFaberDir", () => {
  it("creates the .faber directory", () => {
    ensureFaberDir(tmpRoot)
    expect(existsSync(join(tmpRoot, ".faber"))).toBe(true)
  })

  it("creates the .faber/tasks subdirectory", () => {
    ensureFaberDir(tmpRoot)
    expect(existsSync(join(tmpRoot, ".faber", "tasks"))).toBe(true)
  })

  it("creates state.json with an empty task list", () => {
    ensureFaberDir(tmpRoot)
    const raw = readFileSync(join(tmpRoot, ".faber", "state.json"), "utf8")
    expect(JSON.parse(raw)).toEqual({ tasks: [] })
  })

  it("is idempotent -- calling it twice does not throw", () => {
    ensureFaberDir(tmpRoot)
    expect(() => ensureFaberDir(tmpRoot)).not.toThrow()
  })

  it("does not overwrite an existing state.json", () => {
    ensureFaberDir(tmpRoot)
    const task = makeTask()
    writeState(tmpRoot, { tasks: [task] })

    // Calling ensureFaberDir again should not reset state
    ensureFaberDir(tmpRoot)
    const state = readState(tmpRoot)
    expect(state.tasks).toHaveLength(1)
  })
})

describe("readState / writeState", () => {
  beforeEach(() => ensureFaberDir(tmpRoot))

  it("reads back what was written", () => {
    const task = makeTask()
    writeState(tmpRoot, { tasks: [task] })
    const state = readState(tmpRoot)
    expect(state.tasks).toHaveLength(1)
    expect(state.tasks[0]!.id).toBe(task.id)
  })

  it("returns an empty state when the file does not exist", () => {
    // Remove the state file
    rmSync(join(tmpRoot, ".faber", "state.json"))
    const state = readState(tmpRoot)
    expect(state).toEqual({ tasks: [] })
  })

  it("returns an empty state when the file contains invalid JSON", () => {
    writeFileSync(join(tmpRoot, ".faber", "state.json"), "not json")
    const state = readState(tmpRoot)
    expect(state).toEqual({ tasks: [] })
  })

  it("normalises legacy 'unknown' status to 'failed' on read", () => {
    const raw = JSON.stringify({
      tasks: [{ ...makeTask({ id: "legacy-unknown" }), status: "unknown" }],
    })
    writeFileSync(join(tmpRoot, ".faber", "state.json"), raw)
    const state = readState(tmpRoot)
    expect(state.tasks[0]!.status).toBe("failed")
  })

  it("normalised 'unknown' stays 'failed' after a round-trip write", () => {
    const raw = JSON.stringify({
      tasks: [{ ...makeTask({ id: "legacy-unknown" }), status: "unknown" }],
    })
    writeFileSync(join(tmpRoot, ".faber", "state.json"), raw)
    const first = readState(tmpRoot)
    writeState(tmpRoot, first)
    const second = readState(tmpRoot)
    expect(second.tasks[0]!.status).toBe("failed")
  })
})

describe("taskOutputPath", () => {
  it("returns the correct path", () => {
    const path = taskOutputPath("/repo", "abc123-my-task")
    expect(path).toBe("/repo/.faber/tasks/abc123-my-task.jsonl")
  })
})

describe("addTask", () => {
  beforeEach(() => ensureFaberDir(tmpRoot))

  it("adds a task to state", () => {
    const task = makeTask()
    addTask(tmpRoot, task)
    const { tasks } = readState(tmpRoot)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.id).toBe(task.id)
  })

  it("appends to existing tasks", () => {
    addTask(tmpRoot, makeTask({ id: "aaa-first" }))
    addTask(tmpRoot, makeTask({ id: "bbb-second" }))
    const { tasks } = readState(tmpRoot)
    expect(tasks).toHaveLength(2)
    expect(tasks.map((t) => t.id)).toEqual(["aaa-first", "bbb-second"])
  })
})

describe("updateTask", () => {
  beforeEach(() => ensureFaberDir(tmpRoot))

  it("patches the matching task", () => {
    const task = makeTask()
    addTask(tmpRoot, task)
    updateTask(tmpRoot, task.id, { status: "done", exitCode: 0 })
    const { tasks } = readState(tmpRoot)
    expect(tasks[0]!.status).toBe("done")
    expect(tasks[0]!.exitCode).toBe(0)
  })

  it("does nothing when the id does not match", () => {
    const task = makeTask()
    addTask(tmpRoot, task)
    updateTask(tmpRoot, "nonexistent-id", { status: "done" })
    const { tasks } = readState(tmpRoot)
    expect(tasks[0]!.status).toBe("running")
  })

  it("leaves other tasks untouched", () => {
    addTask(tmpRoot, makeTask({ id: "aaa-one" }))
    addTask(tmpRoot, makeTask({ id: "bbb-two" }))
    updateTask(tmpRoot, "aaa-one", { status: "done" })
    const { tasks } = readState(tmpRoot)
    expect(tasks.find((t) => t.id === "bbb-two")!.status).toBe("running")
  })
})

describe("removeTask", () => {
  beforeEach(() => ensureFaberDir(tmpRoot))

  it("removes the matching task", () => {
    const task = makeTask()
    addTask(tmpRoot, task)
    removeTask(tmpRoot, task.id)
    const { tasks } = readState(tmpRoot)
    expect(tasks).toHaveLength(0)
  })

  it("removes the task's log file if it exists", () => {
    const task = makeTask()
    addTask(tmpRoot, task)

    const logPath = taskOutputPath(tmpRoot, task.id)
    writeFileSync(logPath, '{"type":"text"}\n')
    expect(existsSync(logPath)).toBe(true)

    removeTask(tmpRoot, task.id)
    expect(existsSync(logPath)).toBe(false)
  })

  it("does not throw when the log file does not exist", () => {
    const task = makeTask()
    addTask(tmpRoot, task)
    expect(() => removeTask(tmpRoot, task.id)).not.toThrow()
  })

  it("leaves other tasks in place", () => {
    addTask(tmpRoot, makeTask({ id: "aaa-keep" }))
    addTask(tmpRoot, makeTask({ id: "bbb-remove" }))
    removeTask(tmpRoot, "bbb-remove")
    const { tasks } = readState(tmpRoot)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.id).toBe("aaa-keep")
  })
})

describe("findRepoRoot", () => {
  it("finds the root when starting directly inside a .faber directory's parent", () => {
    ensureFaberDir(tmpRoot)
    const found = findRepoRoot(tmpRoot)
    expect(found).toBe(tmpRoot)
  })

  it("finds the root when starting in a subdirectory", () => {
    ensureFaberDir(tmpRoot)
    const subDir = join(tmpRoot, "src", "lib")
    mkdirSync(subDir, { recursive: true })
    const found = findRepoRoot(subDir)
    expect(found).toBe(tmpRoot)
  })

  it("returns null when no .faber/state.json exists anywhere up the tree", () => {
    // tmpRoot has no .faber directory
    const found = findRepoRoot(tmpRoot)
    expect(found).toBeNull()
  })
})

describe("reconcileRunningTasks", () => {
  beforeEach(() => ensureFaberDir(tmpRoot))

  it("marks tasks with dead PIDs as failed", () => {
    // PID 1 always exists (init), so use a surely-dead PID instead.
    // We pick a very high PID that is very unlikely to be running.
    // A cleaner approach is to spawn a process, capture its PID, let it exit, then check.
    const { pid: selfPid } = process
    // Use the current process PID for the alive case and a dead PID otherwise.
    // We'll spy on process.kill to control liveness.
    const killSpy = spyOn(process, "kill").mockImplementation((pid: number, signal?: number | NodeJS.Signals) => {
      if (pid === 99999) throw new Error("ESRCH")
      // Default: do nothing (simulates "process alive")
      return true
    })

    try {
      addTask(tmpRoot, makeTask({ id: "aaa-alive", pid: selfPid, status: "running" }))
      addTask(tmpRoot, makeTask({ id: "bbb-dead", pid: 99999, status: "running" }))

      reconcileRunningTasks(tmpRoot)

      const { tasks } = readState(tmpRoot)
      const alive = tasks.find((t) => t.id === "aaa-alive")!
      const dead = tasks.find((t) => t.id === "bbb-dead")!

      expect(alive.status).toBe("running")
      expect(dead.status).toBe("failed")
      expect(dead.pid).toBeNull()
      expect(dead.completedAt).not.toBeNull()
    } finally {
      killSpy.mockRestore()
    }
  })

  it("does not touch tasks that are already done", () => {
    addTask(tmpRoot, makeTask({ id: "aaa-done", pid: null, status: "done", completedAt: new Date().toISOString() }))
    reconcileRunningTasks(tmpRoot)
    const { tasks } = readState(tmpRoot)
    expect(tasks[0]!.status).toBe("done")
  })
})

describe("stateFilePath", () => {
  it("returns the path to .faber/state.json", () => {
    expect(stateFilePath("/repo")).toBe("/repo/.faber/state.json")
  })

  it("handles trailing slashes via join", () => {
    expect(stateFilePath("/repo/")).toBe("/repo/.faber/state.json")
  })
})

describe("findTask", () => {
  it("returns the task on exact match", () => {
    const task = makeTask({ id: "a3f2-fix-login" })
    const result = findTask([task], "a3f2-fix-login")
    expect(result).toBe(task)
  })

  it("prefers exact match over prefix match", () => {
    const exact = makeTask({ id: "a3" })
    const prefix = makeTask({ id: "a3f2-fix-login" })
    const result = findTask([exact, prefix], "a3")
    expect(result).toBe(exact)
  })

  it("returns the task on prefix match", () => {
    const task = makeTask({ id: "a3f2-fix-login" })
    const result = findTask([task], "a3f2")
    expect(result).toBe(task)
  })

  it("returns null when no task matches", () => {
    const task = makeTask({ id: "a3f2-fix-login" })
    const result = findTask([task], "xyz")
    expect(result).toBeNull()
  })

  it("returns null on empty task list", () => {
    expect(findTask([], "a3f2")).toBeNull()
  })

  it("throws when multiple tasks match the prefix", () => {
    const tasks = [
      makeTask({ id: "a3f2-fix-login" }),
      makeTask({ id: "a3b1-add-tests" }),
    ]
    expect(() => findTask(tasks, "a3")).toThrow('Multiple tasks match "a3": a3f2-fix-login, a3b1-add-tests')
  })
})

describe("acquireLock", () => {
  it("returns a release function", async () => {
    ensureFaberDir(tmpRoot)
    const release = await acquireLock(tmpRoot)
    expect(typeof release).toBe("function")
    await release()
  })

  it("throws when a second lock is attempted on the same repo", async () => {
    ensureFaberDir(tmpRoot)
    const release = await acquireLock(tmpRoot)
    try {
      await expect(acquireLock(tmpRoot)).rejects.toThrow("already running")
    } finally {
      await release()
    }
  })

  it("allows re-locking after the first lock is released", async () => {
    ensureFaberDir(tmpRoot)
    const first = await acquireLock(tmpRoot)
    await first()
    const second = await acquireLock(tmpRoot)
    await second()
  })
})
