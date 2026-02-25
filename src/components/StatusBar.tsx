import React from "react"
import { Box, Text } from "ink"

interface Binding {
  key: string
  label: string
}

interface Props {
  bindings: Binding[]
}

export function StatusBar({ bindings }: Props) {
  return (
    <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} paddingX={1}>
      {bindings.map((b, i) => (
        <Box key={b.key} marginRight={i < bindings.length - 1 ? 3 : 0}>
          <Text bold>[{b.key}]</Text>
          <Text> {b.label}</Text>
        </Box>
      ))}
    </Box>
  )
}
