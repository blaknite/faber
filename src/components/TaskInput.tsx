import React, { useState } from "react"
import { Box, Text, useInput } from "ink"

interface Props {
  onSubmit: (prompt: string) => void
  onCancel: () => void
}

export function TaskInput({ onSubmit, onCancel }: Props) {
  const [value, setValue] = useState("")

  useInput((input, key) => {
    if (key.escape) {
      onCancel()
      return
    }
    if (key.return) {
      const trimmed = value.trim()
      if (trimmed) onSubmit(trimmed)
      return
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1))
      return
    }
    if (!key.ctrl && !key.meta && input) {
      setValue((v) => v + input)
    }
  })

  return (
    <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} paddingX={1}>
      <Text bold>New task: </Text>
      <Text>{value}</Text>
      <Text inverse> </Text>
    </Box>
  )
}
