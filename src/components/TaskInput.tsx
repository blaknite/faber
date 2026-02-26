import { useRef, useState } from "react"
import type { TextareaRenderable } from "@opentui/core"
import { MODELS, DEFAULT_MODEL } from "../types.js"
import type { Model } from "../types.js"

interface Props {
  active: boolean
  onSubmit: (prompt: string, model: Model) => void
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
const MAX_LINES = 10

export function TaskInput({ active, onSubmit, onCancel }: Props) {
  const [modelIdx, setModelIdx] = useState(() => MODELS.findIndex((m) => m.value === DEFAULT_MODEL))
  const [textareaHeight, setTextareaHeight] = useState(MIN_LINES)
  const textareaRef = useRef<TextareaRenderable>(null)

  const model = MODELS[modelIdx]!

  const onContentChange = () => {
    const lines = textareaRef.current?.virtualLineCount ?? MIN_LINES
    setTextareaHeight(Math.min(Math.max(lines, MIN_LINES), MAX_LINES))
  }

  // textarea height + 1 spacer + 1 label
  const borderHeight = textareaHeight + 2

  return (
    <box key={active ? "active" : "inactive"} style={{ paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1, backgroundColor: "#111111", height: active ? borderHeight + 2 : 3 }}>
      {!active ? (
        <box border={["left"]} borderColor="#333333" style={{ paddingLeft: 1 }}>
          <text fg="#444444">Press [n] to create a new task</text>
        </box>
      ) : (
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
            onSubmit={() => {
              const trimmed = textareaRef.current?.plainText.trim()
              if (trimmed) onSubmit(trimmed, model.value)
            }}
            onKeyDown={(key) => {
              if (key.name === "escape") {
                onCancel()
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
          <text fg={model.color}>{model.label} {textareaHeight}</text>
        </box>
      )}
    </box>
  )
}
