import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { lastActivityLabel } from "./managedStep.ts"
import { ensureFaberDir, taskOutputPath } from "./state.js"

let tmpRoot: string

beforeEach(() => {
  tmpRoot = join(tmpdir(), `faber-managed-step-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpRoot, { recursive: true })
  ensureFaberDir(tmpRoot)
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

function writeLog(taskId: string, lines: string[]) {
  writeFileSync(taskOutputPath(tmpRoot, taskId), lines.join("\n") + "\n")
}

describe("lastActivityLabel", () => {
  it("shows the most recent fatal error message", () => {
    writeLog("task-1", [
      JSON.stringify({ type: "text", timestamp: 1000, part: { text: "Working..." } }),
      JSON.stringify({
        type: "error",
        timestamp: 2000,
        error: {
          name: "UnknownError",
          data: { message: "Model not found: anthropic/claude-sonnet-4-6." },
        },
      }),
    ])

    expect(lastActivityLabel(tmpRoot, "task-1")).toBe("UnknownError: Model not found: anthropic/claude-sonnet-4-6.")
  })
})
