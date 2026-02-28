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
}

export function ContinueInput({ onSubmit, onCancel, defaultModel }: Props) {
  const [modelIdx, setModelIdx] = useState(() => MODELS.findIndex((m) => m.value === (defaultModel ?? DEFAULT_MODEL)))
  const [textareaHeight, setTextareaHeight] = useState(MIN_LINES)
  const textareaRef = useRef<TextareaRenderable>(null)

  const model = MODELS[modelIdx]!
  const modelRef = useRef(model)
  modelRef.current = model

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
        <text fg={model.color}>{model.label}  <span fg="#444444">[enter] submit  [esc] cancel  [tab] model</span></text>
      </box>
    </box>
  )
}
