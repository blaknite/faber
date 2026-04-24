import { describe, expect, it } from "bun:test"
import { execaSync } from "execa"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execSync } from "node:child_process"
import { resolveReviewTarget } from "./reviewTarget.js"

function ghInstalled(): boolean {
  try { execaSync("gh", ["--version"]); return true } catch { return false }
}

function makeRepo(): string {
  const root = join(tmpdir(), `faber-rt-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(root, { recursive: true })
  execSync("git init -b main", { cwd: root, stdio: "pipe" })
  execSync("git config user.email test@test.com", { cwd: root, stdio: "pipe" })
  execSync("git config user.name Test", { cwd: root, stdio: "pipe" })
  execSync("git commit --allow-empty -m initial", { cwd: root, stdio: "pipe" })
  return root
}

describe("resolveReviewTarget pull request mode", () => {
  const hasGh = ghInstalled()

  it.skipIf(!hasGh)("rejects an argument that is neither a number nor a PR URL", async () => {
    const root = makeRepo()
    try {
      await expect(
        resolveReviewTarget(root, { kind: "pullRequest", arg: "not-a-valid-arg" }),
      ).rejects.toThrow(/Invalid --pull-request argument/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.skipIf(hasGh)("errors clearly when gh is not installed", async () => {
    const root = makeRepo()
    try {
      await expect(
        resolveReviewTarget(root, { kind: "pullRequest", arg: "123" }),
      ).rejects.toThrow(/gh CLI is required/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
