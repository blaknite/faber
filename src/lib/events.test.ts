import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { appendEvent, truncateEvents, readEvents } from "./events.js"
import { ensureFaberDir, taskOutputPath } from "./state.js"

let tmpRoot: string

beforeEach(() => {
  tmpRoot = join(tmpdir(), `faber-events-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpRoot, { recursive: true })
  ensureFaberDir(tmpRoot)
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe("appendEvent", () => {
  it("writes a JSON line in envelope format", () => {
    appendEvent(tmpRoot, "task-1", { type: "opencode", timestamp: 1000, data: { type: "text" } })
    const contents = readFileSync(taskOutputPath(tmpRoot, "task-1"), "utf8")
    const line = JSON.parse(contents.trim())
    expect(line.type).toBe("opencode")
    expect(line.timestamp).toBe(1000)
    expect(line.data).toEqual({ type: "text" })
  })

  it("creates the tasks directory if missing", () => {
    rmSync(join(tmpRoot, ".faber", "tasks"), { recursive: true, force: true })
    appendEvent(tmpRoot, "task-mkdir", { type: "opencode", timestamp: 1000, data: {} })
    const contents = readFileSync(taskOutputPath(tmpRoot, "task-mkdir"), "utf8")
    expect(contents.trim()).not.toBe("")
  })

  it("appends multiple calls as multiple lines", () => {
    appendEvent(tmpRoot, "task-2", { type: "opencode", timestamp: 1000, data: { n: 1 } })
    appendEvent(tmpRoot, "task-2", { type: "opencode", timestamp: 2000, data: { n: 2 } })
    appendEvent(tmpRoot, "task-2", { type: "prompt", timestamp: 3000, data: { prompt: "hi" } })
    const contents = readFileSync(taskOutputPath(tmpRoot, "task-2"), "utf8")
    const lines = contents.trim().split("\n")
    expect(lines).toHaveLength(3)
    expect(JSON.parse(lines[0]!).data.n).toBe(1)
    expect(JSON.parse(lines[1]!).data.n).toBe(2)
    expect(JSON.parse(lines[2]!).type).toBe("prompt")
  })
})

describe("truncateEvents", () => {
  it("empties the file", () => {
    appendEvent(tmpRoot, "task-trunc", { type: "opencode", timestamp: 1000, data: {} })
    truncateEvents(tmpRoot, "task-trunc")
    const contents = readFileSync(taskOutputPath(tmpRoot, "task-trunc"), "utf8")
    expect(contents).toBe("")
  })
})

describe("readEvents", () => {
  it("returns events in order", () => {
    appendEvent(tmpRoot, "task-order", { type: "opencode", timestamp: 100, data: { n: 1 } })
    appendEvent(tmpRoot, "task-order", { type: "prompt", timestamp: 200, data: { prompt: "go" } })
    const events = readEvents(tmpRoot, "task-order")
    expect(events).toHaveLength(2)
    expect(events[0]!.timestamp).toBe(100)
    expect(events[1]!.timestamp).toBe(200)
  })

  it("returns empty array when file does not exist", () => {
    const events = readEvents(tmpRoot, "no-such-task")
    expect(events).toEqual([])
  })

  it("skips unparseable lines silently", () => {
    appendEvent(tmpRoot, "task-bad", { type: "opencode", timestamp: 1000, data: {} })
    const path = taskOutputPath(tmpRoot, "task-bad")
    appendFileSync(path, "not json\n")
    appendEvent(tmpRoot, "task-bad", { type: "opencode", timestamp: 2000, data: {} })
    const events = readEvents(tmpRoot, "task-bad")
    expect(events).toHaveLength(2)
  })

  it("wraps legacy opencode-shaped lines into opencode envelope", () => {
    const path = taskOutputPath(tmpRoot, "task-legacy-oc")
    writeFileSync(path, JSON.stringify({ type: "text", timestamp: 500, part: { text: "hello" } }) + "\n")
    const events = readEvents(tmpRoot, "task-legacy-oc")
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe("opencode")
    expect(events[0]!.timestamp).toBe(500)
    expect((events[0]!.data as any).type).toBe("text")
  })

  it("wraps legacy prompt-shaped lines correctly", () => {
    const path = taskOutputPath(tmpRoot, "task-legacy-prompt")
    writeFileSync(path, JSON.stringify({ type: "prompt", timestamp: 100, prompt: "Fix the bug", model: "gpt-4" }) + "\n")
    const events = readEvents(tmpRoot, "task-legacy-prompt")
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe("prompt")
    expect(events[0]!.timestamp).toBe(100)
    expect(events[0]!.data.prompt).toBe("Fix the bug")
    expect(events[0]!.data.model).toBe("gpt-4")
  })
})
