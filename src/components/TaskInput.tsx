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

export function TaskInput({ active, onSubmit, onCancel }: Props) {
  const [modelIdx, setModelIdx] = useState(() => MODELS.findIndex((m) => m.value === DEFAULT_MODEL))
  const textareaRef = useRef<TextareaRenderable>(null)

  const model = MODELS[modelIdx]!

  if (!active) {
    return (
      <box style={{ paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1, backgroundColor: "#111111" }}>
        <box border={["left"]} borderColor="#333333" style={{ paddingLeft: 1 }}>
          <text fg="#444444">Press [n] to create a new task</text>
        </box>
      </box>
    )
  }

  return (
    <box style={{ paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1, backgroundColor: "#111111" }}>
      <box
        border={true}
        borderColor={model.color}
        style={{ paddingLeft: 1, paddingRight: 1 }}
      >
        <box>
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
        </box>
        <box border={["top"]} borderColor={model.color} />
        <box style={{ paddingLeft: 1 }}>
          <text fg={model.color}>{model.label}</text>
        </box>
      </box>
    </box>
  )
}
