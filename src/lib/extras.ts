import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const GITHUB_REPO = "blaknite/faber"
const RAW_BASE = "https://raw.githubusercontent.com"

// The skills bundled with faber. Keep this in sync with .agents/skills/.
export const BUNDLED_SKILL_NAMES = [
  "executing-work",
  "orchestrating-faber-tasks",
  "reading-faber-logs",
  "reviewing-faber-tasks",
  "running-faber-tasks",
  "shaping-work",
  "shipping-work",
  "using-faber",
  "working-in-faber",
]

// The opencode slash commands bundled with faber.
export const BUNDLED_COMMAND_NAMES = [
  "faber-execute",
  "faber-logs",
  "faber-plan",
  "faber-run",
  "faber-ship",
]

// The faber agent definitions. These are installed into ~/.opencode/opencode.json
// alongside the slash commands, since commands reference these agent names.
export const FABER_AGENTS: Record<string, object> = {
  fast: {
    description: "Quick tasks and small changes",
    model: "anthropic/claude-haiku-4-5",
    color: "#00cc66",
    mode: "primary",
    permission: { question: "allow" },
  },
  smart: {
    description: "Standard development work",
    model: "anthropic/claude-sonnet-4-6",
    color: "#0088ff",
    mode: "primary",
    permission: { question: "allow" },
  },
  deep: {
    description: "Complex problems and architecture decisions",
    model: "anthropic/claude-opus-4-6",
    color: "#9966ff",
    mode: "primary",
    permission: { question: "allow" },
  },
}

// Fetch the SKILL.md content for a single skill from GitHub.
async function fetchSkillContent(ref: string, skillName: string): Promise<string> {
  const url = `${RAW_BASE}/${GITHUB_REPO}/${ref}/.agents/skills/${skillName}/SKILL.md`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch skill ${skillName}: ${res.status}`)
  return res.text()
}

// Fetch the content for a single opencode slash command from GitHub.
async function fetchCommandContent(ref: string, commandName: string): Promise<string> {
  const url = `${RAW_BASE}/${GITHUB_REPO}/${ref}/.opencode/commands/${commandName}.md`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch command ${commandName}: ${res.status}`)
  return res.text()
}

// Resolve the global skills directory, preferring ~/.config/agents/skills and
// falling back to ~/.claude/skills.
export function globalSkillsDir(): string {
  const primary = join(homedir(), ".config", "agents", "skills")
  if (existsSync(primary)) return primary
  const secondary = join(homedir(), ".claude", "skills")
  if (existsSync(secondary)) return secondary
  // Neither exists yet -- default to the primary location.
  return primary
}

// Prompt the user with a [y/N] question and return true if they answer yes.
export async function confirm(question: string): Promise<boolean> {
  process.stdout.write(`${question} [y/N] `)
  return new Promise<boolean>((resolve) => {
    let input = ""
    process.stdin.setEncoding("utf8")
    process.stdin.setRawMode?.(true)
    process.stdin.resume()
    const handler = (chunk: string) => {
      const char = chunk.toString()
      if (char === "\r" || char === "\n") {
        process.stdin.setRawMode?.(false)
        process.stdin.pause()
        process.stdin.removeListener("data", handler)
        process.stdout.write("\n")
        resolve(input.toLowerCase() === "y")
      } else if (char === "\u0003") {
        // Ctrl-C
        process.stdin.setRawMode?.(false)
        process.stdin.pause()
        process.stdin.removeListener("data", handler)
        process.stdout.write("\n")
        resolve(false)
      } else {
        input += char
        process.stdout.write(char)
      }
    }
    process.stdin.on("data", handler)
  })
}

// Install skills from a release build by fetching them from GitHub at the
// matching version tag.
async function installSkillsFromGitHub(version: string, destDir: string): Promise<void> {
  const ref = `refs/tags/v${version}`
  const skillNames = BUNDLED_SKILL_NAMES

  if (skillNames.length === 0) return

  const shouldInstall = await confirm(
    `Install ${skillNames.length} faber skill${skillNames.length === 1 ? "" : "s"} to ${destDir.replace(homedir(), "~")}?`
  )
  if (!shouldInstall) {
    console.log("Skipped skill installation.")
    return
  }

  mkdirSync(destDir, { recursive: true })

  for (const skillName of skillNames) {
    const destSkillDir = join(destDir, skillName)
    const destFile = join(destSkillDir, "SKILL.md")

    let content: string
    try {
      content = await fetchSkillContent(ref, skillName)
    } catch (err) {
      console.error(`Failed to fetch ${skillName}: ${err instanceof Error ? err.message : err}`)
      continue
    }

    if (existsSync(destFile)) {
      const existing = readFileSync(destFile, "utf8")
      if (existing === content) continue

      console.log(`\nConflict: ${destFile.replace(homedir(), "~")} already exists and differs from the v${version} version.`)
      const overwrite = await confirm("Overwrite?")
      if (!overwrite) {
        console.log(`Skipped ${skillName}/SKILL.md.`)
        continue
      }
    }

    mkdirSync(destSkillDir, { recursive: true })
    writeFileSync(destFile, content, "utf8")
    console.log(`Installed skill: ${skillName}`)
  }
}

