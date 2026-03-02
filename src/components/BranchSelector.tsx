import { useEffect, useRef, useState } from "react"
import { RGBA } from "@opentui/core"
import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import { execSync } from "child_process"
import type { Task } from "../types.js"

interface Props {
  repoRoot: string
  tasks: Task[]
  currentBranch: string
  onSwitch: (branch: string) => void
  onCancel: () => void
}

function loadBranches(repoRoot: string): string[] {
  try {
    const out = execSync(
      'git branch --sort=-committerdate --format="%(refname:short)"',
      { cwd: repoRoot, encoding: "utf8" }
    )
    return out
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

export function BranchSelector({ repoRoot, tasks, currentBranch, onSwitch, onCancel }: Props) {
  const textareaRef = useRef<TextareaRenderable>(null)
  const scrollRef = useRef<ScrollBoxRenderable>(null)
  const [filter, setFilter] = useState("")
  const [branches, setBranches] = useState<string[]>([])
  const [cursorIdx, setCursorIdx] = useState(-1)

  useEffect(() => {
    setBranches(loadBranches(repoRoot))
  }, [repoRoot])

  const taskBranches = new Set(tasks.map((t) => t.id))
  const nonTaskBranches = branches.filter((b) => !taskBranches.has(b))

  const filtered = filter
    ? nonTaskBranches.filter((b) => b.toLowerCase().includes(filter.toLowerCase()))
    : nonTaskBranches

  // Clamp cursor when the filtered list shrinks
  useEffect(() => {
    setCursorIdx((prev) => {
      if (filtered.length === 0) return -1
      if (prev >= filtered.length) return filtered.length - 1
      return prev
    })
  }, [filtered.length])

  // Scroll the list to keep the highlighted row visible
  useEffect(() => {
    if (!scrollRef.current || cursorIdx < 0) return

    const scrollbox = scrollRef.current
    const top = cursorIdx
    const bottom = top + 1
    const viewportHeight = scrollbox.viewport.height
    const currentTop = scrollbox.scrollTop

    if (top < currentTop) {
      scrollbox.scrollTo(top)
    } else if (bottom > currentTop + viewportHeight) {
      scrollbox.scrollTo(bottom - viewportHeight)
    }
  }, [cursorIdx])

  // Count running/ready tasks per branch (branch name == task id)
  const taskCounts: Record<string, { running: number; ready: number }> = {}
  for (const task of tasks) {
    if (!taskCounts[task.id]) taskCounts[task.id] = { running: 0, ready: 0 }
    if (task.status === "running") taskCounts[task.id].running++
    if (task.status === "ready") taskCounts[task.id].ready++
  }

  function handleSubmit() {
    if (cursorIdx >= 0 && cursorIdx < filtered.length) {
      onSwitch(filtered[cursorIdx]!)
    } else {
      const trimmed = filter.trim()
      if (trimmed) onSwitch(trimmed)
    }
  }

  function handleKeyDown(key: { name: string; preventDefault: () => void }) {
    if (key.name === "escape") {
      onCancel()
      key.preventDefault()
      return
    }
    if (key.name === "up") {
      setCursorIdx((prev) => (prev <= 0 ? filtered.length - 1 : prev - 1))
      key.preventDefault()
      return
    }
    if (key.name === "down") {
      setCursorIdx((prev) => (prev >= filtered.length - 1 ? 0 : prev + 1))
      key.preventDefault()
      return
    }
    if (key.name === "return") {
      handleSubmit()
      key.preventDefault()
      return
    }
  }

  const { width: termWidth, height: termHeight } = useTerminalDimensions()

  const modalWidth = 60
  const listRows = Math.min(filtered.length, 10)
  const listHeight = Math.max(listRows, 1)
  // 3 = titlebar, 1 = input, 1 = gap, listHeight = list rows, 1 = bottom padding
  const modalHeight = 3 + 1 + 1 + listHeight + 1

  const modalTop = Math.floor((termHeight - modalHeight) / 3)
  const modalLeft = Math.floor((termWidth - modalWidth) / 2)

  return (
    <>
      <box
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: termWidth,
          height: termHeight,
          zIndex: 15,
          backgroundColor: RGBA.fromValues(0, 0, 0, 0.5),
        }}
      />
      <box
        style={{
          position: "absolute",
          top: modalTop,
          left: modalLeft,
          width: modalWidth,
          height: modalHeight,
          zIndex: 20,
          backgroundColor: "#111111",
          flexDirection: "column",
        }}
      >
      {/* Titlebar */}
      <box
        style={{
          paddingTop: 1,
          paddingBottom: 1,
          paddingLeft: 2,
          paddingRight: 2,
          flexDirection: "row",
          justifyContent: "space-between",
          height: 3,
        }}
      >
        <text fg="#555555">switch branch</text>
        <text fg="#333333">[enter] switch  [esc] cancel</text>
      </box>

      {/* Text input */}
      <box
        style={{
          paddingLeft: 2,
          paddingRight: 2,
          height: 1,
        }}
      >
        <box
          border={["left"]}
          borderColor="#666666"
          style={{ paddingLeft: 1, paddingRight: 1, height: 1 }}
        >
          <textarea
            ref={textareaRef}
            minHeight={1}
            maxHeight={1}
            onContentChange={() => {
              const val = textareaRef.current?.plainText ?? ""
              setFilter(val)
              setCursorIdx(-1)
            }}
            onSubmit={handleSubmit}
            onKeyDown={handleKeyDown}
            focused
          />
        </box>
      </box>

      {/* Branch list */}
      <box style={{ paddingTop: 1, paddingLeft: 2, paddingRight: 2, height: listHeight + 1 }}>
        <scrollbox ref={scrollRef} scrollY scrollX={false} style={{ flexGrow: 1 }}>
          <box style={{ flexDirection: "column" }}>
            {filtered.length === 0 ? (
              <box style={{ height: 1 }}>
                <text fg="#444444">{filter ? "no matches -- press enter to create" : "no branches"}</text>
              </box>
            ) : (
              filtered.map((branch, i) => {
                const isCurrent = branch === currentBranch
                const isSelected = i === cursorIdx
                const counts = taskCounts[branch]
                const hasRunning = counts && counts.running > 0
                const hasReady = counts && counts.ready > 0

                let indicator = ""
                if (hasRunning || hasReady) {
                  const parts: string[] = []
                  if (hasRunning) parts.push(`${counts!.running} running`)
                  if (hasReady) parts.push(`${counts!.ready} ready`)
                  indicator = `  [${parts.join(", ")}]`
                }

                const bgColor = isSelected ? "#D4963F" : "#111111"
                const fgColor = isSelected ? "#000000" : isCurrent ? "#ffffff" : "#888888"
                const marker = isCurrent ? "* " : "  "

                return (
                  <box key={branch} style={{ height: 1, backgroundColor: bgColor }}>
                    <text fg={fgColor}>{marker}{branch}{indicator}</text>
                  </box>
                )
              })
            )}
          </box>
        </scrollbox>
      </box>
    </box>
    </>
  )
}
