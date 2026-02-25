import { useState } from "react"
import { useKeyboard } from "@opentui/react"
import { MODELS, DEFAULT_MODEL } from "../types.js"
import type { Model } from "../types.js"

interface Props {
  onSubmit: (prompt: string, model: Model) => void
  onCancel: () => void
}

export function TaskInput({ onSubmit, onCancel }: Props) {
  const [value, setValue] = useState("")
  const [modelIdx, setModelIdx] = useState(() => MODELS.findIndex((m) => m.value === DEFAULT_MODEL))

  useKeyboard((key) => {
    if (key.name === "escape") {
      onCancel()
      return
    }

    if (key.name === "return" || key.name === "enter") {
      const trimmed = value.trim()
      if (trimmed) onSubmit(trimmed, MODELS[modelIdx]!.value)
      return
    }

    if (key.name === "tab") {
      setModelIdx((i) => (i + 1) % MODELS.length)
      return
    }

    if (key.name === "backspace" || key.name === "delete") {
      setValue((v) => v.slice(0, -1))
      return
    }

    if (!key.ctrl && !key.meta && key.sequence) {
      setValue((v) => v + key.sequence)
    }
  })

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
        <text>{value}<span bg="#ffffff" fg="#000000">{" "}</span></text>
        <text>{" "}</text>
        <text fg={model.color}>{model.label}</text>
      </box>
    </box>
  )
}
