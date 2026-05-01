import { describe, it, expect } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execa } from "execa"
import { delimiter } from "node:path"

const SAMPLE_DIFF = `diff --git a/src/compute.ts b/src/compute.ts
index 0000001..0000002 100644
--- a/src/compute.ts
+++ b/src/compute.ts
@@ -35,10 +35,13 @@ import { helper } from "./helper.js"
 function setup() {
   return true
 }
+
+function removed() {
+  return false
+}
 
-function oldCompute(input: number) {
-  return input
-}
-
 function compute(input: number) {
+  const x = input * 2
   return x
 }
+
+function extra() {
+  return 42
+}
`

const SAMPLE_VIEW = JSON.stringify({
  headRepository: { name: "myrepo" },
  headRepositoryOwner: { login: "myorg" },
})

function makeFakeBin(root: string, viewOutput: string, diffOutput: string, viewExit = 0, diffExit = 0): string {
  const binDir = join(root, "bin")
  mkdirSync(binDir, { recursive: true })

  const ghPath = join(binDir, "gh")
  const diffFile = join(root, "diff.txt")
  writeFileSync(diffFile, diffOutput)

  writeFileSync(
    ghPath,
    `#!/bin/sh
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  printf '%s\\n' ${JSON.stringify(viewOutput)}
  exit ${viewExit}
fi
if [ "$1" = "pr" ] && [ "$2" = "diff" ]; then
  cat ${JSON.stringify(diffFile)}
  exit ${diffExit}
fi
echo "unexpected gh args: $@" >&2
exit 1
`,
    { mode: 0o755 },
  )

  return binDir
}

function makeFakeViewFailBin(root: string): string {
  const binDir = join(root, "bin")
  mkdirSync(binDir, { recursive: true })

  const ghPath = join(binDir, "gh")
  writeFileSync(
    ghPath,
    `#!/bin/sh
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  echo "gh: error: pull request not found" >&2
  exit 1
fi
echo "unexpected gh args: $@" >&2
exit 1
`,
    { mode: 0o755 },
  )

  return binDir
}

function makeFakeDiffFailBin(root: string): string {
  const binDir = join(root, "bin")
  mkdirSync(binDir, { recursive: true })

  const ghPath = join(binDir, "gh")
  writeFileSync(
    ghPath,
    `#!/bin/sh
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  printf '%s\\n' ${JSON.stringify(SAMPLE_VIEW)}
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "diff" ]; then
  echo "gh: error: could not get diff" >&2
  exit 1
fi
echo "unexpected gh args: $@" >&2
exit 1
`,
    { mode: 0o755 },
  )

  return binDir
}

async function runFaber(args: string[], binDir: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const originalPath = process.env.PATH ?? ""
  const env = { ...process.env, PATH: `${binDir}${delimiter}${originalPath}` }

  try {
    const result = await execa("bun", ["run", "src/index.tsx", "agent", ...args], {
      env,
      reject: false,
    })
    return {
      exitCode: result.exitCode ?? 0,
      stdout: result.stdout,
      stderr: result.stderr,
    }
  } catch (err: any) {
    return {
      exitCode: err.exitCode ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    }
  }
}

