import { describe, expect, it } from "bun:test"
import { sumRoundElapsed, shouldShowStepFinish } from "./AgentLog.js"
import type { LogEntry } from "../lib/logParser.js"

function makeEntry(kind: LogEntry["kind"], elapsedMs?: number): LogEntry {
  return { kind, elapsedMs } as LogEntry
}

// --- sumRoundElapsed ---

describe("sumRoundElapsed", () => {
  it("sums all step_finish elapsedMs in a single round", () => {
    const entries: LogEntry[] = [
      makeEntry("step_finish", 100),
      makeEntry("step_finish", 200),
      makeEntry("step_finish", 300),
    ]
    expect(sumRoundElapsed(entries, 2)).toBe(600)
  })

  it("stops at a prompt boundary in a multi-round log", () => {
    const entries: LogEntry[] = [
      makeEntry("step_finish", 500), // round 1
      makeEntry("prompt"),
      makeEntry("step_finish", 100), // round 2
      makeEntry("step_finish", 200), // round 2
    ]
    // boundary at index 3 — should only sum round 2
    expect(sumRoundElapsed(entries, 3)).toBe(300)
  })

  it("returns 0 when there are no step_finish entries in the round", () => {
    const entries: LogEntry[] = [
      makeEntry("text"),
      makeEntry("tool_use"),
    ]
    expect(sumRoundElapsed(entries, 1)).toBe(0)
  })

  it("returns the single entry's elapsedMs for a single step_finish", () => {
    const entries: LogEntry[] = [
      makeEntry("step_finish", 750),
    ]
    expect(sumRoundElapsed(entries, 0)).toBe(750)
  })
})

// --- shouldShowStepFinish ---

describe("shouldShowStepFinish", () => {
  it("returns true for the last step_finish before a prompt", () => {
    const entries: LogEntry[] = [
      makeEntry("step_finish", 100),
      makeEntry("prompt"),
    ]
    expect(shouldShowStepFinish(entries, 0, false)).toBe(true)
  })

  it("returns true for the last step_finish at end of entries when task is not running", () => {
    const entries: LogEntry[] = [
      makeEntry("step_finish", 100),
    ]
    expect(shouldShowStepFinish(entries, 0, false)).toBe(true)
  })

  it("returns false for the last step_finish at end of entries when task is still running", () => {
    const entries: LogEntry[] = [
      makeEntry("step_finish", 100),
    ]
    expect(shouldShowStepFinish(entries, 0, true)).toBe(false)
  })

  it("returns false for a step_finish followed by another step_finish in the same round", () => {
    const entries: LogEntry[] = [
      makeEntry("step_finish", 100),
      makeEntry("step_finish", 200),
    ]
    expect(shouldShowStepFinish(entries, 0, false)).toBe(false)
  })

  it("returns true for a step_finish followed by text/tool entries then a prompt with no later step_finish", () => {
    const entries: LogEntry[] = [
      makeEntry("step_finish", 100),
      makeEntry("text"),
      makeEntry("tool_use"),
      makeEntry("prompt"),
    ]
    expect(shouldShowStepFinish(entries, 0, false)).toBe(true)
  })
})
