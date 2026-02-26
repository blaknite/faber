export type DiffLineType = "add" | "remove" | "context"

export interface DiffLine {
  type: DiffLineType
  content: string
  oldLineNum?: number
  newLineNum?: number
}

export interface Hunk {
  header: string
  lines: DiffLine[]
  oldStart: number
  newStart: number
}

export interface DiffFile {
  oldPath: string
  newPath: string
  hunks: Hunk[]
}

export interface DiffMetadata {
  raw: string
}

export interface ParsedDiff {
  files: DiffFile[]
  metadata: DiffMetadata
}

// Parse the @@ -a,b +c,d @@ header line
function parseHunkHeader(header: string): { oldStart: number; newStart: number } {
  const match = header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
  if (!match) return { oldStart: 1, newStart: 1 }
  return { oldStart: parseInt(match[1]!, 10), newStart: parseInt(match[2]!, 10) }
}

export function parseDiff(raw: string): ParsedDiff {
  const lines = raw.split("\n")
  const files: DiffFile[] = []

  let currentFile: DiffFile | null = null
  let currentHunk: Hunk | null = null
  let oldLineNum = 1
  let newLineNum = 1

  for (const line of lines) {
    // New file diff header
    if (line.startsWith("diff ")) {
      if (currentHunk && currentFile) {
        currentFile.hunks.push(currentHunk)
        currentHunk = null
      }
      if (currentFile) {
        files.push(currentFile)
      }
      currentFile = { oldPath: "", newPath: "", hunks: [] }
      continue
    }

    if (currentFile === null) continue

    // File path headers
    if (line.startsWith("--- ")) {
      currentFile.oldPath = line.slice(4).replace(/^a\//, "")
      continue
    }
    if (line.startsWith("+++ ")) {
      currentFile.newPath = line.slice(4).replace(/^b\//, "")
      continue
    }

    // Skip index/mode lines
    if (line.startsWith("index ") || line.startsWith("new file ") || line.startsWith("deleted file ") || line.startsWith("old mode ") || line.startsWith("new mode ")) {
      continue
    }

    // Hunk header
    if (line.startsWith("@@")) {
      if (currentHunk) {
        currentFile.hunks.push(currentHunk)
      }
      const { oldStart, newStart } = parseHunkHeader(line)
      oldLineNum = oldStart
      newLineNum = newStart
      currentHunk = { header: line, lines: [], oldStart, newStart }
      continue
    }

    if (currentHunk === null) continue

    // Diff content lines
    if (line.startsWith("+")) {
      currentHunk.lines.push({ type: "add", content: line.slice(1), newLineNum })
      newLineNum++
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({ type: "remove", content: line.slice(1), oldLineNum })
      oldLineNum++
    } else if (line.startsWith(" ") || line === "") {
      // context line (space prefix or empty -- trailing newline artifacts)
      const content = line.startsWith(" ") ? line.slice(1) : ""
      currentHunk.lines.push({ type: "context", content, oldLineNum, newLineNum })
      oldLineNum++
      newLineNum++
    }
    // Ignore "\ No newline at end of file" etc.
  }

  // Flush remaining
  if (currentHunk && currentFile) {
    currentFile.hunks.push(currentHunk)
  }
  if (currentFile) {
    files.push(currentFile)
  }

  return { files, metadata: { raw } }
}
