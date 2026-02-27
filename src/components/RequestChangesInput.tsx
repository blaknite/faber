import { useRef, useState } from "react"
import type { TextareaRenderable } from "@opentui/core"

interface Props {
  onSubmit: (prompt: string) => void
  onCancel: () => void
}

const KEY_BINDINGS = [
  { name: "return", action: "submit" as const },
  { name: "return", shift: true, action: "newline" as const },
  { name: "return", ctrl: true, action: "newline" as const },
  { name: "return", meta: true, action: "newline" as const },
  { name: "j", ctrl: true, action: "newline" as const },
]

const MIN_LINES = 1
const MAX_LINES = 6

export function RequestChangesInput({ onSubmit, onCancel }: Props) {
  const [textareaHeight, setTextareaHeight] = useState(MIN_LINES)
  const textareaRef = useRef<TextareaRenderable>(null)

  const onContentChange = () => {
    const lines = textareaRef.current?.virtualLineCount ?? MIN_LINES
    setTextareaHeight(Math.min(Math.max(lines, MIN_LINES), MAX_LINES))
  }

  // textarea height + 1 spacer + 1 label
  const borderHeight = textareaHeight + 2

  return (
    <box style={{ paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1, backgroundColor: "#111111", height: borderHeight + 2 }}>
      <box
        border={["left"]}
        borderColor="#666666"
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
            if (trimmed) onSubmit(trimmed)
          }}
          onKeyDown={(key) => {
            if (key.name === "escape") {
              onCancel()
              key.preventDefault()
            }
          }}
          focused
        />
        <box style={{ height: 1 }} />
        <text fg="#555555">request changes  <span fg="#333333">[enter] submit  [esc] cancel</span></text>
      </box>
    </box>
  )
}
