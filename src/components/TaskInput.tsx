import { useState, useEffect } from "react"
import { useKeyboard, useAppContext } from "@opentui/react"
import type { PasteEvent } from "@opentui/core"
import { MODELS, DEFAULT_MODEL } from "../types.js"
import type { Model } from "../types.js"

interface Props {
  onSubmit: (prompt: string, model: Model) => void
  onCancel: () => void
}

export function TaskInput({ onSubmit, onCancel }: Props) {
  const [value, setValue] = useState("")
  const [cursorPos, setCursorPos] = useState(0)
  const [modelIdx, setModelIdx] = useState(() => MODELS.findIndex((m) => m.value === DEFAULT_MODEL))
  const { keyHandler } = useAppContext()

  useEffect(() => {
    if (!keyHandler) return
    const handler = (event: PasteEvent) => {
      setValue((v) => {
        const next = v.slice(0, cursorPos) + event.text + v.slice(cursorPos)
        setCursorPos(cursorPos + event.text.length)
        return next
      })
    }
    keyHandler.on("paste", handler)
    return () => { keyHandler.off("paste", handler) }
  }, [keyHandler, cursorPos])

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

    if (key.name === "left") {
      setCursorPos((p) => Math.max(0, p - 1))
      return
    }

    if (key.name === "right") {
      setCursorPos((p) => Math.min(value.length, p + 1))
      return
    }

    if (key.name === "home" || (key.ctrl && key.name === "a")) {
      setCursorPos(0)
      return
    }

    if (key.name === "end" || (key.ctrl && key.name === "e")) {
      setCursorPos(value.length)
      return
    }

    if (key.name === "backspace") {
      if (cursorPos === 0) return
      setValue((v) => v.slice(0, cursorPos - 1) + v.slice(cursorPos))
      setCursorPos((p) => p - 1)
      return
    }

    if (key.name === "delete") {
      setValue((v) => v.slice(0, cursorPos) + v.slice(cursorPos + 1))
      return
    }

    if (!key.ctrl && !key.meta && key.sequence.length === 1) {
      setValue((v) => v.slice(0, cursorPos) + key.sequence + v.slice(cursorPos))
      setCursorPos((p) => p + 1)
    }
  })

  const model = MODELS[modelIdx]!
  const before = value.slice(0, cursorPos)
  const after = value.slice(cursorPos)

  return (
    <box border={["top"]} style={{ paddingTop: 1, paddingBottom: 1, paddingRight: 1, backgroundColor: "#222222" }}>
      <box
        border={["left"]}
        borderColor={model.color}
        style={{ paddingLeft: 1 }}
      >
        <text><strong>New task</strong></text>
        <text>{" "}</text>
        <text>{before}<span bg="#ffffff" fg="#000000">{after.length > 0 ? after[0] : " "}</span>{after.slice(1)}</text>
        <text>{" "}</text>
        <text fg={model.color}>{model.label}</text>
      </box>
    </box>
  )
}
