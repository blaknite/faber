import { useEffect, useRef, useState } from "react"
import type { TextareaRenderable } from "@opentui/core"
import { TIERS, TIER_ORDER, DEFAULT_TIER } from "../types.js"
import type { Tier } from "../types.js"
import { KEY_BINDINGS, MIN_LINES, MAX_LINES } from "../lib/textarea.js"
import { useFileSelector } from "../lib/useFileSelector.js"

interface Props {
  repoRoot: string
  active: boolean
  onActivate: () => void
  onSubmit: (prompt: string, tier: Tier) => void
  onCancel: () => void
}

export function TaskInput({ repoRoot, active, onActivate, onSubmit, onCancel }: Props) {
  const [tier, setTier] = useState<Tier>(DEFAULT_TIER)
  const [textareaHeight, setTextareaHeight] = useState(MIN_LINES)
  const textareaRef = useRef<TextareaRenderable>(null)

  const tierMeta = TIERS[tier]
  const tierRef = useRef(tier)
  tierRef.current = tier

  const { suggestions, selectedSuggestion, hasSuggestions, onContentChange: onFileSelectorContentChange, onKeyDown: onFileSelectorKeyDown } = useFileSelector({ repoRoot, textareaRef })

  useEffect(() => {
    if (!active) setTextareaHeight(MIN_LINES)
  }, [active])

  const onContentChange = () => {
    const lines = textareaRef.current?.virtualLineCount ?? MIN_LINES
    setTextareaHeight(Math.min(Math.max(lines, MIN_LINES), MAX_LINES))
    onFileSelectorContentChange()
  }

  // textarea height + 1 spacer + 1 label
  const borderHeight = textareaHeight + 2

  // Each suggestion row is 1 line; cap visible rows at 6.
  const visibleCount = Math.min(suggestions.length, 6)

  return (
    <box style={{ paddingBottom: 1, paddingLeft: 1, paddingRight: 1, height: borderHeight + 2 }}>
      <box key={active ? "active" : "inactive"} style={{ paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1, height: borderHeight + 2, backgroundColor: "#111111" }}>
        {!active ? (
          <box
            border={["left"]}
            borderColor={tierMeta.dimColor}
            style={{ paddingLeft: 1, paddingRight: 1, flexDirection: "column", height: borderHeight }}
            onMouseDown={(e) => { if (e.button === 0) onActivate() }}
          >
            <text fg="#444444">Press [n] to create a new task</text>
            <box style={{ height: 1 }} />
            <text fg={tierMeta.dimColor}>{tierMeta.label}</text>
          </box>
        ) : (
          <>
            {hasSuggestions && (
              <box
                style={{
                  position: "absolute",
                  bottom: borderHeight + 3,
                  left: 0,
                  right: 0,
                  paddingTop: 1,
                  height: visibleCount,
                  zIndex: 10,
                }}
                backgroundColor="#111111"
              >
                {suggestions.slice(0, 6).map((suggestion, i) => {
                  const isSelected = i === selectedSuggestion
                  return (
                    <box
                      key={suggestion.value}
                      style={{ height: 1, paddingLeft: 1, paddingRight: 1, backgroundColor: isSelected ? "#D4963F" : "#111111" }}
                    >
                      <text fg={isSelected ? "#000000" : "#888888"}>{suggestion.value}</text>
                    </box>
                  )
                })}
              </box>
            )}
            <box
              border={["left"]}
              borderColor={tierMeta.color}
              style={{ paddingLeft: 1, paddingRight: 1, flexDirection: "column", height: borderHeight }}
            >
              <textarea
                ref={textareaRef}
                minHeight={MIN_LINES}
                maxHeight={MAX_LINES}
                keyBindings={KEY_BINDINGS}
                onContentChange={onContentChange}
                onSubmit={() => {
                  const trimmed = textareaRef.current?.plainText.trim()
                  if (trimmed) onSubmit(trimmed, tierRef.current)
                }}
                onKeyDown={(key) => {
                  if (onFileSelectorKeyDown(key)) return

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
                    setTier((t) => TIER_ORDER[(TIER_ORDER.indexOf(t) + 1) % TIER_ORDER.length])
                    key.preventDefault()
                  }
                }}
                focused
              />
              <box style={{ height: 1 }} />
              <text fg={tierMeta.color}>{tierMeta.label}  <span fg="#444444">[enter] submit  [esc] cancel  [tab] {hasSuggestions ? "select" : "model"}</span></text>
            </box>
          </>
        )}
      </box>
    </box>
  )
}
