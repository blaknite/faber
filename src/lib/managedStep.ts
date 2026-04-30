import { existsSync } from "node:fs"
import { watch as fsWatch } from "node:fs"
import { stateFilePath, readState } from "./state.js"
import { lastVisibleLogMessage, readLogEntries, summarizeErrorEntry } from "./logParser.js"

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

function truncateActivity(text: string): string {
  const firstLine = text.split("\n")[0]!.trim()
  return firstLine.length > 60 ? firstLine.slice(0, 57) + "..." : firstLine
}

export function lastActivityLabel(repoRoot: string, taskId: string): string {
  const entries = readLogEntries(repoRoot, taskId)
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!
    if (entry.kind === "tool_use" && entry.title) return entry.title
    if (entry.kind === "error") return truncateActivity(summarizeErrorEntry(entry))
    if (entry.kind === "text" && entry.text) {
      return truncateActivity(entry.text)
    }
  }
  return "Starting..."
}

export function startProgressSpinner(repoRoot: string, taskId: string, intro: string): () => void {
  let tick = 0

  process.stdout.write(`${intro}\n\n`)

  const spinInterval = setInterval(() => {
    const frame = SPINNER_FRAMES[tick % SPINNER_FRAMES.length]!
    const label = lastActivityLabel(repoRoot, taskId)
    process.stdout.write(`\r\x1b[K${frame} ${label}`)
    tick++
  }, 100)

  return () => {
    clearInterval(spinInterval)
    process.stdout.write("\r\x1b[K\n")
  }
}

export async function waitForTask(repoRoot: string, taskId: string): Promise<string> {
  const statePath = stateFilePath(repoRoot)

  return new Promise<string>((resolve) => {
    let settled = false
    let watcher: ReturnType<typeof fsWatch> | null = null

    function check() {
      if (settled) return
      const state = readState(repoRoot)
      const task = state.tasks.find((t) => t.id === taskId)
      if (!task || task.status !== "running") {
        settled = true
        watcher?.close()
        clearInterval(interval)
        resolve(task?.status ?? "unknown")
      }
    }

    if (existsSync(statePath)) {
      watcher = fsWatch(statePath, () => check())
      watcher.on("error", () => {})
    }

    const interval = setInterval(check, 1000)
  })
}

export function lastAgentMessage(repoRoot: string, taskId: string): string | null {
  return lastVisibleLogMessage(readLogEntries(repoRoot, taskId))
}
