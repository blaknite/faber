import { useState } from "react"
import { useKeyboard } from "@opentui/react"

interface Props {
  onSubmit: (prompt: string) => void
  onCancel: () => void
}

export function TaskInput({ onSubmit, onCancel }: Props) {
  const [value, setValue] = useState("")

  useKeyboard((key) => {
    if (key.name === "escape") {
      onCancel()
      return
    }
    if (key.name === "return" || key.name === "enter") {
      const trimmed = value.trim()
      if (trimmed) onSubmit(trimmed)
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

  return (
    <box border={["top"]} style={{ paddingLeft: 1 }}>
      <text><strong>New task: </strong>{value}<span bg="#ffffff" fg="#000000">{" "}</span></text>
    </box>
  )
}
