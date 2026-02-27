import { describe, expect, it } from "bun:test"
import {
  extractXmlText,
  formatElapsed,
  formatElapsedMs,
  normalizePath,
  parseEvent,
  parseToolEntry,
} from "./logParser.js"
import type { LogEvent } from "./logParser.js"

// --- normalizePath ---

describe("normalizePath", () => {
  it("returns empty string for undefined", () => {
    expect(normalizePath(undefined)).toBe("")
  })

  it("returns the value unchanged for relative paths", () => {
    expect(normalizePath("src/lib/state.ts")).toBe("src/lib/state.ts")
  })

  it("truncates absolute paths to the last 3 segments", () => {
    expect(normalizePath("/home/user/project/src/lib/state.ts")).toBe("src/lib/state.ts")
  })

  it("handles paths with fewer than 3 segments", () => {
    expect(normalizePath("/one/two")).toBe("one/two")
  })
})

// --- formatElapsedMs ---

describe("formatElapsedMs", () => {
  it("formats sub-minute durations as seconds only", () => {
    expect(formatElapsedMs(0)).toBe("0s")
    expect(formatElapsedMs(5000)).toBe("5s")
    expect(formatElapsedMs(59999)).toBe("59s")
  })

  it("formats durations of exactly one minute", () => {
    expect(formatElapsedMs(60000)).toBe("1m 00s")
  })

  it("pads seconds with a leading zero when needed", () => {
    expect(formatElapsedMs(61000)).toBe("1m 01s")
    expect(formatElapsedMs(125000)).toBe("2m 05s")
  })

  it("floors milliseconds rather than rounding", () => {
    expect(formatElapsedMs(59999)).toBe("59s")
    expect(formatElapsedMs(60999)).toBe("1m 00s")
  })
})

// --- formatElapsed ---

describe("formatElapsed", () => {
  const start = "2025-01-01T00:00:00.000Z"

  it("uses completedAt when provided", () => {
    const end = "2025-01-01T00:01:05.000Z" // 65 seconds later
    expect(formatElapsed(start, end, 0)).toBe("1m 05s")
  })

  it("uses now when completedAt is null", () => {
    const now = new Date("2025-01-01T00:00:30.000Z").getTime()
    expect(formatElapsed(start, null, now)).toBe("0m 30s")
  })

  it("handles zero elapsed time", () => {
    const now = new Date(start).getTime()
    expect(formatElapsed(start, null, now)).toBe("0m 00s")
  })
})

// --- parseEvent ---

function makeEvent(overrides: Partial<LogEvent>): LogEvent {
  return { type: "text", timestamp: 1000, ...overrides }
}

describe("parseEvent", () => {
  it("returns empty array for unknown event types", () => {
    const entries = parseEvent(makeEvent({ type: "unknown_type" }))
    expect(entries).toHaveLength(0)
  })

  describe("text events", () => {
    it("parses a text event", () => {
      const entries = parseEvent(makeEvent({ type: "text", part: { text: "Hello world" } }))
      expect(entries).toHaveLength(1)
      expect(entries[0]!.kind).toBe("text")
      expect(entries[0]!.text).toBe("Hello world")
      expect(entries[0]!.timestamp).toBe(1000)
    })

    it("trims whitespace from text", () => {
      const entries = parseEvent(makeEvent({ type: "text", part: { text: "  Hello  \n" } }))
      expect(entries[0]!.text).toBe("Hello")
    })

    it("returns empty array for blank text", () => {
      const entries = parseEvent(makeEvent({ type: "text", part: { text: "   " } }))
      expect(entries).toHaveLength(0)
    })
  })

  describe("step_finish events", () => {
    it("parses a step_finish event", () => {
      const entries = parseEvent(makeEvent({
        type: "step_finish",
        modelID: "anthropic/claude-sonnet-4-6",
      }))
      expect(entries).toHaveLength(1)
      expect(entries[0]!.kind).toBe("step_finish")
      expect(entries[0]!.modelId).toBe("anthropic/claude-sonnet-4-6")
    })

    it("handles a step_finish with no modelID", () => {
      const entries = parseEvent(makeEvent({ type: "step_finish" }))
      expect(entries[0]!.modelId).toBeUndefined()
    })
  })

  describe("reasoning events", () => {
    it("parses a reasoning event", () => {
      const entries = parseEvent(makeEvent({
        type: "reasoning",
        part: { text: "Let me think..." },
      }))
      expect(entries).toHaveLength(1)
      expect(entries[0]!.kind).toBe("reasoning")
      expect(entries[0]!.reasoningText).toBe("Let me think...")
    })

    it("returns empty array for blank reasoning text", () => {
      const entries = parseEvent(makeEvent({ type: "reasoning", part: { text: "" } }))
      expect(entries).toHaveLength(0)
    })
  })

  describe("tool_use events", () => {
    it("returns empty array when part.tool is missing", () => {
      const entries = parseEvent(makeEvent({ type: "tool_use", part: {} }))
      expect(entries).toHaveLength(0)
    })
  })
})

