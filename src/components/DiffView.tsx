import { useEffect, useMemo, useState } from "react"
import { useKeyboard } from "@opentui/react"
import { SyntaxStyle } from "@opentui/core"
import { getDiff } from "../lib/worktree.js"
import { DiffViewer } from "../lib/diff/index.js"
import type { ViewMode } from "../lib/diff/index.js"
import { readLogEntries, readLogStats, formatElapsed } from "../lib/logParser.js"
import { useSpinnerFrame } from "../lib/tick.js"
import { STATUS_COLOR, STATUS_LABEL, STATUS_SYMBOL } from "../lib/status.js"
import { getModelContextWindow } from "../types.js"
import type { Task } from "../types.js"

const syntaxStyle = SyntaxStyle.create()

interface Props {
  repoRoot: string
  task: Task
  disabled?: boolean
}

function LastMessage({ repoRoot, task }: { repoRoot: string; task: Task }) {
  const entries = useMemo(() => readLogEntries(repoRoot, task.id), [repoRoot, task.id])
  const lastText = useMemo(() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i]!.kind === "text" && entries[i]!.text) return entries[i]!.text!
    }
    return null
  }, [entries])

  if (!lastText) return null

  return (
    <box
      border={["left"]}
      borderColor="#444444"
      style={{ paddingLeft: 1, paddingRight: 1, flexDirection: "column" }}
    >
      <markdown
        content={lastText}
        syntaxStyle={syntaxStyle}
        style={{ flexGrow: 1, flexShrink: 1 }}
        renderNode={(token, context) => {
          const renderable = context.defaultRender()
          if (renderable && token.type === "paragraph" && "wrapMode" in renderable) {
            (renderable as any).wrapMode = "word"
          }
          return renderable
        }}
      />
    </box>
  )
}

function DiffLoadingSpinner() {
  const frame = useSpinnerFrame()
  return (
    <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
      <text fg="#555555">{frame} Loading diff...</text>
    </box>
  )
}

export function DiffView({ repoRoot, task, disabled }: Props) {
  const [diff, setDiff] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showLoading, setShowLoading] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>("side-by-side")

  const stats = readLogStats(repoRoot, task.id)
  const contextPercent = stats.totalTokens > 0
    ? Math.round((stats.totalTokens / getModelContextWindow(task.model)) * 100)
    : null

  useKeyboard((key) => {
    if (disabled) return
    if (key.name === "tab") {
      setViewMode((m) => m === "inline" ? "side-by-side" : "inline")
    }
  })

  useEffect(() => {
    setDiff(null)
    setError(null)
    setShowLoading(false)

    const timer = setTimeout(() => setShowLoading(true), 300)

    getDiff(repoRoot, task.id)
      .then((output) => setDiff(output))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => clearTimeout(timer))

    return () => clearTimeout(timer)
  }, [repoRoot, task.id])

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#111111", flexDirection: "row", justifyContent: "space-between", marginBottom: 1 }}>
        <text>
          <strong fg="#ffffff">{task.id.slice(0, 6)}</strong>
          {"  "}
          {task.completedAt
            ? <>
                <span fg={STATUS_COLOR[task.status]}>{STATUS_SYMBOL[task.status]} {STATUS_LABEL[task.status]}</span>
                {"  "}
                <span fg="#555555">{formatElapsed(task.startedAt, task.completedAt, new Date(task.completedAt).getTime())}</span>
              </>
            : <>
                <span fg={STATUS_COLOR[task.status]}>{STATUS_LABEL[task.status]}</span>
                {"  "}
                <span fg="#555555">{formatElapsed(task.startedAt, null, Date.now())}</span>
              </>}
          {"  "}
          <span fg="#444444">diff vs HEAD</span>
        </text>
        <box style={{ flexDirection: "row", gap: 2 }}>
          <text fg="#666666">
            {[
              task.sessionId ?? null,
              contextPercent !== null ? `${contextPercent}%` : null,
              stats.totalCost > 0 ? `$${stats.totalCost.toFixed(2)}` : null,
            ].filter(Boolean).join(" • ")}
          </text>
          <text>
            <span fg={viewMode === "inline" ? "#ff6600" : "#555555"}>inline</span>
            <span fg="#333333">{" / "}</span>
            <span fg={viewMode === "side-by-side" ? "#ff6600" : "#555555"}>side-by-side</span>
            <span fg="#888888">{" [tab]"}</span>
          </text>
        </box>
      </box>

      {error != null ? (
        <box style={{ paddingLeft: 2, paddingTop: 1 }}>
          <text fg="#cc3333">{error}</text>
        </box>
      ) : diff == null ? (
        showLoading ? <DiffLoadingSpinner /> : null
      ) : (
        <DiffViewer diff={diff} viewMode={viewMode} hideHeader headerContent={<LastMessage repoRoot={repoRoot} task={task} />} disabled={disabled} />
      )}
    </box>
  )
}
