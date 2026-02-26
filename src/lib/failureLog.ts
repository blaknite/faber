import { appendFileSync, mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"

const FABER_DIR = ".faber"
const FAILURE_LOG = "failures.log"

function failureLogPath(repoRoot: string): string {
  return join(repoRoot, FABER_DIR, FAILURE_LOG)
}

export interface FailureEntry {
  taskId: string
  callSite: string
  reason: string
  exitCode?: number | null
  error?: string
  timestamp: string
}

// Appends a structured line to .faber/failures.log. Each line is a JSON object
// so the file stays machine-readable and easy to grep.
export function logTaskFailure(repoRoot: string, entry: Omit<FailureEntry, "timestamp">): void {
  const faberDir = join(repoRoot, FABER_DIR)
  if (!existsSync(faberDir)) {
    mkdirSync(faberDir, { recursive: true })
  }

  const line: FailureEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  }

  try {
    appendFileSync(failureLogPath(repoRoot), JSON.stringify(line) + "\n", "utf8")
  } catch {
    // Best-effort. If we can't write the log, don't crash the caller.
  }
}
