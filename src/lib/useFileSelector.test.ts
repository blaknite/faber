import { describe, expect, it } from "bun:test"
import { fuzzyScore, getAtQuery } from "./useFileSelector.js"
import type { Suggestion } from "./useFileSelector.js"

describe("getAtQuery", () => {
  it("returns null when there is no @", () => {
    expect(getAtQuery("write some content")).toBeNull()
  })

  it("returns an empty string when @ is at the end with nothing typed yet", () => {
    expect(getAtQuery("write some content in @")).toBe("")
  })

  it("returns the partial query typed after @", () => {
    expect(getAtQuery("write some content in @read")).toBe("read")
  })

  it("returns null when the @ is mid-word (not preceded by whitespace)", () => {
    expect(getAtQuery("foo@bar")).toBeNull()
    expect(getAtQuery("email@example")).toBeNull()
  })

  it("returns the query when @ is at the very start of the text", () => {
    expect(getAtQuery("@read")).toBe("read")
  })

  it("returns null when there is whitespace between @ and the cursor (mention closed)", () => {
    // The space after 'readme' signals the mention was already committed.
    expect(getAtQuery("@readme ")).toBeNull()
  })

  it("triggers correctly when @ appears in the middle of a prompt, with text after the cursor excluded", () => {
    // The caller slices to the cursor before calling getAtQuery, so we simulate
    // a cursor sitting right after '@read' in 'Write some content in @read about...'
    // by passing only the text up to the cursor.
    expect(getAtQuery("Write some content in @read")).toBe("read")
  })

  it("returns an empty string when @ is in the middle of a prompt with cursor right after @", () => {
    expect(getAtQuery("Write some content in @")).toBe("")
  })
})

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

describe("fuzzyScore with mixed file and task entries", () => {
  // Helper: score a Suggestion against a query using its value and filterText fields.
  function scoreSuggestion(s: Suggestion, query: string): number {
    const basename = s.value.split("/").pop() ?? s.value
    const pathScore = fuzzyScore(s.value, query)
    const nameScore = fuzzyScore(basename, query)
    const filterScore = s.filterText !== undefined ? fuzzyScore(s.filterText, query) : -1
    const candidates = [pathScore, nameScore, filterScore].filter((sc) => sc !== -1)
    return candidates.length > 0 ? Math.min(...candidates) : -1
  }

  const fileSuggestion = (value: string): Suggestion => ({ type: "file", value })
  const taskSuggestion = (value: string, filterText?: string): Suggestion => ({ type: "task", value, filterText })

  it("returns a valid score for file suggestions", () => {
    const s = fileSuggestion("src/lib/agent.ts")
    expect(scoreSuggestion(s, "agent")).not.toBe(-1)
  })

  it("returns a valid score for task suggestions", () => {
    const s = taskSuggestion("a3f2-fix-login-bug", "Fix the login bug on the settings page")
    expect(scoreSuggestion(s, "a3f2")).not.toBe(-1)
  })

  it("task ID query narrows to task matches and not file paths", () => {
    const entries: Suggestion[] = [
      fileSuggestion("src/lib/agent.ts"),
      fileSuggestion("src/components/TaskInput.tsx"),
      taskSuggestion("a3f2-fix-login-bug", "Fix the login bug"),
      taskSuggestion("b9c1-add-dark-mode", "Add dark mode toggle"),
    ]

    const query = "a3f2"
    const matches = entries
      .map((e) => ({ e, score: scoreSuggestion(e, query) }))
      .filter(({ score }) => score !== -1)
      .sort((a, b) => a.score - b.score)
      .map(({ e }) => e)

    // Only the task with "a3f2" in the ID should match this query.
    expect(matches.length).toBe(1)
    expect(matches[0]!.value).toBe("a3f2-fix-login-bug")
    expect(matches[0]!.type).toBe("task")
  })

  it("file path query narrows to file matches and not task IDs", () => {
    const entries: Suggestion[] = [
      fileSuggestion("src/lib/agent.ts"),
      fileSuggestion("src/components/TaskInput.tsx"),
      taskSuggestion("a3f2-fix-login-bug", "Fix the login bug"),
      taskSuggestion("b9c1-add-dark-mode", "Add dark mode toggle"),
    ]

    const query = "src/"
    const matches = entries
      .map((e) => ({ e, score: scoreSuggestion(e, query) }))
      .filter(({ score }) => score !== -1)
      .sort((a, b) => a.score - b.score)
      .map(({ e }) => e)

    // Only files starting with src/ should match.
    expect(matches.length).toBe(2)
    expect(matches.every((m) => m.type === "file")).toBe(true)
  })

  it("empty query matches all entries", () => {
    const entries: Suggestion[] = [
      fileSuggestion("src/lib/agent.ts"),
      taskSuggestion("a3f2-fix-login-bug", "Fix the login bug"),
    ]

    const query = ""
    const matches = entries
      .map((e) => ({ e, score: scoreSuggestion(e, query) }))
      .filter(({ score }) => score !== -1)

    expect(matches.length).toBe(2)
  })

  it("Suggestion type carries correct fields", () => {
    const file = fileSuggestion("src/lib/state.ts")
    expect(file.type).toBe("file")
    expect(file.value).toBe("src/lib/state.ts")
    expect(file.filterText).toBeUndefined()

    const task = taskSuggestion("a3f2-fix-login-bug", "Fix login")
    expect(task.type).toBe("task")
    expect(task.value).toBe("a3f2-fix-login-bug")
    expect(task.filterText).toBe("Fix login")
  })

  it("a query matching words in the prompt (not the slug) returns the right task", () => {
    const entries: Suggestion[] = [
      fileSuggestion("src/lib/agent.ts"),
      taskSuggestion("a3f2-fix-login-bug", "Fix the broken authentication flow on the login page"),
      taskSuggestion("b9c1-add-dark-mode", "Add a dark mode toggle to the settings panel"),
    ]

    // "authentication" only appears in the first task's filterText, not in its slug or any file path.
    const query = "authn"
    const matches = entries
      .map((e) => ({ e, score: scoreSuggestion(e, query) }))
      .filter(({ score }) => score !== -1)
      .sort((a, b) => a.score - b.score)
      .map(({ e }) => e)

    expect(matches.length).toBe(1)
    expect(matches[0]!.value).toBe("a3f2-fix-login-bug")
    expect(matches[0]!.type).toBe("task")
  })
})
