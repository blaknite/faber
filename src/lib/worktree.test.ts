import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execSync } from "node:child_process"
import {
  createWorktree,
  getDiff,
  gitFetchHeadPath,
  gitHeadPath,
  hasUnpushedCommits,
  mergeBranch,
  readCurrentBranch,
  removeWorktree,
  switchBranch,
  worktreeHasCommits,
  worktreePath,
} from "./worktree.js"

describe("worktreePath", () => {
  it("returns the expected path", () => {
    const path = worktreePath("/home/user/myrepo", "abc123-fix-thing")
    expect(path).toBe("/home/user/myrepo/.worktrees/abc123-fix-thing")
  })

  it("handles trailing slashes in repoRoot", () => {
    // join() normalises trailing slashes, so this should still work cleanly
    const path = worktreePath("/home/user/myrepo/", "abc123-fix-thing")
    expect(path).toBe("/home/user/myrepo/.worktrees/abc123-fix-thing")
  })

  it("places all worktrees under the same .worktrees directory", () => {
    const a = worktreePath("/repo", "aaa-task-one")
    const b = worktreePath("/repo", "bbb-task-two")
    expect(a).toStartWith("/repo/.worktrees/")
    expect(b).toStartWith("/repo/.worktrees/")
    expect(a).not.toBe(b)
  })
})

describe("gitHeadPath", () => {
  it("returns path to .git/HEAD", () => {
    expect(gitHeadPath("/repo")).toBe("/repo/.git/HEAD")
  })
})

describe("gitFetchHeadPath", () => {
  it("returns path to .git/FETCH_HEAD", () => {
    expect(gitFetchHeadPath("/repo")).toBe("/repo/.git/FETCH_HEAD")
  })
})

// --- Tests that require a real git repository ---

let tmpRoot: string

function git(args: string, cwd?: string) {
  execSync(`git ${args}`, { cwd: cwd ?? tmpRoot, stdio: "pipe" })
}

