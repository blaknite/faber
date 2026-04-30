import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from "node:fs"
import { dirname } from "node:path"
import { taskOutputPath } from "./state.js"

export type EventType = "prompt" | "opencode"

export interface Event {
  type: EventType
  timestamp: number
  data: Record<string, unknown>
}

export function appendEvent(repoRoot: string, taskId: string, event: Event): void {
  const path = taskOutputPath(repoRoot, taskId)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, JSON.stringify(event) + "\n")
}

export function truncateEvents(repoRoot: string, taskId: string): void {
  const path = taskOutputPath(repoRoot, taskId)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, "")
}

export function readEvents(repoRoot: string, taskId: string): Event[] {
  const path = taskOutputPath(repoRoot, taskId)
  if (!existsSync(path)) return []
  const raw = readFileSync(path, "utf8")
  const events: Event[] = []
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      events.push(wrapLegacy(JSON.parse(trimmed)))
    } catch {
      // skip unparseable lines
    }
  }
  return events
}

function wrapLegacy(parsed: Record<string, unknown>): Event {
  if (
    (parsed.type === "prompt" || parsed.type === "opencode") &&
    typeof parsed.data === "object" &&
    parsed.data !== null &&
    !Array.isArray(parsed.data)
  ) {
    return parsed as unknown as Event
  }

  if (parsed.type === "prompt") {
    return {
      type: "prompt",
      timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : 0,
      data: { prompt: parsed.prompt, model: parsed.model },
    }
  }

  return {
    type: "opencode",
    timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : 0,
    data: parsed,
  }
}