describe("faber agent comment-targets", () => {
  it("returns lines within ±5 of the given line in ascending order", async () => {
    const root = join(tmpdir(), `faber-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
    try {
      const binDir = makeFakeBin(root, SAMPLE_VIEW, SAMPLE_DIFF)
      const result = await runFaber(["comment-targets", "42", "src/compute.ts", "40"], binDir)

      expect(result.exitCode).toBe(0)
      const lines = result.stdout.split("\n").filter(Boolean)
      expect(lines.length).toBeGreaterThan(0)

      const lineNums = lines.map((l) => parseInt(l.split(":")[0]!, 10))
      for (const n of lineNums) {
        expect(n).toBeGreaterThanOrEqual(35)
        expect(n).toBeLessThanOrEqual(45)
      }

      for (let i = 1; i < lineNums.length; i++) {
        expect(lineNums[i]!).toBeGreaterThan(lineNums[i - 1]!)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("respects a custom --window value", async () => {
    const root = join(tmpdir(), `faber-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
    try {
      const binDir = makeFakeBin(root, SAMPLE_VIEW, SAMPLE_DIFF)
      const result = await runFaber(["comment-targets", "42", "src/compute.ts", "40", "--window", "10"], binDir)

      expect(result.exitCode).toBe(0)
      const lines = result.stdout.split("\n").filter(Boolean)
      const lineNums = lines.map((l) => parseInt(l.split(":")[0]!, 10))
      for (const n of lineNums) {
        expect(n).toBeGreaterThanOrEqual(30)
        expect(n).toBeLessThanOrEqual(50)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("--all emits every non-remove line", async () => {
    const root = join(tmpdir(), `faber-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
    try {
      const binDir = makeFakeBin(root, SAMPLE_VIEW, SAMPLE_DIFF)
      const result = await runFaber(["comment-targets", "42", "src/compute.ts", "--all"], binDir)

      expect(result.exitCode).toBe(0)
      const lines = result.stdout.split("\n").filter(Boolean)
      expect(lines.length).toBeGreaterThan(0)
      for (const line of lines) {
        expect(line).toMatch(/^\d+: /)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("exits 0 with empty output when path is not in the diff", async () => {
    const root = join(tmpdir(), `faber-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
    try {
      const binDir = makeFakeBin(root, SAMPLE_VIEW, SAMPLE_DIFF)
      const result = await runFaber(["comment-targets", "42", "src/nonexistent.ts", "--all"], binDir)

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe("")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("exits 0 with empty output when window misses every changed line", async () => {
    const root = join(tmpdir(), `faber-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
    try {
      const binDir = makeFakeBin(root, SAMPLE_VIEW, SAMPLE_DIFF)
      const result = await runFaber(["comment-targets", "42", "src/compute.ts", "1", "--window", "1"], binDir)

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe("")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("removed lines never appear even in --all mode", async () => {
    const root = join(tmpdir(), `faber-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
    try {
      const diffWithRemove = `diff --git a/src/foo.ts b/src/foo.ts
index 0000001..0000002 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,5 +1,5 @@
 function a() {
-  return 1
+  return 2
 }
 function b() {
   return 3
 }
`
      const binDir = makeFakeBin(root, SAMPLE_VIEW, diffWithRemove)
      const result = await runFaber(["comment-targets", "42", "src/foo.ts", "--all"], binDir)

      expect(result.exitCode).toBe(0)
      const lines = result.stdout.split("\n").filter(Boolean)
      const contents = lines.map((l) => l.split(": ").slice(1).join(": "))
      expect(contents).not.toContain("  return 1")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("context lines appear in output", async () => {
    const root = join(tmpdir(), `faber-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
    try {
      const diffWithContext = `diff --git a/src/foo.ts b/src/foo.ts
index 0000001..0000002 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,4 +1,4 @@
 function a() {
-  return 1
+  return 2
 }
 function b() {
`
      const binDir = makeFakeBin(root, SAMPLE_VIEW, diffWithContext)
      const result = await runFaber(["comment-targets", "42", "src/foo.ts", "--all"], binDir)

      expect(result.exitCode).toBe(0)
      const lines = result.stdout.split("\n").filter(Boolean)
      const contents = lines.map((l) => l.split(": ").slice(1).join(": "))
      expect(contents).toContain("function a() {")
      expect(contents).toContain("}")
      expect(contents).toContain("function b() {")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("exits 1 when both <line> and --all are given", async () => {
    const root = join(tmpdir(), `faber-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
    try {
      const binDir = makeFakeBin(root, SAMPLE_VIEW, SAMPLE_DIFF)
      const result = await runFaber(["comment-targets", "42", "src/compute.ts", "40", "--all"], binDir)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/mutually exclusive/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("exits 1 when neither <line> nor --all is given", async () => {
    const root = join(tmpdir(), `faber-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
    try {
      const binDir = makeFakeBin(root, SAMPLE_VIEW, SAMPLE_DIFF)
      const result = await runFaber(["comment-targets", "42", "src/compute.ts"], binDir)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/<line>|--all/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("exits 1 when <number> is missing", async () => {
    const root = join(tmpdir(), `faber-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
    try {
      const binDir = makeFakeBin(root, SAMPLE_VIEW, SAMPLE_DIFF)
      const result = await runFaber(["comment-targets"], binDir)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/<number>/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("exits 1 when <number> is not an integer", async () => {
    const root = join(tmpdir(), `faber-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
    try {
      const binDir = makeFakeBin(root, SAMPLE_VIEW, SAMPLE_DIFF)
      const result = await runFaber(["comment-targets", "abc", "src/compute.ts", "--all"], binDir)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/<number>/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("exits 1 when <path> is missing", async () => {
    const root = join(tmpdir(), `faber-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
    try {
      const binDir = makeFakeBin(root, SAMPLE_VIEW, SAMPLE_DIFF)
      const result = await runFaber(["comment-targets", "42"], binDir)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/<path>/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("exits 1 when <line> is not an integer", async () => {
    const root = join(tmpdir(), `faber-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
    try {
      const binDir = makeFakeBin(root, SAMPLE_VIEW, SAMPLE_DIFF)
      const result = await runFaber(["comment-targets", "42", "src/compute.ts", "abc"], binDir)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/<line>/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("exits 1 when --window is 0", async () => {
    const root = join(tmpdir(), `faber-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
    try {
      const binDir = makeFakeBin(root, SAMPLE_VIEW, SAMPLE_DIFF)
      const result = await runFaber(["comment-targets", "42", "src/compute.ts", "40", "--window", "0"], binDir)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/--window/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("exits 1 when --window is negative", async () => {
    const root = join(tmpdir(), `faber-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
    try {
      const binDir = makeFakeBin(root, SAMPLE_VIEW, SAMPLE_DIFF)
      const result = await runFaber(["comment-targets", "42", "src/compute.ts", "40", "--window", "-3"], binDir)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/--window/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("exits 1 when gh pr view fails", async () => {
    const root = join(tmpdir(), `faber-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
    try {
      const binDir = makeFakeViewFailBin(root)
      const result = await runFaber(["comment-targets", "42", "src/compute.ts", "--all"], binDir)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/gh pr view failed/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("exits 1 when gh pr diff fails", async () => {
    const root = join(tmpdir(), `faber-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
    try {
      const binDir = makeFakeDiffFailBin(root)
      const result = await runFaber(["comment-targets", "42", "src/compute.ts", "--all"], binDir)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/gh pr diff failed/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("exits 1 for an unknown verb", async () => {
    const root = join(tmpdir(), `faber-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
    try {
      const binDir = makeFakeBin(root, SAMPLE_VIEW, SAMPLE_DIFF)
      const result = await runFaber(["frobnicate"], binDir)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/unknown verb/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("exits 1 when no verb is given to agent", async () => {
    const root = join(tmpdir(), `faber-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
    try {
      const binDir = makeFakeBin(root, SAMPLE_VIEW, SAMPLE_DIFF)
      const result = await runFaber([], binDir)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/verb required/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
