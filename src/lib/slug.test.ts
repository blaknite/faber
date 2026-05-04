import { describe, expect, it } from "bun:test"
import { generateSlug } from "./slug.js"

describe("generateSlug", () => {
  it("produces a string in the format <hex>-<slug>", () => {
    const slug = generateSlug("fix the login bug")
    expect(slug).toMatch(/^[0-9a-f]{6}-fix-the-login-bug$/)
  })

  it("lowercases the prompt", () => {
    const slug = generateSlug("FIX THE LOGIN BUG")
    expect(slug).toMatch(/^[0-9a-f]{6}-fix-the-login-bug$/)
  })

  it("strips special characters", () => {
    const slug = generateSlug("fix: the (login) bug!")
    // colons, parens, exclamation marks are stripped
    expect(slug).toMatch(/^[0-9a-f]{6}-fix-the-login-bug$/)
  })

  it("collapses multiple spaces into a single hyphen", () => {
    const slug = generateSlug("fix  the   bug")
    expect(slug).toMatch(/^[0-9a-f]{6}-fix-the-bug$/)
  })

  it("truncates long prompts to 40 characters", () => {
    const long = "a".repeat(50)
    const slug = generateSlug(long)
    // prefix is 7 chars (6 hex + hyphen), slug portion should be at most 40
    const slugPart = slug.slice(7)
    expect(slugPart.length).toBeLessThanOrEqual(40)
  })

  it("strips trailing hyphens after truncation", () => {
    // A prompt where truncation would land mid-word leaving trailing hyphens
    // 40 chars of "abc-" repeated: "abc-abc-abc-abc-abc-abc-abc-abc-abc-abc-"
    const prompt = "abc ".repeat(15) // "abc abc abc ..." - spaces become hyphens, truncate at 40
    const slug = generateSlug(prompt)
    const slugPart = slug.slice(7)
    expect(slugPart).not.toMatch(/-$/)
  })

  it("generates a unique prefix each time", () => {
    const slugs = new Set(Array.from({ length: 20 }, () => generateSlug("same prompt").slice(0, 6)))
    // With 6 hex chars (16^6 = 16M possibilities) we'd be astronomically unlucky to get a collision in 20 tries
    expect(slugs.size).toBeGreaterThan(1)
  })

  it("handles an empty prompt gracefully", () => {
    const slug = generateSlug("")
    // Just the hex prefix and a hyphen with nothing after (or just the prefix)
    expect(slug).toMatch(/^[0-9a-f]{6}-?$/)
  })

  it("handles a prompt that is only special characters", () => {
    const slug = generateSlug("!!! @@@")
    // All stripped, nothing left after the prefix
    expect(slug).toMatch(/^[0-9a-f]{6}-?$/)
  })

  it("uses name as suffix when provided", () => {
    const slug = generateSlug("anything", "Fix Login!")
    expect(slug).toMatch(/^[0-9a-f]{6}-fix-login$/)
  })

  it("collapses spaces in name to hyphens", () => {
    const slug = generateSlug("anything", "wip   thing")
    expect(slug).toMatch(/^[0-9a-f]{6}-wip-thing$/)
  })

  it("truncates a long name to 40 characters", () => {
    const slug = generateSlug("anything", "a".repeat(50))
    const slugPart = slug.slice(7)
    expect(slugPart.length).toBeLessThanOrEqual(40)
  })

  it("generates a unique prefix each time when name is provided", () => {
    const slugs = new Set(Array.from({ length: 20 }, () => generateSlug("anything", "same-name").slice(0, 6)))
    expect(slugs.size).toBeGreaterThan(1)
  })

  it("throws when name contains only special characters", () => {
    expect(() => generateSlug("anything", "!!!")).toThrow("--name must contain at least one alphanumeric character.")
  })

  it("throws when name is an empty string", () => {
    expect(() => generateSlug("anything", "")).toThrow("--name must contain at least one alphanumeric character.")
  })
})
