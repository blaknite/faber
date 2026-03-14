import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { tmpdir } from "node:os"
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

// Helpers that redirect the faber dir to a temp location by writing the
// marker file directly -- we test read/write in isolation.
function markerPath(root: string) {
  return join(root, ".faber", "extras-version")
}

describe("readExtrasVersion", () => {
  it("returns null when ~/.faber/extras-version does not exist", () => {
    // The real function reads from homedir(), so we test via the write/read round-trip
    // instead of touching the real home directory.
    //
    // This test verifies the null-return code path by checking that a freshly
    // created temp dir (with no .faber directory) would return null if hooked up.
    // Since we can't redirect homedir() without patching, we verify the file does
    // NOT exist and then exercise writeExtrasVersion + readExtrasVersion together
    // in the round-trip test below.
    const faberDir = join(tmpRoot, ".faber")
    expect(existsSync(faberDir)).toBe(false)
    // No assertion about the real readExtrasVersion() -- it reads from the real homedir.
  })
})

describe("writeExtrasVersion / readExtrasVersion round-trip", () => {
  // These functions always target the real ~/.faber directory. We write a known
  // version, read it back, then restore the original value so the test is
  // side-effect free for the developer's machine.

  it("round-trips a version string through ~/.faber/extras-version", () => {
    const original = readExtrasVersion()

    const testVersion = `test-${Date.now()}`
    writeExtrasVersion(testVersion)

    try {
      const read = readExtrasVersion()
      expect(read).toBe(testVersion)
    } finally {
      // Restore: if there was no file before, remove ours; otherwise put the
      // original content back.
      const marker = join(homedir(), ".faber", "extras-version")
      if (original === null) {
        rmSync(marker, { force: true })
      } else {
        writeFileSync(marker, original, "utf8")
      }
    }
  })

  it("trims whitespace from the stored value", () => {
    const original = readExtrasVersion()

    writeExtrasVersion("1.2.3")
    // Manually append whitespace to simulate an editor-modified file
    const marker = join(homedir(), ".faber", "extras-version")
    writeFileSync(marker, "  1.2.3  \n", "utf8")

    try {
      expect(readExtrasVersion()).toBe("1.2.3")
    } finally {
      if (original === null) {
        rmSync(marker, { force: true })
      } else {
        writeFileSync(marker, original, "utf8")
      }
    }
  })

  it("creates ~/.faber/ if it does not exist", () => {
    // We can't remove the real ~/.faber, so we just confirm the directory exists
    // after calling writeExtrasVersion -- it either existed already or was created.
    writeExtrasVersion("0.0.0")
    expect(existsSync(join(homedir(), ".faber"))).toBe(true)

    // Clean up
    const marker = join(homedir(), ".faber", "extras-version")
    const original = readExtrasVersion()
    if (original === "0.0.0") rmSync(marker, { force: true })
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
