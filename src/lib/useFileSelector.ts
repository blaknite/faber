import { useEffect, useRef, useState } from "react"
import type { TextareaRenderable } from "@opentui/core"
import { getProjectFiles } from "./worktree.js"

// Pull the @-query out of a plain-text string. Returns the partial filename
// the user has typed after the last "@" that hasn't been closed by whitespace,
// or null when no active mention is in progress.
//
// The "@" is only treated as a trigger when it appears at the start of the
// text or is immediately preceded by whitespace. Mid-word "@" (e.g. "foo@bar")
// is ignored.
function getAtQuery(text: string): string | null {
  const lastAt = text.lastIndexOf("@")
  if (lastAt === -1) return null
  if (lastAt > 0 && !/\s/.test(text[lastAt - 1]!)) return null
  const after = text.slice(lastAt + 1)
  if (/\s/.test(after)) return null
  return after
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
    const text = textareaRef.current?.plainText ?? ""
    const query = getAtQuery(text)

    if (query === null || projectFilesRef.current.length === 0) {
      setSuggestions([])
      setSelectedSuggestion(0)
      return
    }

    const lowerQuery = query.toLowerCase()

    // Score a candidate string against the query using a simple fuzzy algorithm.
    // Returns -1 if the query characters don't all appear in order, otherwise
    // returns a score where lower is better. Consecutive matched characters and
    // matches at the start of the string are rewarded.
    const fuzzyScore = (candidate: string): number => {
      const lower = candidate.toLowerCase()
      let qi = 0
      let score = 0
      let lastMatchIdx = -1

      for (let ci = 0; ci < lower.length && qi < lowerQuery.length; ci++) {
        if (lower[ci] === lowerQuery[qi]) {
          // Consecutive matches cost nothing; gaps add to the score (higher = worse).
          const gap = ci - lastMatchIdx - 1
          score += lastMatchIdx === -1 ? ci : gap
          lastMatchIdx = ci
          qi++
        }
      }

      // Not all query characters were found -- no match.
      if (qi < lowerQuery.length) return -1

      return score
    }

    const matches = projectFilesRef.current
      .map((f) => {
        const filename = f.split("/").pop() ?? f
        const pathScore = fuzzyScore(f)
        const nameScore = fuzzyScore(filename)
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
    const lastAt = text.lastIndexOf("@")
    if (lastAt === -1) return

    const before = text.slice(0, lastAt + 1)
    const after = text.slice(lastAt + 1)
    const spaceIdx = after.search(/\s/)
    const rest = spaceIdx === -1 ? "" : after.slice(spaceIdx)

    // Trailing space closes the mention so onContentChange won't re-open the list.
    const newText = before + file + " " + rest
    textarea.replaceText(newText)
    textarea.cursorOffset = lastAt + 1 + file.length + 1
    setSuggestions([])
    setSelectedSuggestion(0)
  }

  const onKeyDown = (key: { name: string; preventDefault: () => void }): boolean => {
    if (suggestions.length === 0) return false

    if (key.name === "up") {
      setSelectedSuggestion((i) => (i - 1 + suggestions.length) % suggestions.length)
      key.preventDefault()
      return true
    }
    if (key.name === "down") {
      setSelectedSuggestion((i) => (i + 1) % suggestions.length)
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
