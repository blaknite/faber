import { describe, expect, it } from "bun:test"
import { tierForModel, modelForTier, cleanroomEnabled } from "./config.js"
import { DEFAULT_MODELS } from "../types.js"

describe("tierForModel", () => {
  it("returns the tier for a default model ID with empty config", () => {
    expect(tierForModel("anthropic/claude-haiku-4-5", {})).toBe("fast")
    expect(tierForModel("anthropic/claude-sonnet-4-6", {})).toBe("smart")
    expect(tierForModel("anthropic/claude-opus-4-6", {})).toBe("deep")
  })

  it("returns the configured tier when the config overrides a tier with a custom model ID", () => {
    const config = { models: { smart: "lmstudio/unsloth/qwen3.5-9b" } }
    expect(tierForModel("lmstudio/unsloth/qwen3.5-9b", config)).toBe("smart")
  })

  it("returns null for an unknown model ID", () => {
    expect(tierForModel("openai/gpt-4o", {})).toBeNull()
    expect(tierForModel("openai/gpt-4o", { models: { smart: "lmstudio/foo" } })).toBeNull()
  })

  it("with two tiers pointing to the same custom model, returns the first-iterated tier", () => {
    const config = {
      models: {
        fast: "lmstudio/unsloth/qwen3.5-9b",
        smart: "lmstudio/unsloth/qwen3.5-9b",
      },
    }
    expect(tierForModel("lmstudio/unsloth/qwen3.5-9b", config)).toBe("fast")
  })
})

describe("modelForTier", () => {
  it("returns DEFAULT_MODELS[tier] when config is empty", () => {
    expect(modelForTier("fast", {})).toBe(DEFAULT_MODELS.fast)
    expect(modelForTier("smart", {})).toBe(DEFAULT_MODELS.smart)
    expect(modelForTier("deep", {})).toBe(DEFAULT_MODELS.deep)
  })

  it("returns the config override when set", () => {
    const config = { models: { deep: "anthropic/claude-opus-4-7" } }
    expect(modelForTier("deep", config)).toBe("anthropic/claude-opus-4-7")
    expect(modelForTier("smart", config)).toBe(DEFAULT_MODELS.smart)
  })
})

describe("cleanroomEnabled", () => {
  it("returns false when config is empty", () => {
    expect(cleanroomEnabled({})).toBe(false)
  })

  it("returns false when cleanroom is not set", () => {
    expect(cleanroomEnabled({ models: { smart: "anthropic/claude-sonnet-4-6" } })).toBe(false)
  })

  it("returns true when cleanroom is true", () => {
    expect(cleanroomEnabled({ cleanroom: true })).toBe(true)
  })

  it("returns false when cleanroom is false", () => {
    expect(cleanroomEnabled({ cleanroom: false })).toBe(false)
  })
})
