import { useRef, useState, useMemo } from "react"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { parseDiff } from "./parser.js"
import { highlightLinePair, highlightSingleLine } from "./highlighter.js"
import type { DiffLine, DiffFile, Hunk } from "./parser.js"
import type { Segment } from "./highlighter.js"
import { colors, styles } from "./DiffViewer.style.js"

export type ViewMode = "inline" | "side-by-side"

export interface DiffViewerProps {
  diff: string
  viewMode?: ViewMode
  hideHeader?: boolean
}

// Pair up removed/added lines within a hunk for character-level highlighting.
// Returns parallel arrays: removedLines[i] pairs with addedLines[i] (or null if unpaired).
interface PairedLines {
  removed: Array<{ line: DiffLine; segments: Segment[] }>
  added: Array<{ line: DiffLine; segments: Segment[] }>
}

function pairHunkLines(hunk: Hunk): PairedLines {
  const removes = hunk.lines.filter((l) => l.type === "remove")
  const adds = hunk.lines.filter((l) => l.type === "add")

  // Pair them up greedily by position
  const count = Math.max(removes.length, adds.length)
  const result: PairedLines = { removed: [], added: [] }

  for (let i = 0; i < count; i++) {
    const rem = removes[i]
    const add = adds[i]

    if (rem && add) {
      const { old: oldSegs, new: newSegs } = highlightLinePair(rem.content, add.content)
      result.removed.push({ line: rem, segments: oldSegs })
      result.added.push({ line: add, segments: newSegs })
    } else if (rem) {
      result.removed.push({ line: rem, segments: highlightSingleLine(rem.content) })
      // Placeholder so arrays stay parallel
      result.added.push({ line: { type: "add", content: "" }, segments: [] })
    } else if (add) {
      result.removed.push({ line: { type: "remove", content: "" }, segments: [] })
      result.added.push({ line: add, segments: highlightSingleLine(add.content) })
    }
  }

  return result
}

// Render a single highlighted segment inline.
// Each segment is a <span> so we can use bg for character-level highlighting.
function SegmentedLine({ segments, baseColor, highlightBg }: {
  segments: Segment[]
  baseColor: string
  highlightBg: string
}) {
  if (segments.length === 0) {
    return <text fg={baseColor}>{" "}</text>
  }
  return (
    <text fg={baseColor}>
      {segments.map((seg, i) =>
        seg.isChanged ? (
          <span key={i} fg={baseColor} bg={highlightBg}>{seg.text || " "}</span>
        ) : (
          <span key={i} fg={baseColor}>{seg.text || " "}</span>
        )
      )}
    </text>
  )
}

// A single line row: optional line number + content
function LineRow({ lineNum, color, segments, highlightBg, prefix }: {
  lineNum?: number
  color: string
  segments: Segment[]
  highlightBg: string
  prefix?: string
}) {
  const numStr = lineNum !== undefined ? String(lineNum).padStart(4, " ") : "    "
  return (
    <box style={{ flexDirection: "row" }}>
      <text fg={colors.lineNum}>{numStr} </text>
      {prefix !== undefined && <text fg={color}>{prefix}</text>}
      <SegmentedLine segments={segments} baseColor={color} highlightBg={highlightBg} />
    </box>
  )
}

// Empty row for side-by-side padding
function EmptyRow() {
  return (
    <box style={{ flexDirection: "row" }}>
      <text fg={colors.lineNum}>{"     "}</text>
    </box>
  )
}

// Context line (same in both old and new)
function ContextRow({ line }: { line: DiffLine }) {
  const numStr = line.oldLineNum !== undefined ? String(line.oldLineNum).padStart(4, " ") : "    "
  return (
    <box style={{ flexDirection: "row" }}>
      <text fg={colors.lineNum}>{numStr} </text>
      <text fg={colors.context}>{line.content}</text>
    </box>
  )
}

