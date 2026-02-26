import { useEffect, useRef, useState } from "react"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { getDiff } from "../lib/worktree.js"
import type { Task } from "../types.js"

function diffLineColor(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) return "#00cc66"
  if (line.startsWith("-") && !line.startsWith("---")) return "#cc3333"
  if (line.startsWith("@@")) return "#559999"
  if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) return "#888888"
  return "#666666"
}

interface Props {
  repoRoot: string
  task: Task
}

export function DiffView({ repoRoot, task }: Props) {
  const scrollRef = useRef<ScrollBoxRenderable>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useKeyboard((key) => {
    if (!scrollRef.current) return
    if (key.name === "up" || key.name === "k") {
      scrollRef.current.stickyScroll = false
      scrollRef.current.scrollBy(-3, "step")
    } else if (key.name === "down" || key.name === "j") {
      scrollRef.current.scrollBy(3, "step")
    } else if (key.name === "pageup") {
      scrollRef.current.stickyScroll = false
      scrollRef.current.scrollBy(-0.5, "viewport")
    } else if (key.name === "pagedown") {
      scrollRef.current.scrollBy(0.5, "viewport")
    }
  })

  useEffect(() => {
    setDiff(null)
    setError(null)
    getDiff(repoRoot, task.id)
      .then((output) => setDiff(output))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [repoRoot, task.id])

  const lines = diff != null ? diff.split("\n") : []

  return (
    <box style={{ flexDirection: "column", flexGrow: 1, paddingBottom: 1 }}>
      <box border={["bottom"]} borderColor="#555555" style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#000000" }}>
        <text>
          <strong fg="#ffffff">{task.id.slice(0, 6)}</strong>
          {"  "}
          <span fg="#888888">diff vs HEAD</span>
        </text>
      </box>

      <box style={{ flexGrow: 1, paddingLeft: 2, paddingRight: 2, paddingBottom: 1, overflow: "hidden" }}>
        <scrollbox ref={scrollRef} style={{ flexGrow: 1 }} scrollY scrollX={false} stickyScroll stickyStart="top" contentOptions={{ paddingRight: 1 }} viewportOptions={{ maxHeight: "100%" }}>
          <box style={{ flexDirection: "column" }}>
            {error != null ? (
              <text fg="#cc3333">{error}</text>
            ) : diff == null ? (
              <text fg="#555555">Loading...</text>
            ) : lines.length === 0 || (lines.length === 1 && lines[0] === "") ? (
              <text fg="#555555">No diff -- branch is identical to HEAD.</text>
            ) : (
              lines.map((line, i) => (
                <text key={i} fg={diffLineColor(line)}>{line}</text>
              ))
            )}
          </box>
        </scrollbox>
      </box>
    </box>
  )
}
