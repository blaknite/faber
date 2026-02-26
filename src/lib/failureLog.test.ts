import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { logTaskFailure } from "./failureLog.js"
import type { FailureEntry } from "./failureLog.js"

let tmpRoot: string

beforeEach(() => {
  tmpRoot = join(tmpdir(), `faber-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpRoot, { recursive: true })
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

function readFailureLog(root: string): FailureEntry[] {
  const path = join(root, ".faber", "failures.log")
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FailureEntry)
}

describe("logTaskFailure", () => {
  it("creates .faber/failures.log if it does not exist", () => {
    logTaskFailure(tmpRoot, {
      taskId: "abc123",
      callSite: "spawnAgent",
      reason: "execa threw",
    })
    expect(existsSync(join(tmpRoot, ".faber", "failures.log"))).toBe(true)
  })

  it("creates the .faber directory if it does not exist", () => {
    logTaskFailure(tmpRoot, {
      taskId: "abc123",
      callSite: "spawnAgent",
      reason: "execa threw",
    })
    expect(existsSync(join(tmpRoot, ".faber"))).toBe(true)
  })

  it("writes a valid JSON line", () => {
    logTaskFailure(tmpRoot, {
      taskId: "abc123",
      callSite: "spawnAgent",
      reason: "process exited with code 1",
      exitCode: 1,
    })

    const entries = readFailureLog(tmpRoot)
    expect(entries).toHaveLength(1)

    const entry = entries[0]!
    expect(entry.taskId).toBe("abc123")
    expect(entry.callSite).toBe("spawnAgent")
    expect(entry.reason).toBe("process exited with code 1")
    expect(entry.exitCode).toBe(1)
    expect(entry.timestamp).toBeTruthy()
  })

  it("appends multiple entries rather than overwriting", () => {
    logTaskFailure(tmpRoot, { taskId: "aaa", callSite: "spawnAgent", reason: "first" })
    logTaskFailure(tmpRoot, { taskId: "bbb", callSite: "killAgent", reason: "second" })

    const entries = readFailureLog(tmpRoot)
    expect(entries).toHaveLength(2)
    expect(entries[0]!.taskId).toBe("aaa")
    expect(entries[1]!.taskId).toBe("bbb")
  })

  it("records the optional error field", () => {
    logTaskFailure(tmpRoot, {
      taskId: "abc123",
      callSite: "spawnAgent",
      reason: "threw",
      error: "ENOENT: no such file or directory",
    })

    const entries = readFailureLog(tmpRoot)
    expect(entries[0]!.error).toBe("ENOENT: no such file or directory")
  })

  it("adds a timestamp to each entry", () => {
    const before = Date.now()
    logTaskFailure(tmpRoot, { taskId: "abc123", callSite: "spawnAgent", reason: "test" })
    const after = Date.now()

    const entries = readFailureLog(tmpRoot)
    const ts = new Date(entries[0]!.timestamp).getTime()
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })
})
