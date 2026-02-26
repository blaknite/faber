import { useRef, useState } from "react"
import type { TextareaRenderable } from "@opentui/core"
import { MODELS, DEFAULT_MODEL } from "../types.js"
import type { Model } from "../types.js"

interface Props {
  onSubmit: (prompt: string, model: Model) => void
  onCancel: () => void
}

const KEY_BINDINGS = [
  { name: "return", action: "submit" as const },
  { name: "return", shift: true, action: "newline" as const },
]

export function TaskInput({ onSubmit, onCancel }: Props) {
  const [modelIdx, setModelIdx] = useState(() => MODELS.findIndex((m) => m.value === DEFAULT_MODEL))
  const textareaRef = useRef<TextareaRenderable>(null)

  const model = MODELS[modelIdx]!

  return (
    <box border={["top"]} style={{ paddingTop: 1, paddingBottom: 1, paddingRight: 1, backgroundColor: "#222222" }}>
      <box
        border={["left"]}
        borderColor={model.color}
        style={{ paddingLeft: 1 }}
      >
        <text><strong>New task</strong></text>
        <text>{" "}</text>
        <textarea
          ref={textareaRef}
          minHeight={1}
          maxHeight={10}
          keyBindings={KEY_BINDINGS}
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
        <text>{" "}</text>
        <text fg={model.color}>{model.label}</text>
      </box>
    </box>
  )
}