// Install opencode slash commands and agent config together as a single prompted group.
async function installOpencode(version: string): Promise<void> {
  const opencodeDir = join(homedir(), ".opencode")
  const commandsDir = join(opencodeDir, "commands")
  const configFile = join(opencodeDir, "opencode.json")

  const shouldInstall = await confirm(
    `Install opencode commands and agent config to ~/.opencode?`
  )
  if (!shouldInstall) {
    console.log("Skipped opencode installation.")
    return
  }

  const ref = `refs/tags/v${version}`

  // Install slash commands
  mkdirSync(commandsDir, { recursive: true })

  for (const commandName of BUNDLED_COMMAND_NAMES) {
    const destFile = join(commandsDir, `${commandName}.md`)

    let content: string
    try {
      content = await fetchCommandContent(ref, commandName)
    } catch (err) {
      console.error(`Failed to fetch ${commandName}: ${err instanceof Error ? err.message : err}`)
      continue
    }

    if (existsSync(destFile)) {
      const existing = readFileSync(destFile, "utf8")
      if (existing === content) continue

      console.log(`\nConflict: ${destFile.replace(homedir(), "~")} already exists and differs from the v${version} version.`)
      const overwrite = await confirm("Overwrite?")
      if (!overwrite) {
        console.log(`Skipped ${commandName}.md.`)
        continue
      }
    }

    writeFileSync(destFile, content, "utf8")
    console.log(`Installed command: ${commandName}`)
  }

  // Merge agent definitions into ~/.opencode/opencode.json
  let config: Record<string, any> = { "$schema": "https://opencode.ai/config.json" }
  if (existsSync(configFile)) {
    try {
      config = JSON.parse(readFileSync(configFile, "utf8"))
    } catch {
      // If the file is malformed, start fresh but warn
      console.error(`Warning: ~/.opencode/opencode.json is not valid JSON. Skipping agent config merge.`)
      return
    }
  }

  if (!config.agent || typeof config.agent !== "object") {
    config.agent = {}
  }

  for (const [name, agentDef] of Object.entries(FABER_AGENTS)) {
    const existing = config.agent[name]

    if (!existing) {
      config.agent[name] = agentDef
      console.log(`Added agent: ${name}`)
    } else if (JSON.stringify(existing) === JSON.stringify(agentDef)) {
      // Already up to date, skip silently
    } else {
      const overwrite = await confirm(
        `Agent '${name}' already exists in ~/.opencode/opencode.json with different settings. Overwrite?`
      )
      if (overwrite) {
        config.agent[name] = agentDef
        console.log(`Updated agent: ${name}`)
      } else {
        console.log(`Skipped agent: ${name}`)
      }
    }
  }

  mkdirSync(opencodeDir, { recursive: true })
  writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n", "utf8")
}

// Read the extras version marker from ~/.faber/extras-version.
// Returns null if the file doesn't exist.
export function readExtrasVersion(): string | null {
  const markerFile = join(homedir(), ".faber", "extras-version")
  if (!existsSync(markerFile)) return null
  try {
    return readFileSync(markerFile, "utf8").trim()
  } catch {
    return null
  }
}

// Write the extras version marker to ~/.faber/extras-version.
// Creates ~/.faber/ if needed.
export function writeExtrasVersion(version: string): void {
  const faberDir = join(homedir(), ".faber")
  mkdirSync(faberDir, { recursive: true })
  writeFileSync(join(faberDir, "extras-version"), version, "utf8")
}

// Install faber's optional extras: skills and opencode setup.
// In dev mode, prints a message and exits early -- extras require a release build.
export async function installExtras(version: string): Promise<void> {
  if (version === "dev") {
    console.log("Extras installation requires a release build. Skipping.")
    return
  }

  await installSkillsFromGitHub(version, globalSkillsDir())
  await installOpencode(version)
  writeExtrasVersion(version)
}
