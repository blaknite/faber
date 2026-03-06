import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { main, stripFlags } from "./index.js"

// Mock out anything that would spawn real processes or touch the filesystem
// in a way that would block the test from reaching the command dispatch.
mock.module("./lib/agent.js", () => ({
  spawnAgent: mock(() => {}),
  DEFAULT_RESUME_PROMPT: "The task was interrupted. Please continue where you left off.",
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

    it("does not error on flag-only args (treats bare faber as TUI launch)", async () => {
      // "--dir" starts with "-" so should not be treated as an unknown command
      process.argv = ["bun", "faber", "--dir", "/nonexistent"]
      // parseDirFlag exits 1 when the path doesn't exist, which is fine -- it
      // just shouldn't exit with "Unknown command"
      await expect(main()).rejects.toThrow()
      expect(errorLines.some((l) => l.includes("Unknown command"))).toBe(false)
    })
  })
})
