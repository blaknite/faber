import { describe, expect, it } from "bun:test"
import { tierForModel, modelForTier } from "./config.js"
import { DEFAULT_MODELS } from "../types.js"

describe("tierForModel", () => {
  it("returns the tier for a default model ID with empty config", () => {
    expect(tierForModel("anthropic/claude-haiku-4-5", {})).toBe("fast")
    expect(tierForModel("anthropic/claude-sonnet-4-6", {})).toBe("smart")
    expect(tierForModel("anthropic/claude-opus-4-6", {})).toBe("deep")
  })

  it("returns the configured tier when the config overrides a tier with a custom model ID", () => {
    const config = { smart: "lmstudio/unsloth/qwen3.5-9b" }
    expect(tierForModel("lmstudio/unsloth/qwen3.5-9b", config)).toBe("smart")
  })

  it("returns null for an unknown model ID", () => {
    expect(tierForModel("openai/gpt-4o", {})).toBeNull()
    expect(tierForModel("openai/gpt-4o", { smart: "lmstudio/foo" })).toBeNull()
  })

  it("with two tiers pointing to the same custom model, returns the first-iterated tier", () => {
    const config = {
      fast: "lmstudio/unsloth/qwen3.5-9b",
      smart: "lmstudio/unsloth/qwen3.5-9b",
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
    const config = { deep: "anthropic/claude-opus-4-7" }
    expect(modelForTier("deep", config)).toBe("anthropic/claude-opus-4-7")
    expect(modelForTier("smart", config)).toBe(DEFAULT_MODELS.smart)
  })
})
