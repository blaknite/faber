interface Binding {
  key: string
  label: string
  disabled?: boolean
}

interface Props {
  bindings: Binding[]
}

export function StatusBar({ bindings }: Props) {
  return (
    <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, flexDirection: "row", flexWrap: "no-wrap", backgroundColor: "#222222" }}>
      {bindings.map((b, i) => (
        b.disabled ? (
          <text key={b.key} fg="#2a2a2a" style={{ marginRight: i < bindings.length - 1 ? 3 : 0 }}>{`[${b.key}] ${b.label}`}</text>
        ) : (
          <text key={b.key} style={{ marginRight: i < bindings.length - 1 ? 3 : 0 }}>
            <strong>[{b.key}]</strong>{" "}{b.label}
          </text>
        )
      ))}
    </box>
  )
}
