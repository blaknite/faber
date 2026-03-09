interface Binding {
  key: string
  label: string
  disabled?: boolean
  hidden?: boolean
  onAction?: () => void
}

interface Props {
  bindings: Binding[]
}

export function StatusBar({ bindings }: Props) {
  return (
    <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, flexDirection: "row", flexWrap: "no-wrap", backgroundColor: "#222222" }}>
      {bindings.filter(b => !b.hidden).map((b, i, visible) => (
        b.disabled ? (
          <text key={b.key} fg="#2a2a2a" style={{ marginRight: i < visible.length - 1 ? 3 : 0 }}>{`[${b.key}] ${b.label}`}</text>
        ) : (
          <text
            key={b.key}
            style={{ marginRight: i < visible.length - 1 ? 3 : 0 }}
            onMouseDown={(e: { button: number }) => { if (e.button === 0 && b.onAction) b.onAction() }}
          >
            <strong>[{b.key}]</strong>{" "}{b.label}
          </text>
        )
      ))}
    </box>
  )
}
