import { describe, expect, it } from "bun:test"
import { formatLog } from "./formatLog.js"
import type { LogEntry } from "./logParser.js"

// Helpers to build entries without repeating the timestamp everywhere.
function prompt(text: string): LogEntry {
  return { kind: "prompt", timestamp: 1000, text, model: "anthropic/claude-sonnet-4-6" }
}

function text(t: string): LogEntry {
  return { kind: "text", timestamp: 2000, text: t }
}

function tool(overrides: Partial<LogEntry>): LogEntry {
  return {
    kind: "tool_use",
    timestamp: 3000,
    icon: "$",
    title: "some command",
    ...overrides,
  }
}

function stepFinish(): LogEntry {
  return { kind: "step_finish", timestamp: 4000, modelId: "anthropic/claude-sonnet-4-6" }
}

function reasoning(t: string): LogEntry {
  return { kind: "reasoning", timestamp: 5000, reasoningText: t }
}

// --- prompt entries ---

describe("formatLog - prompt entries", () => {
  it("renders the prompt under a # Prompt heading", () => {
    const out = formatLog([prompt("Fix the crash.")])
    expect(out).toContain("# Prompt")
    expect(out).toContain("Fix the crash.")
  })

  it("renders no prompt section when there are no prompt entries", () => {
    const out = formatLog([text("Hello")])
    expect(out).not.toContain("# Prompt")
  })
})

// --- text entries ---

describe("formatLog - text entries", () => {
  it("renders text entries under # Output", () => {
    const out = formatLog([text("I found the issue.")])
    expect(out).toContain("# Output")
    expect(out).toContain("I found the issue.")
  })

  it("renders no output section when there are only prompt entries", () => {
    const out = formatLog([prompt("Do something")])
    expect(out).not.toContain("# Output")
  })
})

// --- tool_use entries ---

describe("formatLog - tool_use entries", () => {
  it("renders icon and title as a one-liner", () => {
    const out = formatLog([tool({ icon: "$", title: "git diff HEAD" })])
    expect(out).toContain("$ git diff HEAD")
  })

  it("appends description in parentheses when present", () => {
    const out = formatLog([tool({ icon: "→", title: "Read src/foo.ts", description: "from line 10" })])
    expect(out).toContain("→ Read src/foo.ts (from line 10)")
  })

  it("omits blockContent by default", () => {
    const out = formatLog([tool({ icon: "$", title: "ls", blockContent: "file.ts\nother.ts" })])
    expect(out).not.toContain("file.ts")
  })

  it("includes blockContent when full=true", () => {
    const out = formatLog([tool({ icon: "$", title: "ls", blockContent: "file.ts\nother.ts" })], { full: true })
    expect(out).toContain("file.ts")
    expect(out).toContain("other.ts")
  })

  it("indents block content with 4 spaces", () => {
    const out = formatLog([tool({ icon: "$", title: "ls", blockContent: "result" })], { full: true })
    expect(out).toContain("    result")
  })

  it("shows error message when present", () => {
    const out = formatLog([tool({ icon: "$", title: "ls", status: "error", errorMessage: "command not found" })])
    expect(out).toContain("! command not found")
  })
})

// --- step_finish entries ---

describe("formatLog - step_finish entries", () => {
  it("omits step_finish entries from default output", () => {
    const out = formatLog([prompt("Do it"), stepFinish(), text("Done.")])
    expect(out).not.toContain("step_finish")
    expect(out).not.toContain("claude-sonnet")
  })

  it("omits step_finish entries even when full=true", () => {
    const out = formatLog([stepFinish()], { full: true })
    expect(out).not.toContain("step_finish")
  })
})

// --- reasoning entries ---

describe("formatLog - reasoning entries", () => {
  it("omits reasoning entries from default output", () => {
    const out = formatLog([reasoning("Let me think about this carefully.")])
    expect(out).toBe("")
  })

  it("omits reasoning entries even when full=true", () => {
    const out = formatLog([reasoning("Thinking...")], { full: true })
    expect(out).toBe("")
  })
})

// --- JSON output ---

describe("formatLog - JSON output", () => {
  it("outputs valid JSON when json=true", () => {
    const entries: LogEntry[] = [prompt("Hello"), text("World")]
    const out = formatLog(entries, { json: true })
    const parsed = JSON.parse(out)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(2)
  })

  it("JSON includes all entry kinds without filtering", () => {
    const entries: LogEntry[] = [
      prompt("Prompt"),
      text("Text"),
      tool({ icon: "$", title: "cmd" }),
      stepFinish(),
      reasoning("thinking"),
    ]
    const out = formatLog(entries, { json: true })
    const parsed = JSON.parse(out) as LogEntry[]
    const kinds = parsed.map((e) => e.kind)
    expect(kinds).toContain("prompt")
    expect(kinds).toContain("text")
    expect(kinds).toContain("tool_use")
    expect(kinds).toContain("step_finish")
    expect(kinds).toContain("reasoning")
  })

  it("ignores full flag when json=true", () => {
    const entries: LogEntry[] = [tool({ icon: "$", title: "ls", blockContent: "file.ts" })]
    const out1 = formatLog(entries, { json: true })
    const out2 = formatLog(entries, { json: true, full: true })
    expect(out1).toBe(out2)
  })
})

// --- combined prompt + output ---

describe("formatLog - combined output", () => {
  it("renders both sections when prompt and output entries are present", () => {
    const entries: LogEntry[] = [
      prompt("Fix the crash."),
      text("I found the issue."),
      tool({ icon: "→", title: "Read src/user.ts" }),
      tool({ icon: "←", title: "Edit src/user.ts" }),
      text("All tests pass."),
    ]
    const out = formatLog(entries)
    expect(out).toContain("# Prompt")
    expect(out).toContain("Fix the crash.")
    expect(out).toContain("# Output")
    expect(out).toContain("I found the issue.")
    expect(out).toContain("→ Read src/user.ts")
    expect(out).toContain("← Edit src/user.ts")
    expect(out).toContain("All tests pass.")
  })

  it("prompt section comes before output section", () => {
    const entries: LogEntry[] = [prompt("The prompt."), text("The output.")]
    const out = formatLog(entries)
    expect(out.indexOf("# Prompt")).toBeLessThan(out.indexOf("# Output"))
  })

  it("returns empty string when there are no entries", () => {
    expect(formatLog([])).toBe("")
  })
})
