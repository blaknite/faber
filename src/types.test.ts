import { describe, expect, it } from "bun:test"
import { DEFAULT_MODEL, MODELS, resolveModel } from "./types.js"
import type { Model } from "./types.js"

describe("MODELS", () => {
  it("contains at least one model", () => {
    expect(MODELS.length).toBeGreaterThan(0)
  })

  it("has unique values across all models", () => {
    const values = MODELS.map((m) => m.value)
    expect(new Set(values).size).toBe(values.length)
  })

  it("has unique labels across all models", () => {
    const labels = MODELS.map((m) => m.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it("each model has a non-empty label", () => {
    for (const model of MODELS) {
      expect(model.label.length).toBeGreaterThan(0)
    }
  })

  it("each model has a valid hex color and dimColor", () => {
    for (const model of MODELS) {
      expect(model.color).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(model.dimColor).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it("each model value follows the provider/model-name pattern", () => {
    for (const model of MODELS) {
      expect(model.value).toContain("/")
    }
  })
})

describe("resolveModel", () => {
  it("matches labels case-insensitively", () => {
    expect(resolveModel("smart")).toBe("anthropic/claude-sonnet-4-6")
    expect(resolveModel("Smart")).toBe("anthropic/claude-sonnet-4-6")
    expect(resolveModel("SMART")).toBe("anthropic/claude-sonnet-4-6")
    expect(resolveModel("fast")).toBe("anthropic/claude-haiku-4-5")
    expect(resolveModel("Fast")).toBe("anthropic/claude-haiku-4-5")
    expect(resolveModel("deep")).toBe("anthropic/claude-opus-4-6")
    expect(resolveModel("Deep")).toBe("anthropic/claude-opus-4-6")
  })

  it("matches literal model ID strings", () => {
    expect(resolveModel("anthropic/claude-sonnet-4-6")).toBe("anthropic/claude-sonnet-4-6")
    expect(resolveModel("anthropic/claude-haiku-4-5")).toBe("anthropic/claude-haiku-4-5")
    expect(resolveModel("anthropic/claude-opus-4-6")).toBe("anthropic/claude-opus-4-6")
  })

  it("returns null for unknown values", () => {
    expect(resolveModel("unknown")).toBeNull()
    expect(resolveModel("gpt-4")).toBeNull()
    expect(resolveModel("")).toBeNull()
  })
})

describe("DEFAULT_MODEL", () => {
  it("is one of the models in the MODELS array", () => {
    const values = MODELS.map((m) => m.value)
    expect(values).toContain(DEFAULT_MODEL)
  })

  it("is a valid Model type value", () => {
    // Just checking it's a non-empty string with the provider/name format
    expect(DEFAULT_MODEL.length).toBeGreaterThan(0)
    expect(DEFAULT_MODEL).toContain("/")
  })
})