// Inline view: removed then added, both with character highlighting
function InlineHunk({ hunk }: { hunk: Hunk }) {
  // Walk lines in order, pairing consecutive remove/add blocks
  const renderedLines: React.ReactNode[] = []
  let i = 0
  const lines = hunk.lines

  while (i < lines.length) {
    const line = lines[i]!

    if (line.type === "context") {
      renderedLines.push(<ContextRow key={i} line={line} />)
      i++
      continue
    }

    // Collect a block of removes followed by adds
    const removeBlock: DiffLine[] = []
    const addBlock: DiffLine[] = []

    while (i < lines.length && lines[i]!.type === "remove") {
      removeBlock.push(lines[i]!)
      i++
    }
    while (i < lines.length && lines[i]!.type === "add") {
      addBlock.push(lines[i]!)
      i++
    }

    // Pair them for character-level highlighting
    const count = Math.max(removeBlock.length, addBlock.length)
    for (let j = 0; j < count; j++) {
      const rem = removeBlock[j]
      const add = addBlock[j]

      if (rem && add) {
        const { old: oldSegs, new: newSegs } = highlightLinePair(rem.content, add.content)
        renderedLines.push(
          <LineRow
            key={`rem-${i}-${j}`}
            lineNum={rem.oldLineNum}
            color={colors.remove}
            segments={oldSegs}
            highlightBg={colors.removeHighlight}
            prefix="-"
          />
        )
        renderedLines.push(
          <LineRow
            key={`add-${i}-${j}`}
            lineNum={add.newLineNum}
            color={colors.add}
            segments={newSegs}
            highlightBg={colors.addHighlight}
            prefix="+"
          />
        )
      } else if (rem) {
        renderedLines.push(
          <LineRow
            key={`rem-${i}-${j}`}
            lineNum={rem.oldLineNum}
            color={colors.remove}
            segments={highlightSingleLine(rem.content)}
            highlightBg={colors.removeHighlight}
            prefix="-"
          />
        )
      } else if (add) {
        renderedLines.push(
          <LineRow
            key={`add-${i}-${j}`}
            lineNum={add.newLineNum}
            color={colors.add}
            segments={highlightSingleLine(add.content)}
            highlightBg={colors.addHighlight}
            prefix="+"
          />
        )
      }
    }
  }

  return <box style={{ flexDirection: "column" }}>{renderedLines}</box>
}

// Side-by-side hunk: two columns, left=removed right=added
function SideBySideHunk({ hunk }: { hunk: Hunk }) {
  // Interleave context lines with paired remove/add blocks.
  // We need to produce synchronized rows across both columns.
  const leftRows: React.ReactNode[] = []
  const rightRows: React.ReactNode[] = []

  let i = 0
  const lines = hunk.lines

  while (i < lines.length) {
    const line = lines[i]!

    if (line.type === "context") {
      const numStr = line.oldLineNum !== undefined ? String(line.oldLineNum).padStart(4, " ") : "    "
      const newNumStr = line.newLineNum !== undefined ? String(line.newLineNum).padStart(4, " ") : "    "
      leftRows.push(
        <box key={`cl-${i}`} style={{ flexDirection: "row" }}>
          <text fg={colors.lineNum}>{numStr} </text>
          <text fg={colors.context}>{line.content}</text>
        </box>
      )
      rightRows.push(
        <box key={`cr-${i}`} style={{ flexDirection: "row" }}>
          <text fg={colors.lineNum}>{newNumStr} </text>
          <text fg={colors.context}>{line.content}</text>
        </box>
      )
      i++
      continue
    }

    // Collect a block of removes followed by adds
    const removeBlock: DiffLine[] = []
    const addBlock: DiffLine[] = []

    while (i < lines.length && lines[i]!.type === "remove") {
      removeBlock.push(lines[i]!)
      i++
    }
    while (i < lines.length && lines[i]!.type === "add") {
      addBlock.push(lines[i]!)
      i++
    }

    // Pair them and emit synchronized rows
    const count = Math.max(removeBlock.length, addBlock.length)
    for (let j = 0; j < count; j++) {
      const rem = removeBlock[j]
      const add = addBlock[j]

      if (rem && add) {
        const { old: oldSegs, new: newSegs } = highlightLinePair(rem.content, add.content)
        leftRows.push(
          <LineRow
            key={`l-${i}-${j}`}
            lineNum={rem.oldLineNum}
            color={colors.remove}
            segments={oldSegs}
            highlightBg={colors.removeHighlight}
          />
        )
        rightRows.push(
          <LineRow
            key={`r-${i}-${j}`}
            lineNum={add.newLineNum}
            color={colors.add}
            segments={newSegs}
            highlightBg={colors.addHighlight}
          />
        )
      } else if (rem) {
        leftRows.push(
          <LineRow
            key={`l-${i}-${j}`}
            lineNum={rem.oldLineNum}
            color={colors.remove}
            segments={highlightSingleLine(rem.content)}
            highlightBg={colors.removeHighlight}
          />
        )
        rightRows.push(<EmptyRow key={`r-${i}-${j}`} />)
      } else if (add) {
        leftRows.push(<EmptyRow key={`l-${i}-${j}`} />)
        rightRows.push(
          <LineRow
            key={`r-${i}-${j}`}
            lineNum={add.newLineNum}
            color={colors.add}
            segments={highlightSingleLine(add.content)}
            highlightBg={colors.addHighlight}
          />
        )
      }
    }
  }

  return (
    <box style={styles.sideBySideRow}>
      <box style={styles.sideBySideColumn}>
        {leftRows}
      </box>
      <box style={{ width: 1, flexShrink: 0 }}>
        <text fg={colors.separator}>{"│"}</text>
      </box>
      <box style={styles.sideBySideColumn}>
        {rightRows}
      </box>
    </box>
  )
}

