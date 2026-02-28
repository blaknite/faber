import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { readLogEntries } from "./logParser.js"
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
    writeLog("text-task", [
      JSON.stringify({ type: "text", timestamp: 1000, part: { text: "Hello" } }),
    ])
    const entries = readLogEntries(tmpRoot, "text-task")
    expect(entries).toHaveLength(1)
    expect(entries[0]!.kind).toBe("text")
    expect(entries[0]!.text).toBe("Hello")
  })

  it("parses multiple events from JSONL", () => {
    writeLog("multi-task", [
      JSON.stringify({ type: "text", timestamp: 1000, part: { text: "First" } }),
      JSON.stringify({ type: "text", timestamp: 2000, part: { text: "Second" } }),
      JSON.stringify({ type: "tool_use", timestamp: 3000, part: { tool: "bash", state: { input: { command: "ls" }, status: "completed" } } }),
    ])
    const entries = readLogEntries(tmpRoot, "multi-task")
    expect(entries).toHaveLength(3)
    expect(entries[0]!.kind).toBe("text")
    expect(entries[1]!.kind).toBe("text")
    expect(entries[2]!.kind).toBe("tool_use")
  })

  it("skips blank lines", () => {
    writeLog("blank-lines", [
      JSON.stringify({ type: "text", timestamp: 1000, part: { text: "Hello" } }),
      "",
      "  ",
      JSON.stringify({ type: "text", timestamp: 2000, part: { text: "World" } }),
    ])
    const entries = readLogEntries(tmpRoot, "blank-lines")
    expect(entries).toHaveLength(2)
  })

  it("skips lines with invalid JSON", () => {
    writeLog("bad-json", [
      JSON.stringify({ type: "text", timestamp: 1000, part: { text: "Good" } }),
      "this is not json",
      "{broken",
      JSON.stringify({ type: "text", timestamp: 2000, part: { text: "Also good" } }),
    ])
    const entries = readLogEntries(tmpRoot, "bad-json")
    expect(entries).toHaveLength(2)
    expect(entries[0]!.text).toBe("Good")
    expect(entries[1]!.text).toBe("Also good")
  })

  it("skips events with unknown types", () => {
    writeLog("unknown-type", [
      JSON.stringify({ type: "text", timestamp: 1000, part: { text: "Known" } }),
      JSON.stringify({ type: "something_weird", timestamp: 2000 }),
    ])
    const entries = readLogEntries(tmpRoot, "unknown-type")
    expect(entries).toHaveLength(1)
    expect(entries[0]!.text).toBe("Known")
  })

  it("annotates step_finish entries with elapsed time since the previous step", () => {
    writeLog("step-timing", [
      JSON.stringify({ type: "text", timestamp: 1000, part: { text: "Start" } }),
      JSON.stringify({ type: "step_finish", timestamp: 4000, modelID: "anthropic/claude-sonnet-4-6" }),
      JSON.stringify({ type: "text", timestamp: 5000, part: { text: "More work" } }),
      JSON.stringify({ type: "step_finish", timestamp: 8000, modelID: "anthropic/claude-sonnet-4-6" }),
    ])
    const entries = readLogEntries(tmpRoot, "step-timing")
    const steps = entries.filter((e) => e.kind === "step_finish")
    expect(steps).toHaveLength(2)
    // First step: elapsed from the first event (1000) to 4000 = 3000ms
    expect(steps[0]!.elapsedMs).toBe(3000)
    // Second step: elapsed from the first step (4000) to 8000 = 4000ms
    expect(steps[1]!.elapsedMs).toBe(4000)
  })

  it("parses prompt events", () => {
    writeLog("prompt-task", [
      JSON.stringify({ type: "prompt", timestamp: 500, prompt: "Fix the bug", model: "anthropic/claude-sonnet-4-6" }),
    ])
    const entries = readLogEntries(tmpRoot, "prompt-task")
    expect(entries).toHaveLength(1)
    expect(entries[0]!.kind).toBe("prompt")
    expect(entries[0]!.text).toBe("Fix the bug")
    expect(entries[0]!.model).toBe("anthropic/claude-sonnet-4-6")
  })

  it("parses reasoning events", () => {
    writeLog("reasoning-task", [
      JSON.stringify({ type: "reasoning", timestamp: 1000, part: { text: "Let me think..." } }),
    ])
    const entries = readLogEntries(tmpRoot, "reasoning-task")
    expect(entries).toHaveLength(1)
    expect(entries[0]!.kind).toBe("reasoning")
    expect(entries[0]!.reasoningText).toBe("Let me think...")
  })

  it("handles a realistic mixed log", () => {
    writeLog("realistic-task", [
      JSON.stringify({ type: "prompt", timestamp: 100, prompt: "Add tests", model: "anthropic/claude-sonnet-4-6" }),
      JSON.stringify({ type: "text", timestamp: 200, part: { text: "I'll add tests." } }),
      JSON.stringify({ type: "tool_use", timestamp: 300, part: { tool: "read", state: { input: { filePath: "/src/lib/state.ts" }, status: "completed" } } }),
      JSON.stringify({ type: "tool_use", timestamp: 400, part: { tool: "write", state: { input: { filePath: "/src/lib/state.test.ts", content: "test code" }, status: "completed" } } }),
      JSON.stringify({ type: "tool_use", timestamp: 500, part: { tool: "bash", state: { input: { command: "bun test" }, status: "completed", output: "3 pass\n0 fail" } } }),
      JSON.stringify({ type: "step_finish", timestamp: 600, modelID: "anthropic/claude-sonnet-4-6" }),
      JSON.stringify({ type: "text", timestamp: 700, part: { text: "All tests pass." } }),
    ])
    const entries = readLogEntries(tmpRoot, "realistic-task")
    expect(entries).toHaveLength(7)
    expect(entries.map((e) => e.kind)).toEqual([
      "prompt", "text", "tool_use", "tool_use", "tool_use", "step_finish", "text",
    ])
  })
})
