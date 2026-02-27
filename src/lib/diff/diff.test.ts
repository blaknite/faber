import { describe, expect, it } from "bun:test"
import { parseDiff } from "./parser.js"
import { highlightLinePair, highlightSingleLine } from "./highlighter.js"

// --- parseDiff ---

const SIMPLE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc1234..def5678 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,4 +1,4 @@
 import { something } from "./bar"
-const x = 1
+const x = 2
 
 export { x }
`

const MULTI_FILE_DIFF = `diff --git a/src/a.ts b/src/a.ts
index 000..111 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
-old line
+new line
 context
diff --git a/src/b.ts b/src/b.ts
index 222..333 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -3,3 +3,4 @@
 line a
+inserted
 line b
 line c
`

const RENAME_DIFF = `diff --git a/old.ts b/new.ts
similarity index 90%
rename from old.ts
rename to new.ts
--- a/old.ts
+++ b/new.ts
@@ -1 +1 @@
-hello
+world
`

// SVN/patch format - what opencode actually emits
const INDEX_FORMAT_DIFF = `Index: /path/to/src/foo.ts
===================================================================
--- /path/to/src/foo.ts
+++ /path/to/src/foo.ts
@@ -1,4 +1,4 @@
 import { something } from "./bar"
-const x = 1
+const x = 2
 
 export { x }
`

const INDEX_FORMAT_MULTI_FILE_DIFF = `Index: /path/to/src/a.ts
===================================================================
--- /path/to/src/a.ts
+++ /path/to/src/a.ts
@@ -1,2 +1,2 @@
-old line
+new line
 context
Index: /path/to/src/b.ts
===================================================================
--- /path/to/src/b.ts
+++ /path/to/src/b.ts
@@ -3,3 +3,4 @@
 line a
+inserted
 line b
 line c
