import { describe, expect, it } from "bun:test"
import { execaSync } from "execa"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { delimiter, join } from "node:path"
import { tmpdir } from "node:os"
import { execSync } from "node:child_process"
import { resolveReviewTarget } from "./reviewTarget.js"
import { createWorktree } from "./worktree.js"

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, { cwd, stdio: "pipe", encoding: "utf8" })
}

function ghInstalled(): boolean {
  try { execaSync("gh", ["--version"]); return true } catch { return false }
}

function makeRepo(): string {
  const root = join(tmpdir(), `faber-rt-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(root, { recursive: true })
  git(root, "init -b main")
  git(root, "config user.email person@example.com")
  git(root, 'config user.name "Person Example"')
  git(root, "commit --allow-empty -m initial")
  return root
}

function makePullRequestRepo(): { root: string; clone: string; prHeadSha: string } {
  const root = join(tmpdir(), `faber-pr-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const seed = join(root, "seed")
  const origin = join(root, "origin.git")
  const clone = join(root, "clone")

  mkdirSync(seed, { recursive: true })
  git(seed, "init -b main")
  git(seed, "config user.email person@example.com")
  git(seed, 'config user.name "Person Example"')
  writeFileSync(join(seed, "README.md"), "# test\n")
  git(seed, "add README.md")
  git(seed, 'commit -m "initial commit"')

  execSync(`git clone --bare ${seed} ${origin}`, { cwd: root, stdio: "pipe" })
  git(seed, `remote add origin ${origin}`)
  git(seed, "checkout -b pr-head")
  writeFileSync(join(seed, "pr.txt"), "pull request contents\n")
  git(seed, "add pr.txt")
  git(seed, 'commit -m "pr head commit"')
  const prHeadSha = git(seed, "rev-parse HEAD").trim()
  git(seed, "push origin main pr-head")
  git(origin, `update-ref refs/pull/251/head ${prHeadSha}`)

  execSync(`git clone ${origin} ${clone}`, { cwd: root, stdio: "pipe" })
  git(clone, "config user.email person@example.com")
  git(clone, 'config user.name "Person Example"')

  return { root, clone, prHeadSha }
}

function makeFakeGhBin(root: string): string {
  const binDir = join(root, "bin")
  const ghPath = join(binDir, "gh")

  mkdirSync(binDir, { recursive: true })
  writeFileSync(
    ghPath,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "gh 0.0.0"
  exit 0
fi

if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  printf '%s\n' '{"number":251,"url":"https://github.com/example/repo/pull/251","title":"Test pull request","baseRefName":"main","headRefName":"pr-head"}'
  exit 0
fi

echo "unexpected gh args: $@" >&2
exit 1
`,
    { mode: 0o755 },
  )

  return binDir
}

function addFetchHeadOnlyGitWrapper(binDir: string): void {
  const realGit = execSync("which git", { encoding: "utf8" }).trim()
  const gitPath = join(binDir, "git")

  writeFileSync(
    gitPath,
    `#!/bin/sh
if [ "$1" = "fetch" ] && [ "$2" = "origin" ] && [ "$3" = "refs/pull/251/head:refs/faber/pr-251" ]; then
  exec "${realGit}" fetch origin refs/pull/251/head
fi

exec "${realGit}" "$@"
`,
    { mode: 0o755 },
  )
}

function addRequireQualifiedPullRefGitWrapper(binDir: string): void {
  const realGit = execSync("which git", { encoding: "utf8" }).trim()
  const gitPath = join(binDir, "git")

  writeFileSync(
    gitPath,
    `#!/bin/sh
if [ "$1" = "fetch" ] && [ "$2" = "origin" ] && [ "$3" = "pull/251/head:refs/faber/pr-251" ]; then
  echo "fatal: couldn't find remote ref pull/251/head" >&2
  exit 128
fi

exec "${realGit}" "$@"
`,
    { mode: 0o755 },
  )
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

  it("returns a start point that still works after the synthetic PR ref is removed", async () => {
    const { root, clone, prHeadSha } = makePullRequestRepo()
    const fakeGhBin = makeFakeGhBin(root)
    const originalPath = process.env.PATH ?? ""
    process.env.PATH = `${fakeGhBin}${delimiter}${originalPath}`

    try {
      const target = await resolveReviewTarget(clone, { kind: "pullRequest", arg: "251" })
      expect(target.reviewBase).toBe("main")

      git(clone, "update-ref -d refs/faber/pr-251")

      const wtPath = await createWorktree(clone, "review-pr-251", target.worktreeBase)
      const wtSha = git(wtPath, "rev-parse HEAD").trim()
      expect(wtSha).toBe(prHeadSha)
    } finally {
      process.env.PATH = originalPath
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("falls back to FETCH_HEAD when fetch does not materialise refs/faber", async () => {
    const { root, clone, prHeadSha } = makePullRequestRepo()
    const fakeBin = makeFakeGhBin(root)
    addFetchHeadOnlyGitWrapper(fakeBin)
    const originalPath = process.env.PATH ?? ""
    process.env.PATH = `${fakeBin}${delimiter}${originalPath}`

    try {
      const target = await resolveReviewTarget(clone, { kind: "pullRequest", arg: "251" })

      const wtPath = await createWorktree(clone, "review-pr-fetch-head", target.worktreeBase)
      const wtSha = git(wtPath, "rev-parse HEAD").trim()
      expect(wtSha).toBe(prHeadSha)
    } finally {
      process.env.PATH = originalPath
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("fetches the fully-qualified refs/pull PR ref when shorthand pull refs are unavailable", async () => {
    const { root, clone, prHeadSha } = makePullRequestRepo()
    const fakeBin = makeFakeGhBin(root)
    addRequireQualifiedPullRefGitWrapper(fakeBin)
    const originalPath = process.env.PATH ?? ""
    process.env.PATH = `${fakeBin}${delimiter}${originalPath}`

    try {
      const target = await resolveReviewTarget(clone, { kind: "pullRequest", arg: "251" })

      const wtPath = await createWorktree(clone, "review-pr-qualified-ref", target.worktreeBase)
      const wtSha = git(wtPath, "rev-parse HEAD").trim()
      expect(wtSha).toBe(prHeadSha)
    } finally {
      process.env.PATH = originalPath
      rmSync(root, { recursive: true, force: true })
    }
  })
})
