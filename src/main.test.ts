import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { main } from "./index.js"

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
