import { useEffect, useRef, useState } from "react"
import type { TextareaRenderable } from "@opentui/core"
import { getProjectFiles } from "./worktree.js"

// Pull the @-query out of the text up to the cursor position. Returns the
// partial filename the user has typed after the last "@" that hasn't been
// closed by whitespace, or null when no active mention is in progress.
//
// We only look at text up to the cursor so that an "@" typed in the middle of
// a prompt (with more text after it) still triggers the selector -- the text
// after the cursor is irrelevant to whether a mention is in progress.
//
// The "@" is only treated as a trigger when it appears at the start of the
// text or is immediately preceded by whitespace. Mid-word "@" (e.g. "foo@bar")
// is ignored.
export function getAtQuery(textBeforeCursor: string): string | null {
  const lastAt = textBeforeCursor.lastIndexOf("@")
  if (lastAt === -1) return null
  if (lastAt > 0 && !/\s/.test(textBeforeCursor[lastAt - 1]!)) return null
  const after = textBeforeCursor.slice(lastAt + 1)
  if (/\s/.test(after)) return null
  return after
}

// Score a candidate string against a query using a boundary-aware fuzzy
// algorithm. Returns -1 if the query characters don't all appear in order.
// Otherwise returns a score where lower is better.
//
// The core idea: matching at a word boundary (start of string, path separator,
// CamelCase transition, underscore, or dot) is a much stronger signal than
// matching mid-word. We reward those heavily so that "tin" ranks TaskInput
// above ContinueInput -- the T at position 0 is a boundary match, giving it
// a big advantage over the mid-word t-i-n run in ContinueInput.
//
// The algorithm tries all possible starting positions and picks the one that
// produces the best score, avoiding the greedy trap of committing to an early
// but weak mid-word match when a later boundary match would score better.
export function fuzzyScore(candidate: string, query: string): number {
  if (query.length === 0) return 0

  const lower = candidate.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const n = lower.length
  const m = lowerQuery.length

  // Precompute whether each position is a word boundary: start of string,
  // after a separator (/ _ . -), or a CamelCase transition (lowercase -> uppercase).
  const isBoundary = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const ch = candidate[i]!
    const prevCh = candidate[i - 1]
    const isUppercase = ch >= "A" && ch <= "Z"
    const prevIsLower = prevCh !== undefined && prevCh >= "a" && prevCh <= "z"
    if (
      i === 0 ||
      prevCh === "/" ||
      prevCh === "_" ||
      prevCh === "." ||
      prevCh === "-" ||
      (isUppercase && prevIsLower)
    ) {
      isBoundary[i] = 1
    }
  }

  // Score a greedy match starting from a given position in the candidate.
  // Returns INF if not all query characters are found from that position onward.
  // Boundary matches score -8, consecutive non-boundary matches score -4,
  // mid-word matches score -1. Gaps between matches cost +2 per skipped char.
  const INF = 1e9
  const scoreFrom = (startCi: number): number => {
    let score = 0
    let ci = startCi
    let lastMatchIdx = -1

    for (let qi = 0; qi < m; qi++) {
      let found = false
      while (ci < n) {
        if (lower[ci] === lowerQuery[qi]) {
          const gap = lastMatchIdx === -1 ? 0 : ci - lastMatchIdx - 1
          score += gap * 2
          if (isBoundary[ci]) {
            score += -8
          } else if (lastMatchIdx !== -1 && gap === 0) {
            score += -4
          } else {
            score += -1
          }
          lastMatchIdx = ci
          ci++
          found = true
          break
        }
        ci++
      }
      if (!found) return INF
    }

    return score
  }

  // Try starting the match at every position where the first query character
  // appears, and return the best (lowest) score found. This avoids the greedy
  // trap of committing to an early but weak match when a later boundary match
  // would rank higher.
  let best = INF
  for (let ci = 0; ci < n; ci++) {
    if (lower[ci] !== lowerQuery[0]) continue
    const s = scoreFrom(ci)
    if (s < best) best = s
  }

  return best === INF ? -1 : best
}

interface UseFileSelectorOptions {
  repoRoot: string
  textareaRef: React.RefObject<TextareaRenderable | null>
}

interface UseFileSelectorResult {
  suggestions: string[]
  selectedSuggestion: number
  hasSuggestions: boolean
  onContentChange: () => void
  onKeyDown: (key: { name: string; preventDefault: () => void }) => boolean
}

