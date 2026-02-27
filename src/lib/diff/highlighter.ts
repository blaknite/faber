export interface Segment {
  text: string
  isChanged: boolean
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
