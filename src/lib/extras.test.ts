import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import {
  BUNDLED_COMMAND_NAMES,
  BUNDLED_SKILL_NAMES,
  FABER_AGENTS,
  globalSkillsDir,
  installExtras,
  readExtrasVersion,
  writeExtrasVersion,
} from "./extras.js"

// ------------------------------------------------------------------
// BUNDLED_SKILL_NAMES
// ------------------------------------------------------------------

describe("BUNDLED_SKILL_NAMES", () => {
  it("is non-empty", () => {
    expect(BUNDLED_SKILL_NAMES.length).toBeGreaterThan(0)
  })

  it("contains only strings", () => {
    for (const name of BUNDLED_SKILL_NAMES) {
      expect(typeof name).toBe("string")
    }
  })

  it("has no duplicates", () => {
    expect(new Set(BUNDLED_SKILL_NAMES).size).toBe(BUNDLED_SKILL_NAMES.length)
  })

  it("uses kebab-case names", () => {
    for (const name of BUNDLED_SKILL_NAMES) {
      expect(name).toMatch(/^[a-z][a-z0-9-]*$/)
    }
  })

  it("matches the skills that actually exist in .agents/skills/", () => {
    // This keeps the constant in sync with the filesystem so we notice
    // when a skill is added or removed without updating the list.
    const repoRoot = join(import.meta.dir, "..", "..")
    const skillsDir = join(repoRoot, ".agents", "skills")
    const { readdirSync } = require("node:fs")
    const onDisk = readdirSync(skillsDir).sort() as string[]
    expect([...BUNDLED_SKILL_NAMES].sort()).toEqual(onDisk)
  })
})

// ------------------------------------------------------------------
// BUNDLED_COMMAND_NAMES
// ------------------------------------------------------------------

describe("BUNDLED_COMMAND_NAMES", () => {
  it("is non-empty", () => {
    expect(BUNDLED_COMMAND_NAMES.length).toBeGreaterThan(0)
  })

  it("contains only strings", () => {
    for (const name of BUNDLED_COMMAND_NAMES) {
      expect(typeof name).toBe("string")
    }
  })

  it("has no duplicates", () => {
    expect(new Set(BUNDLED_COMMAND_NAMES).size).toBe(BUNDLED_COMMAND_NAMES.length)
  })

  it("uses kebab-case names", () => {
    for (const name of BUNDLED_COMMAND_NAMES) {
      expect(name).toMatch(/^[a-z][a-z0-9-]*$/)
    }
  })

  it("matches the commands that actually exist in .opencode/commands/", () => {
    const repoRoot = join(import.meta.dir, "..", "..")
    const commandsDir = join(repoRoot, ".opencode", "commands")
    const { readdirSync } = require("node:fs")
    // The files on disk have .md extensions; strip them before comparing.
    const onDisk = (readdirSync(commandsDir) as string[])
      .map((f: string) => f.replace(/\.md$/, ""))
      .sort()
    expect([...BUNDLED_COMMAND_NAMES].sort()).toEqual(onDisk)
  })
})

// ------------------------------------------------------------------
// FABER_AGENTS
// ------------------------------------------------------------------