// Manages @-mention file autocomplete for a textarea. Returns the suggestion
// list, the currently selected index, and handlers to wire into the textarea.
//
// Returns true from onKeyDown when it has consumed the key (so the caller
// knows not to process it further), false otherwise.
export function useFileSelector({ repoRoot, textareaRef }: UseFileSelectorOptions): UseFileSelectorResult {
  const [projectFiles, setProjectFiles] = useState<string[]>([])
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [selectedSuggestion, setSelectedSuggestion] = useState(0)

  // Load the file list once on mount. We don't need to reload it because
  // git ls-files is cheap and the list won't change meaningfully mid-session.
  useEffect(() => {
    getProjectFiles(repoRoot).then(setProjectFiles).catch(() => {})
  }, [repoRoot])

  const projectFilesRef = useRef(projectFiles)
  projectFilesRef.current = projectFiles

  const onContentChange = () => {
    const textarea = textareaRef.current
    const text = textarea?.plainText ?? ""
    // Only look at the text up to the cursor. This means an "@" typed in the
    // middle of a prompt (with more words after it) correctly triggers the
    // selector -- whitespace that follows the cursor doesn't matter.
    const cursor = textarea?.cursorOffset ?? text.length
    const textBeforeCursor = text.slice(0, cursor)
    const query = getAtQuery(textBeforeCursor)

    if (query === null || projectFilesRef.current.length === 0) {
      setSuggestions([])
      setSelectedSuggestion(0)
      return
    }

    const matches = projectFilesRef.current
      .map((f) => {
        const filename = f.split("/").pop() ?? f
        const pathScore = fuzzyScore(f, query)
        const nameScore = fuzzyScore(filename, query)
        // Take whichever score is better (lower), ignoring -1 (no match).
        let best = -1
        if (pathScore !== -1 && nameScore !== -1) best = Math.min(pathScore, nameScore)
        else if (pathScore !== -1) best = pathScore
        else if (nameScore !== -1) best = nameScore
        return { f, score: best }
      })
      .filter(({ score }) => score !== -1)
      .sort((a, b) => a.score - b.score)
      .map(({ f }) => f)

    setSuggestions(matches)
    setSelectedSuggestion(0)
  }

  // Replace the current @-mention with the selected file.
  const commitSuggestion = (file: string) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const text = textarea.plainText
    // Use the cursor position to correctly split the text. Everything up to the
    // cursor replaces the @-query; everything from the cursor onward is preserved
    // as the trailing context. This handles mid-prompt mentions correctly.
    const cursor = textarea.cursorOffset
    const textBeforeCursor = text.slice(0, cursor)
    const textAfterCursor = text.slice(cursor)

    const lastAt = textBeforeCursor.lastIndexOf("@")
    if (lastAt === -1) return

    // "before" includes the "@" so we can keep it as part of the mention.
    const before = textBeforeCursor.slice(0, lastAt + 1)

    // Trailing space closes the mention so onContentChange won't re-open the list.
    const newText = before + file + " " + textAfterCursor
    textarea.replaceText(newText)
    textarea.cursorOffset = lastAt + 1 + file.length + 1
    setSuggestions([])
    setSelectedSuggestion(0)
  }

  const onKeyDown = (key: { name: string; preventDefault: () => void }): boolean => {
    if (suggestions.length === 0) return false

    // Only the first 6 suggestions are rendered, so cap navigation to that window.
    const navigableCount = Math.min(suggestions.length, 6)

    if (key.name === "up") {
      setSelectedSuggestion((i) => (i - 1 + navigableCount) % navigableCount)
      key.preventDefault()
      return true
    }
    if (key.name === "down") {
      setSelectedSuggestion((i) => (i + 1) % navigableCount)
      key.preventDefault()
      return true
    }
    if (key.name === "tab" || key.name === "return") {
      commitSuggestion(suggestions[selectedSuggestion]!)
      key.preventDefault()
      return true
    }
    if (key.name === "escape") {
      setSuggestions([])
      setSelectedSuggestion(0)
      key.preventDefault()
      return true
    }

    return false
  }

  return {
    suggestions,
    selectedSuggestion,
    hasSuggestions: suggestions.length > 0,
    onContentChange,
    onKeyDown,
  }
}
