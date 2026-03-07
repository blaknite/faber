import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, dirname } from "node:path"

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

// Fetch the SKILL.md content for a single skill from GitHub.
async function fetchSkillContent(ref: string, skillName: string): Promise<string> {
  const url = `${RAW_BASE}/${GITHUB_REPO}/${ref}/.agents/skills/${skillName}/SKILL.md`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch skill ${skillName}: ${res.status}`)
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

// Locate faber's bundled skills directory. Only used in dev mode (VERSION ===
// "dev") where the source tree is available on disk.
export function findBundledSkillsDir(fromDir: string): string | null {
  let dir = fromDir
  for (let i = 0; i < 4; i++) {
    const candidate = join(dir, ".agents", "skills")
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
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

// Install skills from a local directory (dev mode only).
export async function installSkillsFromDisk(bundledDir: string, destDir: string): Promise<void> {
  const skillNames = readdirSync(bundledDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)

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
    const srcSkillDir = join(bundledDir, skillName)
    const destSkillDir = join(destDir, skillName)

    const files = readdirSync(srcSkillDir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)

    for (const fileName of files) {
      const srcFile = join(srcSkillDir, fileName)
      const destFile = join(destSkillDir, fileName)

      if (existsSync(destFile)) {
        const srcContent = readFileSync(srcFile, "utf8")
        const destContent = readFileSync(destFile, "utf8")

        if (srcContent === destContent) continue

        console.log(`\nConflict: ${destFile.replace(homedir(), "~")} already exists and differs from the bundled version.`)
        const overwrite = await confirm("Overwrite with the bundled version?")
        if (!overwrite) {
          console.log(`Skipped ${skillName}/${fileName}.`)
          continue
        }
      }

      mkdirSync(destSkillDir, { recursive: true })
      copyFileSync(srcFile, destFile)
      console.log(`Installed skill: ${skillName}`)
    }
  }
}

// Offer to install faber's bundled skills to the global skills directory.
// In dev mode, reads from the local source tree. In release mode, fetches
// from GitHub at the matching version tag.
export async function installSkills(version: string, fromDir: string): Promise<void> {
  const destDir = globalSkillsDir()

  // In dev mode the compiled binary doesn't exist, so we read skills directly
  // from the local source tree.
  if (version === "dev") {
    const bundledDir = findBundledSkillsDir(fromDir)
    if (!bundledDir) {
      console.log("No bundled skills found. Skipping skill installation.")
      return
    }
    await installSkillsFromDisk(bundledDir, destDir)
    return
  }

  await installSkillsFromGitHub(version, destDir)
}
