export interface Segment {
  text: string
  isChanged: boolean
}

// Myers diff algorithm on character arrays.
// Returns an edit script as a sequence of operations.
type EditOp = { type: "equal" | "insert" | "delete"; text: string }

function myersDiff(oldChars: string[], newChars: string[]): EditOp[] {
  const n = oldChars.length
  const m = newChars.length
  const max = n + m

  if (max === 0) return []

  // v[k] = furthest x coordinate reached on diagonal k
  const v: number[] = new Array(2 * max + 1).fill(0)
  const trace: number[][] = []

  // Find shortest edit script length
  let found = false
  let foundD = 0
  for (let d = 0; d <= max; d++) {
    trace.push([...v])
    for (let k = -d; k <= d; k += 2) {
      const ki = k + max
      let x: number
      if (k === -d || (k !== d && v[ki - 1]! < v[ki + 1]!)) {
        x = v[ki + 1]!
      } else {
        x = v[ki - 1]! + 1
      }
      let y = x - k
      while (x < n && y < m && oldChars[x] === newChars[y]) {
        x++
        y++
      }
      v[ki] = x
      if (x >= n && y >= m) {
        found = true
        foundD = d
        break
      }
    }
    if (found) break
  }

  if (!found) {
    // Fallback: treat as a full replacement (shouldn't happen with valid input)
    const ops: EditOp[] = []
    if (n > 0) ops.push({ type: "delete", text: oldChars.join("") })
    if (m > 0) ops.push({ type: "insert", text: newChars.join("") })
    return ops
  }

  // Backtrack through the trace to build the edit script
  const ops: EditOp[] = []
  let x = n
  let y = m
  for (let d = foundD; d > 0; d--) {
    const savedV = trace[d]!
    const k = x - y
    const ki = k + max
    let prevK: number
    if (k === -d || (k !== d && savedV[ki - 1]! < savedV[ki + 1]!)) {
      prevK = k + 1
    } else {
      prevK = k - 1
    }
    const prevX = savedV[prevK + max]!
    const prevY = prevX - prevK

    // Walk back along the snake (equals)
    while (x > prevX + (x - y === prevX - prevY ? 0 : 1) && y > prevY + (x - y === prevX - prevY ? 0 : 1)) {
      // This is a diagonal move (equal)
      x--
      y--
    }

    // Re-walk the snake forward to collect equals
    let snakeX = prevX
    let snakeY = prevY
    if (prevK === k - 1) {
      // Delete: moved right on old string
      snakeX = prevX + 1
      snakeY = prevY
    } else {
      // Insert: moved down on new string
      snakeX = prevX
      snakeY = prevY + 1
    }

    // Equals along snake
    if (x > snakeX) {
      ops.unshift({ type: "equal", text: oldChars.slice(snakeX, x).join("") })
    }

    // The actual edit operation
    if (prevK === k - 1) {
      ops.unshift({ type: "delete", text: oldChars[prevX]! })
    } else {
      ops.unshift({ type: "insert", text: newChars[prevY]! })
    }

    x = prevX
    y = prevY
  }

  // Collect any remaining equals at the start
  if (x > 0) {
    ops.unshift({ type: "equal", text: oldChars.slice(0, x).join("") })
  }

  return ops
}

// A simpler, proven LCS-based approach for character-level diffing.
// This builds the LCS matrix and backtracks to produce segments.
function lcsHighlight(oldStr: string, newStr: string): { old: Segment[]; new: Segment[] } {
  const n = oldStr.length
  const m = newStr.length

  // For long strings, fall back to a whole-line change to avoid O(n*m) memory
  if (n * m > 50000) {
    return {
      old: n > 0 ? [{ text: oldStr, isChanged: true }] : [],
      new: m > 0 ? [{ text: newStr, isChanged: true }] : [],
    }
  }

  // Build LCS length table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldStr[i - 1] === newStr[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!)
      }
    }
  }

  // Backtrack to get edit ops
  const oldSegs: Segment[] = []
  const newSegs: Segment[] = []
  let i = n
  let j = m

  // Collect in reverse, then we'll flip at the end
  const oldOps: Array<{ text: string; isChanged: boolean }> = []
  const newOps: Array<{ text: string; isChanged: boolean }> = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldStr[i - 1] === newStr[j - 1]) {
      oldOps.push({ text: oldStr[i - 1]!, isChanged: false })
      newOps.push({ text: newStr[j - 1]!, isChanged: false })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      newOps.push({ text: newStr[j - 1]!, isChanged: true })
      j--
    } else {
      oldOps.push({ text: oldStr[i - 1]!, isChanged: true })
      i--
    }
  }

  // Reverse and merge consecutive same-kind segments
  function mergeSegs(ops: Array<{ text: string; isChanged: boolean }>): Segment[] {
    const reversed = ops.reverse()
    const merged: Segment[] = []
    for (const op of reversed) {
      const last = merged[merged.length - 1]
      if (last && last.isChanged === op.isChanged) {
        last.text += op.text
      } else {
        merged.push({ text: op.text, isChanged: op.isChanged })
      }
    }
    return merged
  }

  return {
    old: mergeSegs(oldOps),
    new: mergeSegs(newOps),
  }
}

// Exported function: given old and new line content, return highlighted segments for each.
export function highlightLinePair(
  oldContent: string,
  newContent: string
): { old: Segment[]; new: Segment[] } {
  return lcsHighlight(oldContent, newContent)
}

// For a single line with no counterpart, return it as a single changed segment.
export function highlightSingleLine(content: string): Segment[] {
  return [{ text: content, isChanged: true }]
}
