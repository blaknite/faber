import { execaSync, execa } from "execa"
import type { AgentConfig } from "./config.js"
import { modelForTier } from "./config.js"

export async function generateFilterText(prompt: string, repoRoot: string, loadedConfig: AgentConfig): Promise<string> {
  try {
    const opencodebin = (() => {
      try { return execaSync("which", ["opencode"]).stdout.trim() }
      catch { return null }
    })()
    if (!opencodebin) throw new Error("opencode not found in PATH")

    const fastModel = modelForTier('fast', loadedConfig)

    const metaPrompt = `You are given a task prompt exactly as a user typed it. Write a brief summary focusing on key nouns and actions. Do not ask for clarification, do not use tools, and do not explain your reasoning. Even if the prompt is short or unclear, do your best. Output only the summary text itself, with no label, prefix, or formatting.\n\n<task_prompt>\n${prompt}\n</task_prompt>`

    const { stdout } = await execa(opencodebin, ["run", "--model", fastModel, metaPrompt], { cwd: repoRoot, timeout: 30_000, stdin: "ignore" })
    // Strip any "Label: " or "**Label:** " prefix the model adds despite instructions
    return stdout.trim().replace(/^\*{0,2}\w[\w\s]*\*{0,2}:\s*/i, "")
  } catch {
    return ""
  }
}
