import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"

const GITHUB_REPO = "blaknite/faber"
const RAW_BASE = "https://raw.githubusercontent.com"

// The skills bundled with faber. Keep this in sync with .agents/skills/.
export const BUNDLED_SKILL_NAMES = [
  "delivering-work",
  "executing-work",
  "orchestrating-faber-tasks",
  "reading-faber-logs",
  "reviewing-code-in-faber",
  "reviewing-faber-tasks",
  "running-faber-tasks",
  "shaping-work",
  "shipping-work",
  "using-faber",
  "working-in-faber",
]

// The opencode slash commands bundled with faber.
export const BUNDLED_COMMAND_NAMES = [
  "faber-deliver",
  "faber-execute",
  "faber-logs",
  "faber-plan",
  "faber-review",
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

export type MergeAgentsResult = {
  text: string
  added: string[]
  updated: string[]
  skipped: string[]
  malformed: boolean
}

// Pure helper: merges agentsToWrite into the JSONC text of opencode.json.
// Pass null for text to create a fresh config from scratch.
// Agents that need conflict resolution should already be resolved by the caller --
// pass the resolved set as agentsToWrite. The skipped list is populated by the caller
// before invoking this helper for anything that was declined at the prompt.
export function mergeAgentsIntoOpencodeConfig(
  text: string | null,
  agentsToWrite: Record<string, object>
): MergeAgentsResult {
  const added: string[] = []
  const updated: string[] = []
  const skipped: string[] = []

  if (text === null) {
    const config: Record<string, any> = {
      "$schema": "https://opencode.ai/config.json",
      agent: {},
    }
    for (const [name, agentDef] of Object.entries(agentsToWrite)) {
      config.agent[name] = agentDef
      added.push(name)
    }
    return {
      text: JSON.stringify(config, null, 2) + "\n",
      added,
      updated,
      skipped,
      malformed: false,
    }
  }

  const errors: ParseError[] = []
  const parsed = parse(text, errors, { allowTrailingComma: true, disallowComments: false })

  if (errors.length > 0) {
    return { text, added, updated, skipped, malformed: true }
  }

  let currentText = text

  if (!parsed.agent || typeof parsed.agent !== "object") {
    const edits = modify(currentText, ["agent"], {}, { formattingOptions: { tabSize: 2, insertSpaces: true } })
    currentText = applyEdits(currentText, edits)
  }

  const existingAgents = parsed.agent && typeof parsed.agent === "object" ? parsed.agent : {}

  for (const [name, agentDef] of Object.entries(agentsToWrite)) {
    const existing = existingAgents[name]
    if (!existing) {
      const edits = modify(currentText, ["agent", name], agentDef, { formattingOptions: { tabSize: 2, insertSpaces: true } })
      currentText = applyEdits(currentText, edits)
      added.push(name)
    } else if (JSON.stringify(existing) === JSON.stringify(agentDef)) {
      // already up to date
    } else {
      const edits = modify(currentText, ["agent", name], agentDef, { formattingOptions: { tabSize: 2, insertSpaces: true } })
      currentText = applyEdits(currentText, edits)
      updated.push(name)
    }
  }

  return { text: currentText, added, updated, skipped, malformed: false }
}

// Install opencode slash commands and agent config together as a single prompted group.
async function installOpencode(version: string, homeDirOverride: string = homedir()): Promise<void> {
  const opencodeDir = join(homeDirOverride, ".opencode")
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

      console.log(`\nConflict: ${destFile.replace(homeDirOverride, "~")} already exists and differs from the v${version} version.`)
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
  const existingText = existsSync(configFile) ? readFileSync(configFile, "utf8") : null

  // Resolve conflicts interactively before calling the pure helper
  const agentsToWrite: Record<string, object> = {}
  const skippedAgents: string[] = []

  const errors: ParseError[] = []
  const parsedConfig = existingText !== null
    ? parse(existingText, errors, { allowTrailingComma: true, disallowComments: false })
    : { agent: {} }

  if (existingText !== null && errors.length > 0) {
    console.error(`Warning: ~/.opencode/opencode.json is not valid JSON. Skipping agent config merge.`)
    return
  }

  const existingAgents = parsedConfig.agent && typeof parsedConfig.agent === "object" ? parsedConfig.agent : {}

  for (const [name, agentDef] of Object.entries(FABER_AGENTS)) {
    const existing = existingAgents[name]
    if (!existing || JSON.stringify(existing) === JSON.stringify(agentDef)) {
      agentsToWrite[name] = agentDef
    } else {
      const overwrite = await confirm(
        `Agent '${name}' already exists in ~/.opencode/opencode.json with different settings. Overwrite?`
      )
      if (overwrite) {
        agentsToWrite[name] = agentDef
      } else {
        skippedAgents.push(name)
      }
    }
  }

  const result = mergeAgentsIntoOpencodeConfig(existingText, agentsToWrite)

  for (const name of result.added) {
    console.log(`Added agent: ${name}`)
  }
  for (const name of result.updated) {
    console.log(`Updated agent: ${name}`)
  }
  for (const name of skippedAgents) {
    console.log(`Skipped agent: ${name}`)
  }

  mkdirSync(opencodeDir, { recursive: true })
  writeFileSync(configFile, result.text, "utf8")
}

// Read the extras version marker from <baseDir>/.faber/extras-version.
// Returns null if the file doesn't exist. Defaults to ~/.faber.
export function readExtrasVersion(baseDir: string = homedir()): string | null {
  const markerFile = join(baseDir, ".faber", "extras-version")
  if (!existsSync(markerFile)) return null
  try {
    return readFileSync(markerFile, "utf8").trim()
  } catch {
    return null
  }
}

// Write the extras version marker to <baseDir>/.faber/extras-version.
// Creates <baseDir>/.faber/ if needed. Defaults to ~/.faber.
export function writeExtrasVersion(version: string, baseDir: string = homedir()): void {
  const faberDir = join(baseDir, ".faber")
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
