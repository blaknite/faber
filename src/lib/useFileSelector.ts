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
    const matches = projectFilesRef.current.filter((f) => {
      const filename = f.split("/").pop() ?? f
      return f.toLowerCase().startsWith(lowerQuery) || filename.toLowerCase().startsWith(lowerQuery)
    })

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
