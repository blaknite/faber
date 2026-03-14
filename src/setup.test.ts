import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execSync } from "node:child_process"
import { setup } from "./index.js"

let tmpRoot: string
let exitCode: number | null
let errorLines: string[]

function git(args: string, cwd?: string) {
  execSync(`git ${args}`, { cwd: cwd ?? tmpRoot, stdio: "pipe" })
}

function initRepo() {
  tmpRoot = join(tmpdir(), `faber-setup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpRoot, { recursive: true })
  git("init -b main")
  git("config user.email test@test.com")
  git("config user.name Test")
  writeFileSync(join(tmpRoot, "README.md"), "# test\n")
  git("add .")
  git('commit -m "initial commit"')
}

beforeEach(() => {
  exitCode = null
  errorLines = []

  spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errorLines.push(args.map(String).join(" "))
  })
  spyOn(process, "exit").mockImplementation((code?: number) => {
    exitCode = code ?? 0
    throw new Error(`process.exit(${code})`)
  })

  initRepo()
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe("setup", () => {
  describe("happy path", () => {
    it("creates .faber/ directory", async () => {
      await setup(tmpRoot)
      expect(existsSync(join(tmpRoot, ".faber"))).toBe(true)
    })

    it("creates .worktrees/ directory", async () => {
      await setup(tmpRoot)
      expect(existsSync(join(tmpRoot, ".worktrees"))).toBe(true)
    })

    it("creates .plans/ directory", async () => {
      await setup(tmpRoot)
      expect(existsSync(join(tmpRoot, ".plans"))).toBe(true)
    })

    it("adds .faber/ to .gitignore", async () => {
      await setup(tmpRoot)
      const gitignore = readFileSync(join(tmpRoot, ".gitignore"), "utf8")
      expect(gitignore).toContain(".faber/")
    })

    it("adds .worktrees/ to .gitignore", async () => {
      await setup(tmpRoot)
      const gitignore = readFileSync(join(tmpRoot, ".gitignore"), "utf8")
      expect(gitignore).toContain(".worktrees/")
    })

    it("adds .plans/ to .gitignore", async () => {
      await setup(tmpRoot)
      const gitignore = readFileSync(join(tmpRoot, ".gitignore"), "utf8")
      expect(gitignore).toContain(".plans/")
    })

    it("creates .gitignore when it does not exist", async () => {
      await setup(tmpRoot)
      expect(existsSync(join(tmpRoot, ".gitignore"))).toBe(true)
    })

    it("appends to an existing .gitignore without overwriting it", async () => {
      writeFileSync(join(tmpRoot, ".gitignore"), "node_modules/\n")
      await setup(tmpRoot)
      const gitignore = readFileSync(join(tmpRoot, ".gitignore"), "utf8")
      expect(gitignore).toContain("node_modules/")
      expect(gitignore).toContain(".faber/")
    })
  })

  describe("not a git repo", () => {
    it("prints an error message", async () => {
      const notARepo = join(tmpdir(), `faber-not-a-repo-${Date.now()}`)
      mkdirSync(notARepo, { recursive: true })
      try {
        await expect(setup(notARepo)).rejects.toThrow()
        expect(errorLines.some((l) => l.includes("Not a git repository"))).toBe(true)
      } finally {
        rmSync(notARepo, { recursive: true, force: true })
      }
    })

    it("exits with code 1", async () => {
      const notARepo = join(tmpdir(), `faber-not-a-repo-${Date.now()}`)
      mkdirSync(notARepo, { recursive: true })
      try {
        await expect(setup(notARepo)).rejects.toThrow()
        expect(exitCode).toBe(1)
      } finally {
        rmSync(notARepo, { recursive: true, force: true })
      }
    })
  })

  describe("idempotency", () => {
    it("running setup twice does not duplicate .gitignore entries", async () => {
      await setup(tmpRoot)
      await setup(tmpRoot)
      const gitignore = readFileSync(join(tmpRoot, ".gitignore"), "utf8")
      const faberLines = gitignore.split("\n").filter((l) => l.trim() === ".faber/")
      const worktreesLines = gitignore.split("\n").filter((l) => l.trim() === ".worktrees/")
      const plansLines = gitignore.split("\n").filter((l) => l.trim() === ".plans/")
      expect(faberLines).toHaveLength(1)
      expect(worktreesLines).toHaveLength(1)
      expect(plansLines).toHaveLength(1)
    })

    it("running setup twice does not throw", async () => {
      await setup(tmpRoot)
      // Should complete without any exception
      await setup(tmpRoot)
    })
  })

  describe("partial state", () => {
    it("creates .worktrees/ when .faber/ exists but .worktrees/ does not", async () => {
      mkdirSync(join(tmpRoot, ".faber"), { recursive: true })
      await setup(tmpRoot)
      expect(existsSync(join(tmpRoot, ".worktrees"))).toBe(true)
    })

    it("creates .faber/ when .worktrees/ exists but .faber/ does not", async () => {
      mkdirSync(join(tmpRoot, ".worktrees"), { recursive: true })
      await setup(tmpRoot)
      expect(existsSync(join(tmpRoot, ".faber"))).toBe(true)
    })

    it("still updates .gitignore when directories already exist", async () => {
      mkdirSync(join(tmpRoot, ".faber"), { recursive: true })
      mkdirSync(join(tmpRoot, ".worktrees"), { recursive: true })
      await setup(tmpRoot)
      const gitignore = readFileSync(join(tmpRoot, ".gitignore"), "utf8")
      expect(gitignore).toContain(".faber/")
      expect(gitignore).toContain(".worktrees/")
      expect(gitignore).toContain(".plans/")
    })
  })
})