// --- parseToolEntry ---

function makeToolEvent(tool: string, input: Record<string, unknown> = {}, state: Record<string, unknown> = {}): LogEvent {
  return {
    type: "tool_use",
    timestamp: 2000,
    part: {
      tool,
      state: {
        input,
        status: "completed",
        ...state,
      },
    },
  }
}

describe("parseToolEntry", () => {
  it("returns null when event has no tool", () => {
    const result = parseToolEntry({ type: "tool_use", timestamp: 0 })
    expect(result).toBeNull()
  })

  describe("bash", () => {
    it("uses command from input", () => {
      const entry = parseToolEntry(makeToolEvent("bash", { command: "ls -la" }))!
      expect(entry.icon).toBe("$")
      expect(entry.title).toBe("ls -la")
    })

    it("falls back to description when command is missing", () => {
      const entry = parseToolEntry(makeToolEvent("bash", { description: "List files" }))!
      expect(entry.title).toBe("List files")
    })

    it("includes output as blockContent when present", () => {
      const entry = parseToolEntry(makeToolEvent("bash", { command: "ls" }, { output: "file.ts\n" }))!
      expect(entry.blockContent).toBe("file.ts\n")
    })
  })

  describe("read", () => {
    it("formats the title with the normalised path", () => {
      const entry = parseToolEntry(makeToolEvent("read", { filePath: "/project/src/lib/state.ts" }))!
      expect(entry.icon).toBe("→")
      expect(entry.title).toBe("Read src/lib/state.ts")
    })

    it("includes extra input params as description", () => {
      const entry = parseToolEntry(makeToolEvent("read", { filePath: "/file.ts", offset: 10, limit: 50 }))!
      expect(entry.description).toContain("offset=10")
      expect(entry.description).toContain("limit=50")
    })

    it("includes output as blockContent when present", () => {
      const entry = parseToolEntry(makeToolEvent("read", { filePath: "/file.ts" }, { output: "line 1\nline 2\n" }))!
      expect(entry.blockContent).toBe("line 1\nline 2\n")
    })

    it("omits blockContent when output is absent", () => {
      const entry = parseToolEntry(makeToolEvent("read", { filePath: "/file.ts" }))!
      expect(entry.blockContent).toBeUndefined()
    })

    it("strips XML tags from output when the content looks like XML", () => {
      const xml = "<root><item>Hello</item><item>World</item></root>"
      const entry = parseToolEntry(makeToolEvent("read", { filePath: "/file.xml" }, { output: xml }))!
      expect(entry.blockContent).toBe("Hello World")
    })

    it("leaves plain text output unchanged", () => {
      const entry = parseToolEntry(makeToolEvent("read", { filePath: "/file.ts" }, { output: "const x = 1\n" }))!
      expect(entry.blockContent).toBe("const x = 1\n")
    })
  })

  describe("extractXmlText", () => {
    it("returns text content from valid XML", () => {
      expect(extractXmlText("<root><child>hello</child></root>")).toBe("hello")
    })

    it("returns text content from multiple sibling elements", () => {
      expect(extractXmlText("<root><a>foo</a><b>bar</b></root>")).toBe("foo bar")
    })

    it("collapses extra whitespace", () => {
      expect(extractXmlText("<a>foo</a>   <b>bar</b>")).toBe("foo bar")
    })

    it("handles nested elements", () => {
      expect(extractXmlText("<outer><inner><deep>text</deep></inner></outer>")).toBe("text")
    })

    it("returns null for plain text (no leading <)", () => {
      expect(extractXmlText("just some text")).toBeNull()
    })

    it("returns null for malformed XML", () => {
      expect(extractXmlText("<unclosed")).toBeNull()
    })
  })

  describe("write", () => {
    it("formats the title correctly", () => {
      // normalizePath keeps the last 3 path segments, so /a/b/c/d.ts -> b/c/d.ts
      const entry = parseToolEntry(makeToolEvent("write", { filePath: "/project/src/index.ts" }))!
      expect(entry.icon).toBe("←")
      expect(entry.title).toBe("Write project/src/index.ts")
    })
  })

  describe("edit", () => {
    it("uses diff as blockContent when present", () => {
      const entry = parseToolEntry(makeToolEvent("edit", { filePath: "/file.ts" }, { metadata: { diff: "@@ -1 +1 @@\n-old\n+new" } }))!
      expect(entry.blockKind).toBe("diff")
      expect(entry.blockContent).toBe("@@ -1 +1 @@\n-old\n+new")
    })

    it("falls back to text when no diff", () => {
      const entry = parseToolEntry(makeToolEvent("edit", { filePath: "/file.ts" }))!
      // No diff and no output means no blockContent
      expect(entry.blockContent).toBeUndefined()
    })
  })

  describe("glob", () => {
    it("wraps the pattern in quotes", () => {
      const entry = parseToolEntry(makeToolEvent("glob", { pattern: "**/*.ts" }))!
      expect(entry.title).toBe('Glob "**/*.ts"')
      expect(entry.icon).toBe("✱")
    })

    it("includes match count in description", () => {
      const event = {
        type: "tool_use",
        timestamp: 0,
        part: {
          tool: "glob",
          state: {
            input: { pattern: "**/*.ts", path: "/src" },
            status: "completed",
            metadata: { count: 3 },
          },
        },
      } satisfies LogEvent
      const entry = parseToolEntry(event)!
      expect(entry.description).toContain("3 matches")
    })
  })

  describe("grep", () => {
    it("wraps the pattern in quotes", () => {
      const entry = parseToolEntry(makeToolEvent("grep", { pattern: "TODO" }))!
      expect(entry.title).toBe('Grep "TODO"')
      expect(entry.icon).toBe("✱")
    })
  })

  describe("webfetch", () => {
    it("includes the URL in the title", () => {
      const entry = parseToolEntry(makeToolEvent("webfetch", { url: "https://example.com" }))!
      expect(entry.icon).toBe("%")
      expect(entry.title).toBe("WebFetch https://example.com")
    })
  })

  describe("task", () => {
    it("uses description as title", () => {
      const entry = parseToolEntry(makeToolEvent("task", { subagent_type: "general", description: "Research the API" }))!
      expect(entry.title).toBe("Research the API")
      expect(entry.description).toBe("general")
    })

    it("falls back to subagent Task when no description", () => {
      const entry = parseToolEntry(makeToolEvent("task", { subagent_type: "explore" }))!
      expect(entry.title).toBe("explore Task")
    })

    it("shows error icon when status is error", () => {
      const event = makeToolEvent("task", { subagent_type: "explore" }, { status: "error" })
      const entry = parseToolEntry(event)!
      expect(entry.icon).toBe("✗")
    })

    it("shows running icon when status is running", () => {
      const event = makeToolEvent("task", { subagent_type: "explore" }, { status: "running" })
      const entry = parseToolEntry(event)!
      expect(entry.icon).toBe("•")
    })
  })

  describe("todowrite", () => {
    it("produces a Todos entry", () => {
      const entry = parseToolEntry(makeToolEvent("todowrite"))!
      expect(entry.icon).toBe("#")
      expect(entry.title).toBe("Todos")
    })
  })

  describe("skill", () => {
    it("includes the skill name in the title", () => {
      const entry = parseToolEntry(makeToolEvent("skill", { name: "working-in-faber" }))!
      expect(entry.title).toBe('Skill "working-in-faber"')
    })
  })

  describe("error status", () => {
    it("includes errorMessage when status is error", () => {
      const event = makeToolEvent("bash", { command: "ls" }, { status: "error", error: "command not found" })
      const entry = parseToolEntry(event)!
      expect(entry.status).toBe("error")
      expect(entry.errorMessage).toBe("command not found")
    })

    it("uses 'error' as fallback when error field is missing", () => {
      const event = makeToolEvent("bash", { command: "ls" }, { status: "error" })
      const entry = parseToolEntry(event)!
      expect(entry.errorMessage).toBe("error")
    })
  })

  describe("fallback for unknown tools", () => {
    it("uses the tool name as the title", () => {
      const entry = parseToolEntry(makeToolEvent("some_custom_tool"))!
      expect(entry.icon).toBe("⚙")
      expect(entry.title).toBe("some_custom_tool")
    })

    it("appends the first string input value to the title", () => {
      const entry = parseToolEntry(makeToolEvent("custom", { target: "something useful" }))!
      expect(entry.title).toBe("custom something useful")
    })
  })
})
