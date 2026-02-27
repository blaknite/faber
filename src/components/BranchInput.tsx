import { useRef } from "react"
import type { TextareaRenderable } from "@opentui/core"

interface Props {
  onSubmit: (branch: string) => void
  onCancel: () => void
}

const KEY_BINDINGS = [
  { name: "return", action: "submit" as const },
]

export function BranchInput({ onSubmit, onCancel }: Props) {
  const textareaRef = useRef<TextareaRenderable>(null)

  return (
    <box style={{ paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1, backgroundColor: "#111111", height: 5 }}>
      <box
        border={["left"]}
        borderColor="#666666"
        style={{ paddingLeft: 1, paddingRight: 1, flexDirection: "column", height: 3 }}
      >
        <textarea
          ref={textareaRef}
          minHeight={1}
          maxHeight={1}
          keyBindings={KEY_BINDINGS}
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
        <text fg="#555555">branch name  <span fg="#333333">[enter] switch  [esc] cancel</span></text>
      </box>
    </box>
  )
}