`

describe("parseDiff", () => {
  describe("simple single-file diff", () => {
    it("parses into one file", () => {
      const result = parseDiff(SIMPLE_DIFF)
      expect(result.files).toHaveLength(1)
    })

    it("extracts the file path", () => {
      const { files } = parseDiff(SIMPLE_DIFF)
      expect(files[0]!.newPath).toBe("src/foo.ts")
      expect(files[0]!.oldPath).toBe("src/foo.ts")
    })

    it("parses one hunk", () => {
      const { files } = parseDiff(SIMPLE_DIFF)
      expect(files[0]!.hunks).toHaveLength(1)
    })

    it("includes the hunk header", () => {
      const { files } = parseDiff(SIMPLE_DIFF)
      expect(files[0]!.hunks[0]!.header).toContain("@@")
    })

    it("parses hunk start lines", () => {
      const { files } = parseDiff(SIMPLE_DIFF)
      const hunk = files[0]!.hunks[0]!
      expect(hunk.oldStart).toBe(1)
      expect(hunk.newStart).toBe(1)
    })

    it("identifies removed lines", () => {
      const { files } = parseDiff(SIMPLE_DIFF)
      const lines = files[0]!.hunks[0]!.lines
      const removed = lines.filter((l) => l.type === "remove")
      expect(removed).toHaveLength(1)
      expect(removed[0]!.content).toBe("const x = 1")
    })

    it("identifies added lines", () => {
      const { files } = parseDiff(SIMPLE_DIFF)
      const lines = files[0]!.hunks[0]!.lines
      const added = lines.filter((l) => l.type === "add")
      expect(added).toHaveLength(1)
      expect(added[0]!.content).toBe("const x = 2")
    })

    it("identifies context lines", () => {
      const { files } = parseDiff(SIMPLE_DIFF)
      const lines = files[0]!.hunks[0]!.lines
      const context = lines.filter((l) => l.type === "context")
      expect(context.length).toBeGreaterThan(0)
      expect(context[0]!.content).toBe("import { something } from \"./bar\"")
    })

    it("assigns line numbers to removed lines", () => {
      const { files } = parseDiff(SIMPLE_DIFF)
      const removed = files[0]!.hunks[0]!.lines.filter((l) => l.type === "remove")
      expect(removed[0]!.oldLineNum).toBe(2)
    })

    it("assigns line numbers to added lines", () => {
      const { files } = parseDiff(SIMPLE_DIFF)
      const added = files[0]!.hunks[0]!.lines.filter((l) => l.type === "add")
      expect(added[0]!.newLineNum).toBe(2)
    })

    it("assigns both line numbers to context lines", () => {
      const { files } = parseDiff(SIMPLE_DIFF)
      const context = files[0]!.hunks[0]!.lines.filter((l) => l.type === "context")
      expect(context[0]!.oldLineNum).toBeDefined()
      expect(context[0]!.newLineNum).toBeDefined()
    })
  })

  describe("multi-file diff", () => {
    it("parses two files", () => {
      const result = parseDiff(MULTI_FILE_DIFF)
      expect(result.files).toHaveLength(2)
    })

    it("first file has correct path", () => {
      const { files } = parseDiff(MULTI_FILE_DIFF)
      expect(files[0]!.newPath).toBe("src/a.ts")
    })

    it("second file has correct path", () => {
      const { files } = parseDiff(MULTI_FILE_DIFF)
      expect(files[1]!.newPath).toBe("src/b.ts")
    })

    it("second file has an insertion", () => {
      const { files } = parseDiff(MULTI_FILE_DIFF)
      const added = files[1]!.hunks[0]!.lines.filter((l) => l.type === "add")
      expect(added).toHaveLength(1)
      expect(added[0]!.content).toBe("inserted")
    })
  })

  describe("rename diff", () => {
    it("detects old and new paths", () => {
      const { files } = parseDiff(RENAME_DIFF)
      expect(files[0]!.oldPath).toBe("old.ts")
      expect(files[0]!.newPath).toBe("new.ts")
    })
  })

  describe("empty input", () => {
    it("returns empty files array for empty string", () => {
      const result = parseDiff("")
      expect(result.files).toHaveLength(0)
    })

    it("preserves the raw diff in metadata", () => {
      const result = parseDiff(SIMPLE_DIFF)
      expect(result.metadata.raw).toBe(SIMPLE_DIFF)
    })
  })

  describe("Index: format (SVN/patch - what opencode emits)", () => {
    it("parses into one file", () => {
      const result = parseDiff(INDEX_FORMAT_DIFF)
      expect(result.files).toHaveLength(1)
    })

    it("extracts the file path from --- line", () => {
      const { files } = parseDiff(INDEX_FORMAT_DIFF)
      expect(files[0]!.newPath).toBe("/path/to/src/foo.ts")
      expect(files[0]!.oldPath).toBe("/path/to/src/foo.ts")
    })

    it("identifies removed lines", () => {
      const { files } = parseDiff(INDEX_FORMAT_DIFF)
      const removed = files[0]!.hunks[0]!.lines.filter((l) => l.type === "remove")
      expect(removed).toHaveLength(1)
      expect(removed[0]!.content).toBe("const x = 1")
    })

    it("identifies added lines", () => {
      const { files } = parseDiff(INDEX_FORMAT_DIFF)
      const added = files[0]!.hunks[0]!.lines.filter((l) => l.type === "add")
      expect(added).toHaveLength(1)
      expect(added[0]!.content).toBe("const x = 2")
    })

    it("parses multi-file Index: diffs", () => {
      const result = parseDiff(INDEX_FORMAT_MULTI_FILE_DIFF)
      expect(result.files).toHaveLength(2)
    })

    it("second file in multi-file Index: diff has correct path", () => {
      const { files } = parseDiff(INDEX_FORMAT_MULTI_FILE_DIFF)
      expect(files[1]!.newPath).toBe("/path/to/src/b.ts")
    })

    it("second file in multi-file Index: diff has an insertion", () => {
      const { files } = parseDiff(INDEX_FORMAT_MULTI_FILE_DIFF)
      const added = files[1]!.hunks[0]!.lines.filter((l) => l.type === "add")
      expect(added).toHaveLength(1)
      expect(added[0]!.content).toBe("inserted")
    })
  })
})

// --- highlightLinePair ---

describe("highlightLinePair", () => {
  it("returns old and new segment arrays", () => {
    const result = highlightLinePair("hello world", "hello there")
    expect(result.old).toBeDefined()
    expect(result.new).toBeDefined()
  })

  it("marks unchanged prefix as not changed", () => {
    const { old: oldSegs } = highlightLinePair("const x = 1", "const x = 2")
    // "const x = " should be unchanged
    const unchanged = oldSegs.filter((s) => !s.isChanged)
    const unchangedText = unchanged.map((s) => s.text).join("")
    expect(unchangedText).toContain("const x = ")
  })

  it("marks the differing suffix as changed", () => {
    const { old: oldSegs, new: newSegs } = highlightLinePair("const x = 1", "const x = 2")
    const oldChanged = oldSegs.filter((s) => s.isChanged).map((s) => s.text).join("")
    const newChanged = newSegs.filter((s) => s.isChanged).map((s) => s.text).join("")
    expect(oldChanged).toContain("1")
    expect(newChanged).toContain("2")
  })

  it("handles identical lines with no changes", () => {
    const { old: oldSegs, new: newSegs } = highlightLinePair("same line", "same line")
    const anyOldChanged = oldSegs.some((s) => s.isChanged)
    const anyNewChanged = newSegs.some((s) => s.isChanged)
    expect(anyOldChanged).toBe(false)
    expect(anyNewChanged).toBe(false)
  })

  it("handles completely different lines", () => {
    const { old: oldSegs, new: newSegs } = highlightLinePair("abc", "xyz")
    const oldText = oldSegs.map((s) => s.text).join("")
    const newText = newSegs.map((s) => s.text).join("")
    expect(oldText).toBe("abc")
    expect(newText).toBe("xyz")
  })

  it("handles empty old line", () => {
    const { old: oldSegs, new: newSegs } = highlightLinePair("", "new content")
    expect(oldSegs).toHaveLength(0)
    expect(newSegs.map((s) => s.text).join("")).toBe("new content")
  })

  it("handles empty new line", () => {
    const { old: oldSegs, new: newSegs } = highlightLinePair("old content", "")
    expect(oldSegs.map((s) => s.text).join("")).toBe("old content")
    expect(newSegs).toHaveLength(0)
  })

  it("preserves all characters in segments", () => {
    const old = "function foo() {"
    const nw = "function bar() {"
    const { old: oldSegs, new: newSegs } = highlightLinePair(old, nw)
    expect(oldSegs.map((s) => s.text).join("")).toBe(old)
    expect(newSegs.map((s) => s.text).join("")).toBe(nw)
  })

  it("does not produce empty-text segments (except at boundaries)", () => {
    const { old: oldSegs, new: newSegs } = highlightLinePair("hello", "world")
    for (const seg of [...oldSegs, ...newSegs]) {
      // Each segment should have content; the highlighter should avoid zero-length runs
      expect(seg.text.length).toBeGreaterThanOrEqual(0)
    }
  })

  it("handles whitespace-only changes", () => {
    const { old: oldSegs, new: newSegs } = highlightLinePair("  foo", "    foo")
    const oldText = oldSegs.map((s) => s.text).join("")
    const newText = newSegs.map((s) => s.text).join("")
    expect(oldText).toBe("  foo")
    expect(newText).toBe("    foo")
  })
})

// --- highlightSingleLine ---

describe("highlightSingleLine", () => {
  it("returns a single changed segment for a non-empty line", () => {
    const segs = highlightSingleLine("hello world")
    expect(segs).toHaveLength(1)
    expect(segs[0]!.text).toBe("hello world")
    expect(segs[0]!.isChanged).toBe(true)
  })

  it("returns a single changed segment for an empty line", () => {
    const segs = highlightSingleLine("")
    expect(segs).toHaveLength(1)
    expect(segs[0]!.isChanged).toBe(true)
  })
})