// Creates a bare-minimum git repo with one initial commit so we have a valid
// HEAD for worktree operations to branch from.
function initRepo() {
  tmpRoot = join(tmpdir(), `faber-wt-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpRoot, { recursive: true })
  git("init -b main")
  git("config user.email test@test.com")
  git("config user.name Test")
  writeFileSync(join(tmpRoot, "README.md"), "# test\n")
  git("add .")
  git('commit -m "initial commit"')
}

beforeEach(() => initRepo())
afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }))

describe("readCurrentBranch", () => {
  it("reads the current branch name from .git/HEAD", () => {
    expect(readCurrentBranch(tmpRoot)).toBe("main")
  })

  it("returns empty string when not inside a git repo", () => {
    const noGit = join(tmpdir(), `faber-no-git-${Date.now()}`)
    mkdirSync(noGit, { recursive: true })
    try {
      expect(readCurrentBranch(noGit)).toBe("")
    } finally {
      rmSync(noGit, { recursive: true, force: true })
    }
  })

  it("returns the updated branch after switching", () => {
    git("checkout -b feature-branch")
    expect(readCurrentBranch(tmpRoot)).toBe("feature-branch")
  })
})

describe("createWorktree", () => {
  it("creates a worktree directory and new branch", async () => {
    const path = await createWorktree(tmpRoot, "test-wt")
    expect(path).toBe(worktreePath(tmpRoot, "test-wt"))
    // The branch should exist
    const branches = execSync("git branch", { cwd: tmpRoot, encoding: "utf8" })
    expect(branches).toContain("test-wt")
  })

  it("returns the worktree path", async () => {
    const path = await createWorktree(tmpRoot, "another-wt")
    expect(path).toBe(join(tmpRoot, ".worktrees", "another-wt"))
  })
})

describe("removeWorktree", () => {
  it("removes the worktree and its branch", async () => {
    await createWorktree(tmpRoot, "to-remove")
    await removeWorktree(tmpRoot, "to-remove")
    const branches = execSync("git branch", { cwd: tmpRoot, encoding: "utf8" })
    expect(branches).not.toContain("to-remove")
  })
})

describe("worktreeHasCommits", () => {
  it("returns false when the branch has no new commits", async () => {
    await createWorktree(tmpRoot, "no-commits")
    const result = await worktreeHasCommits(tmpRoot, "no-commits")
    expect(result).toBe(false)
  })

  it("returns true when the branch has commits ahead of HEAD", async () => {
    const wtPath = await createWorktree(tmpRoot, "with-commits")
    writeFileSync(join(wtPath, "new-file.ts"), "export const x = 1\n")
    git("add .", wtPath)
    git('commit -m "add new file"', wtPath)
    const result = await worktreeHasCommits(tmpRoot, "with-commits")
    expect(result).toBe(true)
  })

  it("returns false for a non-existent branch", async () => {
    const result = await worktreeHasCommits(tmpRoot, "does-not-exist")
    expect(result).toBe(false)
  })
})

describe("getDiff", () => {
  it("returns an empty string when there are no differences", async () => {
    await createWorktree(tmpRoot, "no-diff")
    const diff = await getDiff(tmpRoot, "no-diff")
    expect(diff).toBe("")
  })

  it("returns the diff when the branch has changes", async () => {
    const wtPath = await createWorktree(tmpRoot, "has-diff")
    writeFileSync(join(wtPath, "file.ts"), "const y = 2\n")
    git("add .", wtPath)
    git('commit -m "add file"', wtPath)
    const diff = await getDiff(tmpRoot, "has-diff")
    expect(diff).toContain("file.ts")
    expect(diff).toContain("+const y = 2")
  })
})

describe("mergeBranch", () => {
  it("merges a branch with commits into the current branch", async () => {
    const wtPath = await createWorktree(tmpRoot, "merge-me")
    writeFileSync(join(wtPath, "merged.ts"), "export {}\n")
    git("add .", wtPath)
    git('commit -m "add merged.ts"', wtPath)

    await mergeBranch(tmpRoot, "merge-me")

    // The file should now exist on the main branch
    const log = execSync("git log --oneline", { cwd: tmpRoot, encoding: "utf8" })
    expect(log).toContain("add merged.ts")
  })

  it("throws on merge conflict and aborts cleanly", async () => {
    // Create a worktree branch that modifies README.md
    const wtPath = await createWorktree(tmpRoot, "conflict-branch")
    writeFileSync(join(wtPath, "README.md"), "# branch version\n")
    git("add .", wtPath)
    git('commit -m "branch edit"', wtPath)

    // Modify the same file on main so we get a conflict
    writeFileSync(join(tmpRoot, "README.md"), "# main version\n")
    git("add .", tmpRoot)
    git('commit -m "main edit"', tmpRoot)

    await expect(mergeBranch(tmpRoot, "conflict-branch")).rejects.toThrow()

    // The repo should not be left in a merge state
    const status = execSync("git status", { cwd: tmpRoot, encoding: "utf8" })
    expect(status).not.toContain("You have unmerged paths")
  })
})

describe("switchBranch", () => {
  it("switches to an existing branch", async () => {
    git("branch existing-branch")
    await switchBranch(tmpRoot, "existing-branch")
    expect(readCurrentBranch(tmpRoot)).toBe("existing-branch")
  })

  it("creates and switches to a new branch when it does not exist", async () => {
    await switchBranch(tmpRoot, "brand-new-branch")
    expect(readCurrentBranch(tmpRoot)).toBe("brand-new-branch")
  })
})

describe("hasUnpushedCommits", () => {
  it("returns true when there is no upstream (local-only repo)", async () => {
    // Our test repo has no remote, so this should return true
    const result = await hasUnpushedCommits(tmpRoot)
    expect(result).toBe(true)
  })
})
