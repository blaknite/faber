import { describe, expect, it } from "bun:test"
import { STATUS_COLOR, STATUS_LABEL, STATUS_SYMBOL } from "./status.js"
import type { TaskStatus } from "../types.js"

const ALL_STATUSES: TaskStatus[] = ["running", "done", "ready", "failed", "stopped"]

describe("STATUS_COLOR", () => {
  it("has an entry for every TaskStatus", () => {
    for (const status of ALL_STATUSES) {
      expect(STATUS_COLOR[status]).toBeDefined()
    }
  })

  it("returns valid hex color strings", () => {
    for (const status of ALL_STATUSES) {
      expect(STATUS_COLOR[status]).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it("has no extra keys beyond the known statuses", () => {
    expect(Object.keys(STATUS_COLOR).sort()).toEqual([...ALL_STATUSES].sort())
  })
})

describe("STATUS_LABEL", () => {
  it("has an entry for every TaskStatus", () => {
    for (const status of ALL_STATUSES) {
      expect(STATUS_LABEL[status]).toBeDefined()
    }
  })

  it("returns capitalized human-readable labels", () => {
    for (const status of ALL_STATUSES) {
      const label = STATUS_LABEL[status]!
      expect(label.length).toBeGreaterThan(0)
      // First character should be uppercase
      expect(label[0]).toBe(label[0]!.toUpperCase())
    }
  })

  it("has no extra keys beyond the known statuses", () => {
    expect(Object.keys(STATUS_LABEL).sort()).toEqual([...ALL_STATUSES].sort())
  })
})

describe("STATUS_SYMBOL", () => {
  it("has an entry for every TaskStatus", () => {
    for (const status of ALL_STATUSES) {
      expect(STATUS_SYMBOL[status]).toBeDefined()
    }
  })

  it("returns non-empty strings", () => {
    for (const status of ALL_STATUSES) {
      expect(STATUS_SYMBOL[status]!.length).toBeGreaterThan(0)
    }
  })

  it("has no extra keys beyond the known statuses", () => {
    expect(Object.keys(STATUS_SYMBOL).sort()).toEqual([...ALL_STATUSES].sort())
  })

  it("uses distinct symbols for terminal statuses", () => {
    const terminalStatuses: TaskStatus[] = ["done", "ready", "failed", "stopped"]
    const symbols = terminalStatuses.map((s) => STATUS_SYMBOL[s])
    const unique = new Set(symbols)
    expect(unique.size).toBe(terminalStatuses.length)
  })
})
