import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execSync } from "node:child_process"
import {
  createWorktree,
  getDiff,
  getProjectDirectories,
  getProjectFiles,
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
  it("happy path: rebase is a no-op and ff merge succeeds", async () => {
    // Branch is cut from HEAD with no divergence on main -- rebase does nothing,
    // ff-only merge moves HEAD forward.
    const wtPath = await createWorktree(tmpRoot, "merge-me")
    writeFileSync(join(wtPath, "merged.ts"), "export {}\n")
    git("add .", wtPath)
    git('commit -m "add merged.ts"', wtPath)

    await mergeBranch(tmpRoot, "merge-me")

    const log = execSync("git log --oneline", { cwd: tmpRoot, encoding: "utf8" })
    expect(log).toContain("add merged.ts")
    // Fast-forward: no merge commit, so only one extra line in the log
    const lines = log.trim().split("\n")
    expect(lines.length).toBe(2)
  })

  it("diverged branch: rebase replays commits, then ff merge succeeds", async () => {
    // Create a branch, then advance main -- the branch is now behind HEAD.
    const wtPath = await createWorktree(tmpRoot, "diverged-branch")
    writeFileSync(join(wtPath, "feature.ts"), "export const a = 1\n")
    git("add .", wtPath)
    git('commit -m "add feature"', wtPath)

    // Advance main with an unrelated commit
    writeFileSync(join(tmpRoot, "other.ts"), "export const b = 2\n")
    git("add .", tmpRoot)
    git('commit -m "unrelated change on main"', tmpRoot)

    await mergeBranch(tmpRoot, "diverged-branch")

    const log = execSync("git log --oneline", { cwd: tmpRoot, encoding: "utf8" })
    expect(log).toContain("add feature")
    expect(log).toContain("unrelated change on main")
    // Linear history: no merge commit
    expect(log).not.toContain("Merge branch")
  })

  it("conflict during rebase: aborts cleanly and throws", async () => {
    // Both main and the branch edit the same lines of README.md.
    const wtPath = await createWorktree(tmpRoot, "conflict-branch")
    writeFileSync(join(wtPath, "README.md"), "# branch version\n")
    git("add .", wtPath)
    git('commit -m "branch edit"', wtPath)

    // Advance main with a conflicting change so the rebase cannot replay cleanly
    writeFileSync(join(tmpRoot, "README.md"), "# main version\n")
    git("add .", tmpRoot)
    git('commit -m "main edit"', tmpRoot)

    await expect(mergeBranch(tmpRoot, "conflict-branch")).rejects.toThrow()

    // The repo must not be left in a rebase or merge state
    const status = execSync("git status", { cwd: tmpRoot, encoding: "utf8" })
    expect(status).not.toContain("rebase in progress")
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

describe("getProjectFiles", () => {
  it("returns tracked files relative to the repo root", async () => {
    const files = await getProjectFiles(tmpRoot)
    expect(files).toContain("README.md")
  })

  it("does not include directories", async () => {
    mkdirSync(join(tmpRoot, "src"), { recursive: true })
    writeFileSync(join(tmpRoot, "src", "index.ts"), "export {}\n")
    git("add .")
    git('commit -m "add src/index.ts"')

    const files = await getProjectFiles(tmpRoot)
    expect(files).toContain("src/index.ts")
    // Directories themselves must not appear in the file list.
    expect(files.every((f) => !f.endsWith("/"))).toBe(true)
  })
})

describe("getProjectDirectories", () => {
  it("returns an empty array when there are no subdirectories", async () => {
    // The initial repo only has README.md at the root, so no directories.
    const dirs = await getProjectDirectories(tmpRoot)
    expect(dirs).toEqual([])
  })

  it("returns directories with trailing slashes", async () => {
    mkdirSync(join(tmpRoot, "src"), { recursive: true })
    writeFileSync(join(tmpRoot, "src", "index.ts"), "export {}\n")
    git("add .")
    git('commit -m "add src/index.ts"')

    const dirs = await getProjectDirectories(tmpRoot)
    expect(dirs).toContain("src/")
  })

  it("includes ancestor directories for deeply nested files", async () => {
    mkdirSync(join(tmpRoot, "src", "lib"), { recursive: true })
    writeFileSync(join(tmpRoot, "src", "lib", "util.ts"), "export {}\n")
    git("add .")
    git('commit -m "add nested file"')

    const dirs = await getProjectDirectories(tmpRoot)
    expect(dirs).toContain("src/")
    expect(dirs).toContain("src/lib/")
  })

  it("deduplicates directories shared by multiple files", async () => {
    mkdirSync(join(tmpRoot, "src"), { recursive: true })
    writeFileSync(join(tmpRoot, "src", "a.ts"), "export {}\n")
    writeFileSync(join(tmpRoot, "src", "b.ts"), "export {}\n")
    git("add .")
    git('commit -m "add two files in src"')

    const dirs = await getProjectDirectories(tmpRoot)
    const srcDirs = dirs.filter((d) => d === "src/")
    expect(srcDirs).toHaveLength(1)
  })

  it("does not include filenames", async () => {
    mkdirSync(join(tmpRoot, "src"), { recursive: true })
    writeFileSync(join(tmpRoot, "src", "index.ts"), "export {}\n")
    git("add .")
    git('commit -m "add src/index.ts"')

    const dirs = await getProjectDirectories(tmpRoot)
    expect(dirs).not.toContain("src/index.ts")
    expect(dirs.every((d) => d.endsWith("/"))).toBe(true)
  })
})
