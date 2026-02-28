import { describe, expect, it } from "bun:test"
import { KEY_BINDINGS, MIN_LINES, MAX_LINES } from "./textarea.js"

describe("KEY_BINDINGS", () => {
  it("is a non-empty array", () => {
    expect(KEY_BINDINGS.length).toBeGreaterThan(0)
  })

  it("has a submit binding for plain return", () => {
    const submit = KEY_BINDINGS.find((b) => b.name === "return" && b.action === "submit")
    expect(submit).toBeDefined()
    // The submit binding should not have modifiers
    expect((submit as any).shift).toBeUndefined()
    expect((submit as any).ctrl).toBeUndefined()
    expect((submit as any).meta).toBeUndefined()
  })

  it("has newline bindings with modifier keys", () => {
    const newlines = KEY_BINDINGS.filter((b) => b.action === "newline")
    expect(newlines.length).toBeGreaterThan(0)
    // At least one should have shift, ctrl, or meta
    const hasModifier = newlines.some(
      (b) => (b as any).shift || (b as any).ctrl || (b as any).meta
    )
    expect(hasModifier).toBe(true)
  })

  it("every binding has an action of submit or newline", () => {
    for (const binding of KEY_BINDINGS) {
      expect(["submit", "newline"]).toContain(binding.action)
    }
  })
})

describe("MIN_LINES / MAX_LINES", () => {
  it("MIN_LINES is at least 1", () => {
    expect(MIN_LINES).toBeGreaterThanOrEqual(1)
  })

  it("MAX_LINES is greater than MIN_LINES", () => {
    expect(MAX_LINES).toBeGreaterThan(MIN_LINES)
  })
})
