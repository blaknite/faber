import { describe, expect, it } from "bun:test"
import { DEFAULT_MODELS, DEFAULT_TIER, TIERS, TIER_ORDER, resolveTier } from "./types.js"
import type { Tier } from "./types.js"

describe("TIERS", () => {
  it("each tier has a non-empty label", () => {
    for (const tier of TIER_ORDER) {
      expect(TIERS[tier].label.length).toBeGreaterThan(0)
    }
  })

  it("each tier has a valid hex color and dimColor", () => {
    for (const tier of TIER_ORDER) {
      expect(TIERS[tier].color).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(TIERS[tier].dimColor).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it("each tier has a positive contextWindow", () => {
    for (const tier of TIER_ORDER) {
      expect(TIERS[tier].contextWindow).toBeGreaterThan(0)
    }
  })
})

describe("resolveTier", () => {
  it("matches tier labels case-insensitively", () => {
    expect(resolveTier("smart")).toBe("smart")
    expect(resolveTier("Smart")).toBe("smart")
    expect(resolveTier("SMART")).toBe("smart")
    expect(resolveTier("fast")).toBe("fast")
    expect(resolveTier("Fast")).toBe("fast")
    expect(resolveTier("deep")).toBe("deep")
    expect(resolveTier("Deep")).toBe("deep")
  })

  it("matches default model ID strings", () => {
    expect(resolveTier("anthropic/claude-sonnet-4-6")).toBe("smart")
    expect(resolveTier("anthropic/claude-haiku-4-5")).toBe("fast")
    expect(resolveTier("anthropic/claude-opus-4-6")).toBe("deep")
  })

  it("returns null for unknown values", () => {
    expect(resolveTier("unknown")).toBeNull()
    expect(resolveTier("gpt-4")).toBeNull()
    expect(resolveTier("")).toBeNull()
  })
})

describe("DEFAULT_MODELS", () => {
  it("DEFAULT_MODELS[DEFAULT_TIER] is a string containing '/'", () => {
    const model = DEFAULT_MODELS[DEFAULT_TIER]
    expect(typeof model).toBe("string")
    expect(model).toContain("/")
  })

  it("every tier has a default model", () => {
    for (const tier of TIER_ORDER) {
      expect(typeof DEFAULT_MODELS[tier]).toBe("string")
      expect(DEFAULT_MODELS[tier].length).toBeGreaterThan(0)
    }
  })
})
