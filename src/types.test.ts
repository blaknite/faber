import { describe, expect, it } from "bun:test"
import { DEFAULT_MODEL, MODELS } from "./types.js"
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
