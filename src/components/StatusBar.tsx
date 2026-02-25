interface Binding {
  key: string
  label: string
}

interface Props {
  bindings: Binding[]
}

export function StatusBar({ bindings }: Props) {
  return (
    <box border={["top"]} style={{ paddingLeft: 1, paddingRight: 1, flexDirection: "row", flexWrap: "no-wrap" }}>
      {bindings.map((b, i) => (
        <text key={b.key} style={{ marginRight: i < bindings.length - 1 ? 3 : 0 }}>
          <strong>[{b.key}]</strong>{" "}{b.label}
        </text>
      ))}
    </box>
  )
}
