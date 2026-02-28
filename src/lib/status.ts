import { SPINNER_FRAMES } from "./tick.js"
import type { TaskStatus } from "../types.js"

export const STATUS_COLOR: Record<TaskStatus, string> = {
  running: "#00aaff",
  done: "#00cc66",
  ready: "#ff9900",
  failed: "#cc3333",
  unknown: "#888888",
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  running: "Running",
  done: "Done",
  ready: "Ready",
  failed: "Failed",
  unknown: "Unknown",
}

export const STATUS_SYMBOL: Record<TaskStatus, string> = {
  running: SPINNER_FRAMES[0]!,
  done: "✓",
  ready: "◆",
  failed: "✗",
  unknown: "?",
}
