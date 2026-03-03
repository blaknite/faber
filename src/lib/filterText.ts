import { execaSync, execa } from "execa"
import { MODELS } from "../types.js"

export async function generateFilterText(prompt: string, repoRoot: string): Promise<string> {
  try {
    const opencodebin = (() => {
      try { return execaSync("which", ["opencode"]).stdout.trim() }
      catch { return null }
    })()
    if (!opencodebin) throw new Error("opencode not found in PATH")

    const fastModel = MODELS.find((m) => m.label === "Fast")?.value
    if (!fastModel) throw new Error("Fast model not found in MODELS")

    const metaPrompt = `Summarise this task in 2-3 sentences focusing on key nouns and actions. Output only the summary, no explanation. Task: ${prompt}`

    const { stdout } = await execa(opencodebin, ["run", "--model", fastModel, metaPrompt], { cwd: repoRoot })
    return stdout.trim()
  } catch {
    return ""
  }
}
