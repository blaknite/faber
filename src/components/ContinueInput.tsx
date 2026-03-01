import { useRef, useState } from "react"
import type { TextareaRenderable } from "@opentui/core"
import { KEY_BINDINGS, MIN_LINES, MAX_LINES } from "../lib/textarea.js"
import { DEFAULT_RESUME_PROMPT } from "../lib/agent.js"
import { MODELS, DEFAULT_MODEL } from "../types.js"
import type { Model } from "../types.js"

interface Props {
  onSubmit: (prompt?: string, model?: Model) => void
  onCancel: () => void
  defaultModel?: Model
  diffFiles?: string[]
}

// Pull the @-query out of a plain-text string. Returns the partial filename
// the user has typed after the last "@" that hasn't been closed by whitespace,
// or null when no active mention is in progress.
function getAtQuery(text: string): string | null {
  const lastAt = text.lastIndexOf("@")
  if (lastAt === -1) return null
  const after = text.slice(lastAt + 1)
  // If there's whitespace after the @, the mention is closed
  if (/\s/.test(after)) return null
  return after
}

export function ContinueInput({ onSubmit, onCancel, defaultModel, diffFiles = [] }: Props) {
  const [modelIdx, setModelIdx] = useState(() => MODELS.findIndex((m) => m.value === (defaultModel ?? DEFAULT_MODEL)))
  const [textareaHeight, setTextareaHeight] = useState(MIN_LINES)
  const textareaRef = useRef<TextareaRenderable>(null)

  // Autocomplete state
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [selectedSuggestion, setSelectedSuggestion] = useState(0)

  const model = MODELS[modelIdx]!
  const modelRef = useRef(model)
  modelRef.current = model

  const onContentChange = () => {
    const lines = textareaRef.current?.virtualLineCount ?? MIN_LINES
    setTextareaHeight(Math.min(Math.max(lines, MIN_LINES), MAX_LINES))

    const text = textareaRef.current?.plainText ?? ""
    const query = getAtQuery(text)

    if (query === null || diffFiles.length === 0) {
      setSuggestions([])
      setSelectedSuggestion(0)
      return
    }

    const lowerQuery = query.toLowerCase()
    const matches = diffFiles.filter((f) => {
      // Match against the full path and just the filename
      const filename = f.split("/").pop() ?? f
      return f.toLowerCase().startsWith(lowerQuery) || filename.toLowerCase().startsWith(lowerQuery)
    })

    setSuggestions(matches)
    setSelectedSuggestion(0)
  }

  // Replace the current @-mention with the selected file
  const commitSuggestion = (file: string) => {
    const text = textareaRef.current?.plainText ?? ""
    const lastAt = text.lastIndexOf("@")
    if (lastAt === -1) return

    // Build the replacement: everything up to and including @, then the file
    const before = text.slice(0, lastAt + 1)
    const after = text.slice(lastAt + 1)
    // Strip the partial query from `after` (up to first whitespace)
    const spaceIdx = after.search(/\s/)
    const rest = spaceIdx === -1 ? "" : after.slice(spaceIdx)

    const newText = before + file + rest
    textareaRef.current?.replaceText(newText)
    setSuggestions([])
    setSelectedSuggestion(0)
  }

  // textarea height + 1 spacer + 1 label
  const borderHeight = textareaHeight + 2

  const hasSuggestions = suggestions.length > 0
  // Each suggestion row is 1 line; cap visible rows at 8 so it doesn't
  // dominate the screen when there are many files.
  const visibleCount = Math.min(suggestions.length, 8)

  return (
    <box style={{ paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1, backgroundColor: "#111111", height: borderHeight + 2 }}>
      {hasSuggestions && (
        <box
          style={{
            position: "absolute",
            bottom: borderHeight + 2,
            left: 1,
            right: 1,
            height: visibleCount + 2,
            zIndex: 10,
          }}
          backgroundColor="#1a1a1a"
          border
          borderColor="#444444"
        >
          {suggestions.slice(0, 8).map((file, i) => {
            const isSelected = i === selectedSuggestion
            return (
              <box
                key={file}
                style={{ height: 1, paddingLeft: 1, paddingRight: 1, backgroundColor: isSelected ? "#2a2a2a" : "#1a1a1a" }}
              >
                <text fg={isSelected ? "#ffffff" : "#888888"}>{file}</text>
              </box>
            )
          })}
        </box>
      )}
      <box
        border={["left"]}
        borderColor={model.color}
        style={{ paddingLeft: 1, paddingRight: 1, flexDirection: "column", height: borderHeight }}
      >
        <textarea
          ref={textareaRef}
          minHeight={MIN_LINES}
          maxHeight={MAX_LINES}
          keyBindings={KEY_BINDINGS}
          onContentChange={onContentChange}
          placeholder={DEFAULT_RESUME_PROMPT}
          onSubmit={() => {
            const trimmed = textareaRef.current?.plainText.trim()
            onSubmit(trimmed || undefined, modelRef.current.value)
          }}
          onKeyDown={(key) => {
            if (hasSuggestions) {
              if (key.name === "up") {
                setSelectedSuggestion((i) => (i - 1 + suggestions.length) % suggestions.length)
                key.preventDefault()
                return
              }
              if (key.name === "down") {
                setSelectedSuggestion((i) => (i + 1) % suggestions.length)
                key.preventDefault()
                return
              }
              if (key.name === "tab") {
                commitSuggestion(suggestions[selectedSuggestion]!)
                key.preventDefault()
                return
              }
              if (key.name === "escape") {
                setSuggestions([])
                setSelectedSuggestion(0)
                key.preventDefault()
                return
              }
            }

            if (key.name === "escape") {
              const isEmpty = !textareaRef.current?.plainText.trim()
              if (isEmpty) {
                onCancel()
              } else {
                textareaRef.current?.clear()
              }
              key.preventDefault()
              return
            }
            if (key.name === "tab") {
              setModelIdx((i) => (i + 1) % MODELS.length)
              key.preventDefault()
            }
          }}
          focused
        />
        <box style={{ height: 1 }} />
        <text fg={model.color}>{model.label}  <span fg="#444444">[enter] submit  [esc] cancel  [tab] {hasSuggestions ? "select" : "model"}</span></text>
      </box>
    </box>
  )
}