describe("FABER_AGENTS", () => {
  it("defines at least one agent", () => {
    expect(Object.keys(FABER_AGENTS).length).toBeGreaterThan(0)
  })

  it("every agent has a description, model, color, mode, and permission", () => {
    for (const [name, def] of Object.entries(FABER_AGENTS)) {
      const agent = def as Record<string, unknown>
      expect(typeof agent.description, `${name}.description`).toBe("string")
      expect(typeof agent.model, `${name}.model`).toBe("string")
      expect(typeof agent.color, `${name}.color`).toBe("string")
      expect(typeof agent.mode, `${name}.mode`).toBe("string")
      expect(typeof agent.permission, `${name}.permission`).toBe("object")
    }
  })

  it("model strings reference the anthropic/ provider", () => {
    for (const [name, def] of Object.entries(FABER_AGENTS)) {
      const agent = def as Record<string, unknown>
      expect(agent.model as string, `${name}.model`).toStartWith("anthropic/")
    }
  })

  it("color values are valid hex codes", () => {
    for (const [name, def] of Object.entries(FABER_AGENTS)) {
      const agent = def as Record<string, unknown>
      expect(agent.color as string, `${name}.color`).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })
})

// ------------------------------------------------------------------
// globalSkillsDir()
// ------------------------------------------------------------------

describe("globalSkillsDir", () => {
  it("returns a string", () => {
    expect(typeof globalSkillsDir()).toBe("string")
  })

  it("prefers ~/.config/agents/skills when it exists", () => {
    const primary = join(homedir(), ".config", "agents", "skills")
    if (existsSync(primary)) {
      expect(globalSkillsDir()).toBe(primary)
    }
  })

  it("falls back to ~/.claude/skills when primary does not exist", () => {
    const primary = join(homedir(), ".config", "agents", "skills")
    const secondary = join(homedir(), ".claude", "skills")

    if (!existsSync(primary) && existsSync(secondary)) {
      expect(globalSkillsDir()).toBe(secondary)
    }
  })

  it("defaults to the primary location when neither directory exists", () => {
    const primary = join(homedir(), ".config", "agents", "skills")
    const secondary = join(homedir(), ".claude", "skills")

    if (!existsSync(primary) && !existsSync(secondary)) {
      expect(globalSkillsDir()).toBe(primary)
    }
  })

  it("never returns the secondary path when primary exists", () => {
    const primary = join(homedir(), ".config", "agents", "skills")
    const secondary = join(homedir(), ".claude", "skills")

    if (existsSync(primary)) {
      // Primary wins; secondary must not be returned.
      expect(globalSkillsDir()).not.toBe(secondary)
    }
  })
})

// ------------------------------------------------------------------
// readExtrasVersion / writeExtrasVersion
// ------------------------------------------------------------------

let tmpRoot: string

beforeEach(() => {
  tmpRoot = join(tmpdir(), `faber-extras-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpRoot, { recursive: true })
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe("readExtrasVersion", () => {
  it("returns null when the marker file does not exist", () => {
    expect(readExtrasVersion(tmpRoot)).toBeNull()
  })

  it("returns null when .faber/ exists but extras-version does not", () => {
    mkdirSync(join(tmpRoot, ".faber"), { recursive: true })
    expect(readExtrasVersion(tmpRoot)).toBeNull()
  })

  it("returns the version string from the marker file", () => {
    mkdirSync(join(tmpRoot, ".faber"), { recursive: true })
    writeFileSync(join(tmpRoot, ".faber", "extras-version"), "1.2.3", "utf8")
    expect(readExtrasVersion(tmpRoot)).toBe("1.2.3")
  })

  it("trims whitespace from the stored value", () => {
    mkdirSync(join(tmpRoot, ".faber"), { recursive: true })
    writeFileSync(join(tmpRoot, ".faber", "extras-version"), "  1.2.3  \n", "utf8")
    expect(readExtrasVersion(tmpRoot)).toBe("1.2.3")
  })
})

describe("writeExtrasVersion", () => {
  it("writes the version to .faber/extras-version", () => {
    writeExtrasVersion("1.2.3", tmpRoot)
    expect(readExtrasVersion(tmpRoot)).toBe("1.2.3")
  })

  it("creates .faber/ if it does not exist", () => {
    expect(existsSync(join(tmpRoot, ".faber"))).toBe(false)
    writeExtrasVersion("1.0.0", tmpRoot)
    expect(existsSync(join(tmpRoot, ".faber"))).toBe(true)
  })

  it("overwrites a previous version", () => {
    writeExtrasVersion("1.0.0", tmpRoot)
    writeExtrasVersion("2.0.0", tmpRoot)
    expect(readExtrasVersion(tmpRoot)).toBe("2.0.0")
  })
})

// ------------------------------------------------------------------
// installExtras -- dev-mode guard
// ------------------------------------------------------------------

describe("installExtras", () => {
  it('exits early and logs when version is "dev"', async () => {
    const logs: string[] = []
    const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.join(" "))
    })

    try {
      await installExtras("dev")
    } finally {
      spy.mockRestore()
    }

    expect(logs.some((l) => l.includes("Extras installation requires a release build"))).toBe(true)
  })

  // installSkillsFromGitHub and installOpencode both make real network requests
  // and prompt via stdin, so they are not tested here. Covering them would
  // require either HTTP mocking (e.g. undici MockAgent) or a stdin mock -- both
  // are feasible but out of scope for this initial pass. The dev-mode guard
  // above confirms the function is reachable and that the early-exit branch works.
})
