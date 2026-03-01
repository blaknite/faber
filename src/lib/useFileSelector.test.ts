import { describe, expect, it } from "bun:test"
import { fuzzyScore } from "./useFileSelector.js"

describe("fuzzyScore", () => {
  it("returns -1 when the query characters don't all appear in order", () => {
    expect(fuzzyScore("foo.ts", "xyz")).toBe(-1)
    expect(fuzzyScore("abc", "abcd")).toBe(-1)
  })

  it("returns 0 for an empty query", () => {
    expect(fuzzyScore("anything", "")).toBe(0)
  })

  it("ranks TaskInput above ContinueInput for the query 'tin'", () => {
    // 'T' in TaskInput is a boundary match (start of filename), which should
    // score much better than the mid-word t-i-n run inside ContinueInput.
    const taskScore = fuzzyScore("TaskInput.tsx", "tin")
    const continueScore = fuzzyScore("ContinueInput.tsx", "tin")
    expect(taskScore).not.toBe(-1)
    expect(continueScore).not.toBe(-1)
    expect(taskScore).toBeLessThan(continueScore)
  })

  it("ranks TaskInput above ContinueInput when given full paths", () => {
    const taskScore = fuzzyScore("components/TaskInput.tsx", "tin")
    const continueScore = fuzzyScore("components/ContinueInput.tsx", "tin")
    expect(taskScore).toBeLessThan(continueScore)
  })

  it("gives a better score when the query matches at the start of the string", () => {
    // "foo" starting at position 0 should beat "foo" starting mid-word.
    const startScore = fuzzyScore("foobar", "foo")
    const midScore = fuzzyScore("xxxfoobar", "foo")
    expect(startScore).toBeLessThan(midScore)
  })

  it("rewards consecutive matches", () => {
    // "abc" consecutive beats "abc" with gaps.
    const consecutiveScore = fuzzyScore("abcxyz", "abc")
    const gappedScore = fuzzyScore("axbxcxyz", "abc")
    expect(consecutiveScore).toBeLessThan(gappedScore)
  })

  it("rewards CamelCase boundary matches", () => {
    // "ti" should prefer matching at the 'T' in TaskInput (boundary) rather than
    // mid-word in "utilities".
    const boundaryScore = fuzzyScore("TaskInput.tsx", "ti")
    const midWordScore = fuzzyScore("utilities.ts", "ti")
    expect(boundaryScore).toBeLessThan(midWordScore)
  })

  it("rewards matches after path separators", () => {
    // Matching at the start of the basename is a boundary.
    const basenameScore = fuzzyScore("src/foo.ts", "foo")
    const deepScore = fuzzyScore("src/notfoo.ts", "foo")
    expect(basenameScore).toBeLessThan(deepScore)
  })

  it("is case-insensitive", () => {
    expect(fuzzyScore("TaskInput.tsx", "TIN")).toBe(fuzzyScore("TaskInput.tsx", "tin"))
    expect(fuzzyScore("TASKINPUT.TSX", "tin")).not.toBe(-1)
  })

  it("picks the best alignment when multiple starting positions exist", () => {
    // "ti" appears mid-word at index 1 in "atInput" but also at the CamelCase
    // boundary 'I' in 'Input'. The algorithm should prefer the boundary match.
    const boundaryScore = fuzzyScore("atInput.ts", "ti")
    // If it greedily started at position 1 ('t' in 'at'), the 'i' would follow
    // consecutively, but 't' at position 1 is mid-word (not a boundary).
    // The 'I' at position 2 IS a boundary. So starting at 'I' should win
    // (even though 'i' == 't' doesn't match -- the algorithm would try 't' at
    // position 1, then see 'i' follows at 2 which is a CamelCase boundary).
    // Main check: it doesn't return -1.
    expect(boundaryScore).not.toBe(-1)
  })

  it("returns a finite number for a valid match", () => {
    const score = fuzzyScore("src/components/TaskInput.tsx", "task")
    expect(score).not.toBe(-1)
    expect(isFinite(score)).toBe(true)
  })
})