function FileSection({ file, viewMode, fileIndex }: {
  file: DiffFile
  viewMode: ViewMode
  fileIndex: number
}) {
  return (
    <box key={fileIndex} style={{ flexDirection: "column" }}>
      <box style={styles.fileHeader}>
        <text fg={colors.meta}>{file.oldPath !== file.newPath
          ? `${file.oldPath} -> ${file.newPath}`
          : file.newPath || file.oldPath}</text>
      </box>
      {file.hunks.map((hunk, hi) => (
        <box key={hi} style={{ flexDirection: "column" }}>
          <box style={styles.hunkHeader}>
            <text fg={colors.header}>{hunk.header}</text>
          </box>
          {viewMode === "inline"
            ? <InlineHunk hunk={hunk} />
            : <SideBySideHunk hunk={hunk} />}
        </box>
      ))}
    </box>
  )
}

// Mode toggle button in the header
function ModeToggle({ viewMode, onToggle }: { viewMode: ViewMode; onToggle: () => void }) {
  return (
    <box style={{ flexDirection: "row" }}>
      <text
        fg={viewMode === "inline" ? colors.modeActive : colors.modeInactive}
      >inline</text>
      <text fg={colors.separator}>{" / "}</text>
      <text
        fg={viewMode === "side-by-side" ? colors.modeActive : colors.modeInactive}
      >side-by-side</text>
      <text fg={colors.meta}>{" [tab]"}</text>
    </box>
  )
}

export function DiffViewer({ diff, viewMode: controlledViewMode, hideHeader = false }: DiffViewerProps) {
  const scrollRef = useRef<ScrollBoxRenderable>(null)
  const [internalViewMode, setInternalViewMode] = useState<ViewMode>(controlledViewMode ?? "side-by-side")

  // If a controlled viewMode is passed, use it; otherwise use internal state.
  const viewMode = controlledViewMode ?? internalViewMode

  const parsed = useMemo(() => parseDiff(diff), [diff])

  useKeyboard((key) => {
    const scroll = scrollRef.current
    if (key.name === "k" || key.name === "up") {
      if (!scroll) return
      scroll.stickyScroll = false
      scroll.scrollBy(-3, "step")
    } else if (key.name === "j" || key.name === "down") {
      if (!scroll) return
      scroll.scrollBy(3, "step")
    } else if (key.name === "pageup") {
      if (!scroll) return
      scroll.stickyScroll = false
      scroll.scrollBy(-0.5, "viewport")
    } else if (key.name === "pagedown") {
      if (!scroll) return
      scroll.scrollBy(0.5, "viewport")
    } else if (key.name === "g") {
      if (!scroll) return
      scroll.stickyScroll = false
      scroll.scrollBy(-Infinity, "step")
    } else if (key.name === "G") {
      if (!scroll) return
      scroll.scrollBy(Infinity, "step")
    } else if (key.name === "tab") {
      if (!controlledViewMode) {
        setInternalViewMode((m) => m === "inline" ? "side-by-side" : "inline")
      }
    }
  })

  const isEmpty = parsed.files.length === 0 || parsed.files.every((f) => f.hunks.length === 0)

  return (
    <box style={styles.root}>
      {!hideHeader && (
        <box border={["bottom"]} borderColor={colors.border} style={styles.header}>
          <text fg={colors.meta}>diff</text>
          {!controlledViewMode && (
            <ModeToggle
              viewMode={viewMode}
              onToggle={() => setInternalViewMode((m) => m === "inline" ? "side-by-side" : "inline")}
            />
          )}
        </box>
      )}
      <box style={styles.scrollArea}>
        <scrollbox
          ref={scrollRef}
          style={{ flexGrow: 1 }}
          scrollY
          scrollX={false}
          stickyScroll
          stickyStart="top"
          contentOptions={{ paddingRight: 1 }}
          viewportOptions={{ maxHeight: "100%" }}
        >
          <box style={styles.scrollContent}>
            {isEmpty ? (
              <text fg={colors.context}>No diff -- branch is identical to HEAD.</text>
            ) : (
              parsed.files.map((file, fi) => (
                <FileSection key={fi} file={file} viewMode={viewMode} fileIndex={fi} />
              ))
            )}
          </box>
        </scrollbox>
      </box>
    </box>
  )
}
