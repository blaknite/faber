import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { readLogEntries } from "./logParser.js"
import { appendEvent } from "./events.js"
import { ensureFaberDir, taskOutputPath } from "./state.js"

let tmpRoot: string

beforeEach(() => {
  tmpRoot = join(tmpdir(), `faber-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpRoot, { recursive: true })
  ensureFaberDir(tmpRoot)
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

function writeLog(taskId: string, lines: string[]) {
  const path = taskOutputPath(tmpRoot, taskId)
  writeFileSync(path, lines.join("\n") + "\n")
}

function appendOpencode(taskId: string, data: Record<string, unknown>, timestamp = 1000) {
  appendEvent(tmpRoot, taskId, { type: "opencode", timestamp, data })
}

describe("readLogEntries", () => {
  it("returns an empty array when the log file does not exist", () => {
    const entries = readLogEntries(tmpRoot, "nonexistent-task")
    expect(entries).toEqual([])
  })

  it("returns an empty array for an empty log file", () => {
    writeLog("empty-task", [""])
    const entries = readLogEntries(tmpRoot, "empty-task")
    expect(entries).toEqual([])
  })

  it("parses text events from JSONL", () => {
    appendOpencode("text-task", { type: "text", timestamp: 1000, part: { text: "Hello" } }, 1000)
    const entries = readLogEntries(tmpRoot, "text-task")
    expect(entries).toHaveLength(1)
    expect(entries[0]!.kind).toBe("text")
    expect(entries[0]!.text).toBe("Hello")
  })

  it("parses multiple events from JSONL", () => {
    appendOpencode("multi-task", { type: "text", timestamp: 1000, part: { text: "First" } }, 1000)
    appendOpencode("multi-task", { type: "text", timestamp: 2000, part: { text: "Second" } }, 2000)
    appendOpencode("multi-task", { type: "tool_use", timestamp: 3000, part: { tool: "bash", state: { input: { command: "ls" }, status: "completed" } } }, 3000)
    const entries = readLogEntries(tmpRoot, "multi-task")
    expect(entries).toHaveLength(3)
    expect(entries[0]!.kind).toBe("text")
    expect(entries[1]!.kind).toBe("text")
    expect(entries[2]!.kind).toBe("tool_use")
  })

  it("skips blank lines", () => {
    appendOpencode("blank-lines", { type: "text", timestamp: 1000, part: { text: "Hello" } }, 1000)
    appendOpencode("blank-lines", { type: "text", timestamp: 2000, part: { text: "World" } }, 2000)
    const entries = readLogEntries(tmpRoot, "blank-lines")
    expect(entries).toHaveLength(2)
  })

  it("skips lines with invalid JSON", () => {
    appendOpencode("bad-json", { type: "text", timestamp: 1000, part: { text: "Good" } }, 1000)
    const path = taskOutputPath(tmpRoot, "bad-json")
    appendFileSync(path, "this is not json\n")
    appendFileSync(path, "{broken\n")
    appendOpencode("bad-json", { type: "text", timestamp: 2000, part: { text: "Also good" } }, 2000)
    const entries = readLogEntries(tmpRoot, "bad-json")
    expect(entries).toHaveLength(2)
    expect(entries[0]!.text).toBe("Good")
    expect(entries[1]!.text).toBe("Also good")
  })

  it("skips events with unknown types", () => {
    appendOpencode("unknown-type", { type: "text", timestamp: 1000, part: { text: "Known" } }, 1000)
    appendOpencode("unknown-type", { type: "something_weird", timestamp: 2000 }, 2000)
    const entries = readLogEntries(tmpRoot, "unknown-type")
    expect(entries).toHaveLength(1)
    expect(entries[0]!.text).toBe("Known")
  })

  it("annotates step_finish entries with elapsed time since the previous step", () => {
    appendOpencode("step-timing", { type: "text", timestamp: 1000, part: { text: "Start" } }, 1000)
    appendOpencode("step-timing", { type: "step_finish", timestamp: 4000, modelID: "anthropic/claude-sonnet-4-6" }, 4000)
    appendOpencode("step-timing", { type: "text", timestamp: 5000, part: { text: "More work" } }, 5000)
    appendOpencode("step-timing", { type: "step_finish", timestamp: 8000, modelID: "anthropic/claude-sonnet-4-6" }, 8000)
    const entries = readLogEntries(tmpRoot, "step-timing")
    const steps = entries.filter((e) => e.kind === "step_finish")
    expect(steps).toHaveLength(2)
    expect(steps[0]!.elapsedMs).toBe(3000)
    expect(steps[1]!.elapsedMs).toBe(4000)
  })

  it("parses prompt events (legacy flat format)", () => {
    writeLog("prompt-task", [
      JSON.stringify({ type: "prompt", timestamp: 500, prompt: "Fix the bug", model: "anthropic/claude-sonnet-4-6" }),
    ])
    const entries = readLogEntries(tmpRoot, "prompt-task")
    expect(entries).toHaveLength(1)
    expect(entries[0]!.kind).toBe("prompt")
    expect(entries[0]!.text).toBe("Fix the bug")
    expect(entries[0]!.model).toBe("anthropic/claude-sonnet-4-6")
  })

  it("parses prompt events (new envelope format)", () => {
    appendEvent(tmpRoot, "prompt-envelope", {
      type: "prompt",
      timestamp: 500,
      data: { prompt: "Fix the bug", model: "anthropic/claude-sonnet-4-6" },
    })
    const entries = readLogEntries(tmpRoot, "prompt-envelope")
    expect(entries).toHaveLength(1)
    expect(entries[0]!.kind).toBe("prompt")
    expect(entries[0]!.text).toBe("Fix the bug")
    expect(entries[0]!.model).toBe("anthropic/claude-sonnet-4-6")
  })

  it("reads legacy opencode-shaped lines (raw event objects without envelope)", () => {
    writeLog("legacy-oc", [
      JSON.stringify({ type: "text", timestamp: 1000, part: { text: "Legacy text" } }),
    ])
    const entries = readLogEntries(tmpRoot, "legacy-oc")
    expect(entries).toHaveLength(1)
    expect(entries[0]!.kind).toBe("text")
    expect(entries[0]!.text).toBe("Legacy text")
  })

  it("parses reasoning events", () => {
    appendOpencode("reasoning-task", { type: "reasoning", timestamp: 1000, part: { text: "Let me think..." } }, 1000)
    const entries = readLogEntries(tmpRoot, "reasoning-task")
    expect(entries).toHaveLength(1)
    expect(entries[0]!.kind).toBe("reasoning")
    expect(entries[0]!.reasoningText).toBe("Let me think...")
  })

  it("handles a realistic mixed log", () => {
    appendEvent(tmpRoot, "realistic-task", {
      type: "prompt",
      timestamp: 100,
      data: { prompt: "Add tests", model: "anthropic/claude-sonnet-4-6" },
    })
    appendOpencode("realistic-task", { type: "text", timestamp: 200, part: { text: "I'll add tests." } }, 200)
    appendOpencode("realistic-task", { type: "tool_use", timestamp: 300, part: { tool: "read", state: { input: { filePath: "/src/lib/state.ts" }, status: "completed" } } }, 300)
    appendOpencode("realistic-task", { type: "tool_use", timestamp: 400, part: { tool: "write", state: { input: { filePath: "/src/lib/state.test.ts", content: "test code" }, status: "completed" } } }, 400)
    appendOpencode("realistic-task", { type: "tool_use", timestamp: 500, part: { tool: "bash", state: { input: { command: "bun test" }, status: "completed", output: "3 pass\n0 fail" } } }, 500)
    appendOpencode("realistic-task", { type: "step_finish", timestamp: 600, modelID: "anthropic/claude-sonnet-4-6" }, 600)
    appendOpencode("realistic-task", { type: "text", timestamp: 700, part: { text: "All tests pass." } }, 700)
    const entries = readLogEntries(tmpRoot, "realistic-task")
    expect(entries).toHaveLength(7)
    expect(entries.map((e) => e.kind)).toEqual([
      "prompt", "text", "tool_use", "tool_use", "tool_use", "step_finish", "text",
    ])
  })
})
