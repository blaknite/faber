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

    const metaPrompt = `You are given a task prompt exactly as a user typed it. Write a brief summary focusing on key nouns and actions. Do not ask for clarification, do not use tools, and do not explain your reasoning. Even if the prompt is short or unclear, do your best. Output only the summary. Task prompt: ${prompt}`

    const { stdout } = await execa(opencodebin, ["run", "--model", fastModel, metaPrompt], { cwd: repoRoot, timeout: 30_000, stdin: "ignore" })
    return stdout.trim()
  } catch {
    return ""
  }
}
