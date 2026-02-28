interface Props {
  message: string
}

export function MergeSuccessView({ message }: Props) {
  return (
    <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000000" }}>
      <text fg="white">{message}</text>
    </box>
  )
}
