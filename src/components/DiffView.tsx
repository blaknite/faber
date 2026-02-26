import { useEffect, useState } from "react"
import { useKeyboard } from "@opentui/react"
import { getDiff } from "../lib/worktree.js"
import { DiffViewer } from "../lib/diff/index.js"
import type { ViewMode } from "../lib/diff/index.js"
import type { Task } from "../types.js"

interface Props {
  repoRoot: string
  task: Task
}

export function DiffView({ repoRoot, task }: Props) {
  const [diff, setDiff] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>("side-by-side")

  useKeyboard((key) => {
    if (key.name === "tab") {
      setViewMode((m) => m === "inline" ? "side-by-side" : "inline")
    }
  })

  useEffect(() => {
    setDiff(null)
    setError(null)
    getDiff(repoRoot, task.id)
      .then((output) => setDiff(output))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [repoRoot, task.id])

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <box border={["bottom"]} borderColor="#555555" style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#000000", flexDirection: "row", justifyContent: "space-between" }}>
        <text>
          <strong fg="#ffffff">{task.id.slice(0, 6)}</strong>
          {"  "}
          <span fg="#888888">diff vs HEAD</span>
        </text>
        <text>
          <span fg={viewMode === "inline" ? "#0088ff" : "#555555"}>inline</span>
          <span fg="#333333">{" / "}</span>
          <span fg={viewMode === "side-by-side" ? "#0088ff" : "#555555"}>side-by-side</span>
          <span fg="#888888">{" [tab]"}</span>
        </text>
      </box>

      {error != null ? (
        <box style={{ paddingLeft: 2, paddingTop: 1 }}>
          <text fg="#cc3333">{error}</text>
        </box>
      ) : diff == null ? (
        <box style={{ paddingLeft: 2, paddingTop: 1 }}>
          <text fg="#555555">Loading...</text>
        </box>
      ) : (
        <DiffViewer diff={diff} viewMode={viewMode} hideHeader />
      )}
    </box>
  )
}
