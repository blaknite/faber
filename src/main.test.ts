import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { main, parseModelFlag, stripFlags } from "./index.js"

// Mock out anything that would spawn real processes or touch the filesystem
// in a way that would block the test from reaching the command dispatch.
mock.module("./lib/agent.js", () => ({
  spawnAgent: mock(() => {}),
  DEFAULT_RESUME_PROMPT: "The task was interrupted. Please continue where you left off.",
}))

mock.module("./lib/dispatch.js", () => ({
  createAndDispatchTask: mock(async () => ({
    id: "abcd-fake-task",
    prompt: "do something",
    model: "anthropic/claude-sonnet-4-6",
    status: "done",
    pid: null,
    worktree: ".worktrees/abcd-fake-task",
    sessionId: null,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    exitCode: 0,
    hasCommits: false,
    baseBranch: "main",
  })),
}))

// Mock the TUI renderer so launching "faber" with no command doesn't start a
// real terminal renderer and block the test.
mock.module("@opentui/react", () => ({
  createCliRenderer: mock(async () => ({
    start: mock(() => {}),
    destroy: mock(() => {}),
  })),
  createRoot: mock(() => ({
    render: mock(() => {}),
    unmount: mock(() => {}),
  })),
}))

let errorLines: string[]
let exitCode: number | null
let originalArgv: string[]

beforeEach(() => {
  originalArgv = process.argv.slice()
  errorLines = []
  exitCode = null
  spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errorLines.push(args.map(String).join(" "))
  })
  spyOn(process, "exit").mockImplementation((code?: number) => {
    exitCode = code ?? 0
    throw new Error(`process.exit(${code})`)
  })
})

afterEach(() => {
  process.argv = originalArgv
})

describe("stripFlags", () => {
  it("returns args unchanged when there are no flags", () => {
    expect(stripFlags(["run", "Fix the bug"])).toEqual(["run", "Fix the bug"])
  })

  it("strips a value flag and its argument", () => {
    expect(stripFlags(["run", "--model", "deep", "Fix the bug"])).toEqual(["run", "Fix the bug"])
  })

  it("strips a value flag that appears before the positional", () => {
    expect(stripFlags(["run", "--base", "main", "Fix the bug"])).toEqual(["run", "Fix the bug"])
  })

  it("strips multiple value flags", () => {
    expect(stripFlags(["run", "--model", "deep", "--base", "main", "Fix the bug"])).toEqual(["run", "Fix the bug"])
  })

  it("strips boolean flags", () => {
    expect(stripFlags(["read", "--full", "a3f2-fix-login"])).toEqual(["read", "a3f2-fix-login"])
  })

  it("strips --yes", () => {
    expect(stripFlags(["delete", "--yes", "a3f2-fix-login"])).toEqual(["delete", "a3f2-fix-login"])
  })

  it("strips --dir and its value", () => {
    expect(stripFlags(["watch", "--dir", "/path/to/repo", "a3f2-fix-login"])).toEqual(["watch", "a3f2-fix-login"])
  })

  it("handles flags interspersed with positionals", () => {
    expect(stripFlags(["continue", "--dir", "/repo", "a3f2-fix-login", "do X instead"])).toEqual([
      "continue",
      "a3f2-fix-login",
      "do X instead",
    ])
  })

  it("returns an empty array when given only flags", () => {
    expect(stripFlags(["--model", "deep", "--base", "main"])).toEqual([])
  })

  it("strips --branch and its value", () => {
    expect(stripFlags(["review", "--branch", "feature-x"])).toEqual(["review"])
  })

  it("strips --pull-request and its value", () => {
    expect(stripFlags(["review", "--pull-request", "123"])).toEqual(["review"])
  })

  it("strips --branch and --pull-request together with other flags", () => {
    expect(stripFlags(["review", "--branch", "feature-x", "--model", "deep"])).toEqual(["review"])
  })
})

describe("parseModelFlag", () => {
  it("returns undefined explicitModel when a known label like 'smart' is used", () => {
    const result = parseModelFlag(["run", "--model", "smart", "do a thing"])
    expect(result.explicitModel).toBeUndefined()
  })

  it("returns undefined explicitModel when a known label like 'deep' is used", () => {
    const result = parseModelFlag(["run", "--model", "deep", "do a thing"])
    expect(result.explicitModel).toBeUndefined()
  })

  it("returns the raw string as explicitModel when a non-label model string is given", () => {
    const result = parseModelFlag(["run", "--model", "google/gemini-2.5-pro", "do a thing"])
    expect(result.explicitModel).toBe("google/gemini-2.5-pro")
  })

  it("returns undefined explicitModel when no --model flag is present", () => {
    const result = parseModelFlag(["run", "do a thing"])
    expect(result.explicitModel).toBeUndefined()
  })

  it("resolves known label to the correct tier", () => {
    const result = parseModelFlag(["run", "--model", "smart", "do a thing"])
    expect(result.tier).toBe("smart")
  })
})

describe("main", () => {
  describe("unsupported command", () => {
    it("prints an error and exits 1 for an unknown command", async () => {
      process.argv = ["bun", "faber", "notacommand"]
      await expect(main()).rejects.toThrow()
      expect(exitCode).toBe(1)
      expect(errorLines.some((l) => l.includes("Unknown command"))).toBe(true)
      expect(errorLines.some((l) => l.includes("notacommand"))).toBe(true)
    })

    it("mentions --help in the error message", async () => {
      process.argv = ["bun", "faber", "badcommand"]
      await expect(main()).rejects.toThrow()
      expect(errorLines.some((l) => l.includes("--help"))).toBe(true)
    })

    it("does not error on known commands (run)", async () => {
      // run with no prompt exits 1 with a usage message, not an "Unknown command" error
      process.argv = ["bun", "faber", "run"]
      await expect(main()).rejects.toThrow()
      expect(exitCode).toBe(1)
      expect(errorLines.some((l) => l.includes("Unknown command"))).toBe(false)
    })

    it("does not error on known commands (stop)", async () => {
      // stop with no taskId exits 1 with a usage message, not an "Unknown command" error
      process.argv = ["bun", "faber", "stop"]
      await expect(main()).rejects.toThrow()
      expect(exitCode).toBe(1)
      expect(errorLines.some((l) => l.includes("Unknown command"))).toBe(false)
    })

    it("does not error on flag-only args (treats bare faber as TUI launch)", async () => {
      // "--dir" starts with "-" so should not be treated as an unknown command
      process.argv = ["bun", "faber", "--dir", "/nonexistent"]
      // parseDirFlag exits 1 when the path doesn't exist, which is fine -- it
      // just shouldn't exit with "Unknown command"
      await expect(main()).rejects.toThrow()
      expect(errorLines.some((l) => l.includes("Unknown command"))).toBe(false)
    })

    it("does not error on known commands (review)", async () => {
      process.argv = ["bun", "faber", "review"]
      await main().catch(() => {})
      expect(errorLines.some((l) => l.includes("Unknown command"))).toBe(false)
    })
  })
})
