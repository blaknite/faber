import { useSpinnerFrame } from "../lib/tick.js"

function RunningCountSpinner({ count }: { count: number }) {
  const frame = useSpinnerFrame()
  return <text fg="#00aaff">{frame} {count}</text>
}

interface HeaderBarProps {
  repoName: string
  currentBranch: string
  isDirty: boolean
  runningCount: number
  readyCount: number
}

export function HeaderBar({ repoName, currentBranch, isDirty, runningCount, readyCount }: HeaderBarProps) {
  return (
    <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222", flexDirection: "row", justifyContent: "space-between", height: 3 }}>
      <text><strong fg="#ff6600">faber</strong>{"  "}<span fg="#555555">{repoName}{currentBranch ? `:${currentBranch}` : ""}</span>{isDirty && <span fg="#ff6600">{" *"}</span>}</text>
      <box style={{ flexDirection: "row", gap: 1 }}>
        {runningCount > 0 && (
          <RunningCountSpinner count={runningCount} />
        )}
        {runningCount > 0 && readyCount > 0 && (
          <text fg="#555555">{"•"}</text>
        )}
        {readyCount > 0 && (
          <text fg="#ff9900">{"◆"} {readyCount}</text>
        )}
      </box>
    </box>
  )
}
