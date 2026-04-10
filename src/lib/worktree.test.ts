import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { lstatSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
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

  it("does not throw when .plans already exists in the worktree", async () => {
    // Commit a .plans directory to the repo so git worktree add checks it out
    mkdirSync(join(tmpRoot, ".plans"), { recursive: true })
    writeFileSync(join(tmpRoot, ".plans", "example.md"), "# plan\n")
    git("add .")
    git('commit -m "add .plans to repo"')

    // Also create a .plans directory at the repo root so the source-exists guard passes
    // (simulates faber's own setup where the root .plans dir exists)
    // It already exists from the commit above, so nothing extra needed here.

    // createWorktree should not throw even though .plans will already exist in the worktree
    await expect(createWorktree(tmpRoot, "plans-already-exists")).resolves.toBeDefined()

    // .plans inside the worktree should be a regular directory, not a symlink
    const wtPlans = join(worktreePath(tmpRoot, "plans-already-exists"), ".plans")
    expect(lstatSync(wtPlans).isSymbolicLink()).toBe(false)
  })

  it("branches from baseBranch when provided", async () => {
    // Create a second branch off main and add a commit that main doesn't have
    git("checkout -b second-branch")
    writeFileSync(join(tmpRoot, "second-branch-file.ts"), "export const x = 1\n")
    git("add .")
    git('commit -m "commit on second-branch"')
    const secondBranchSha = execSync("git rev-parse HEAD", { cwd: tmpRoot, encoding: "utf8" }).trim()

    // Switch back to main
    git("checkout main")

    // Create a worktree branching from second-branch
    const wtPath = await createWorktree(tmpRoot, "from-second-branch", "second-branch")

    // The worktree's HEAD should match second-branch's tip, not main's HEAD
    const wtSha = execSync("git rev-parse HEAD", { cwd: wtPath, encoding: "utf8" }).trim()
    expect(wtSha).toBe(secondBranchSha)
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

  it("compares against baseBranch when provided", async () => {
    // Create a second branch off main and add a commit that main doesn't have
    git("checkout -b second-branch")
    writeFileSync(join(tmpRoot, "second-branch-file.ts"), "export const x = 1\n")
    git("add .")
    git('commit -m "commit on second-branch"')

    // Switch back to main
    git("checkout main")

    // Create a worktree branching from second-branch
    const wtPath = await createWorktree(tmpRoot, "from-second-branch", "second-branch")
    writeFileSync(join(wtPath, "new-file.ts"), "export const y = 2\n")
    git("add .", wtPath)
    git('commit -m "new commit in worktree"', wtPath)

    // Comparing against main (default): should have commits (the one from second-branch
    // plus the new one from the worktree)
    const resultVsMain = await worktreeHasCommits(tmpRoot, "from-second-branch")
    expect(resultVsMain).toBe(true)

    // Comparing against second-branch (baseBranch): should have commits (only the new
    // one from the worktree, but that counts as "ahead")
    const resultVsSecond = await worktreeHasCommits(tmpRoot, "from-second-branch", "second-branch")
    expect(resultVsSecond).toBe(true)
  })

  it("falls back to HEAD when baseBranch is not provided", async () => {
    const wtPath = await createWorktree(tmpRoot, "test-fallback")
    writeFileSync(join(wtPath, "file.ts"), "export const x = 1\n")
    git("add .", wtPath)
    git('commit -m "add file"', wtPath)

    // Should work without baseBranch (fallback to HEAD)
    const result = await worktreeHasCommits(tmpRoot, "test-fallback")
    expect(result).toBe(true)
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

    await mergeBranch(tmpRoot, "merge-me", "main")

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

    await mergeBranch(tmpRoot, "diverged-branch", "main")

    const log = execSync("git log --oneline", { cwd: tmpRoot, encoding: "utf8" })
    expect(log).toContain("add feature")
    expect(log).toContain("unrelated change on main")
    // Linear history: no merge commit
    expect(log).not.toContain("Merge branch")
  })

  it("merges into an orchestrator worktree branch when baseBranch is a worktree slug", async () => {
    // Set up an "orchestrator" worktree branch that has a commit ahead of main.
    const orchPath = await createWorktree(tmpRoot, "orchestrator-branch")
    writeFileSync(join(orchPath, "orchestrator.ts"), "export const orch = true\n")
    git("add .", orchPath)
    git('commit -m "orchestrator commit"', orchPath)

    // Create a sub-task worktree branching from the orchestrator branch.
    const subPath = await createWorktree(tmpRoot, "sub-task", "orchestrator-branch")
    writeFileSync(join(subPath, "sub-task.ts"), "export const sub = true\n")
    git("add .", subPath)
    git('commit -m "sub-task commit"', subPath)

    // Merge sub-task into the orchestrator branch (not main).
    await mergeBranch(tmpRoot, "sub-task", "orchestrator-branch")

    // The orchestrator worktree should now contain both commits.
    const log = execSync("git log --oneline", { cwd: orchPath, encoding: "utf8" })
    expect(log).toContain("orchestrator commit")
    expect(log).toContain("sub-task commit")

    // main should NOT have the sub-task commit -- it only went into the orchestrator branch.
    const mainLog = execSync("git log --oneline", { cwd: tmpRoot, encoding: "utf8" })
    expect(mainLog).not.toContain("sub-task commit")
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

    await expect(mergeBranch(tmpRoot, "conflict-branch", "main")).rejects.toThrow()

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

  it("returns directories without trailing slashes", async () => {
    mkdirSync(join(tmpRoot, "src"), { recursive: true })
    writeFileSync(join(tmpRoot, "src", "index.ts"), "export {}\n")
    git("add .")
    git('commit -m "add src/index.ts"')

    const dirs = await getProjectDirectories(tmpRoot)
    expect(dirs).toContain("src")
  })

  it("includes ancestor directories for deeply nested files", async () => {
    mkdirSync(join(tmpRoot, "src", "lib"), { recursive: true })
    writeFileSync(join(tmpRoot, "src", "lib", "util.ts"), "export {}\n")
    git("add .")
    git('commit -m "add nested file"')

    const dirs = await getProjectDirectories(tmpRoot)
    expect(dirs).toContain("src")
    expect(dirs).toContain("src/lib")
  })

  it("deduplicates directories shared by multiple files", async () => {
    mkdirSync(join(tmpRoot, "src"), { recursive: true })
    writeFileSync(join(tmpRoot, "src", "a.ts"), "export {}\n")
    writeFileSync(join(tmpRoot, "src", "b.ts"), "export {}\n")
    git("add .")
    git('commit -m "add two files in src"')

    const dirs = await getProjectDirectories(tmpRoot)
    const srcDirs = dirs.filter((d) => d === "src")
    expect(srcDirs).toHaveLength(1)
  })

  it("does not include filenames", async () => {
    mkdirSync(join(tmpRoot, "src"), { recursive: true })
    writeFileSync(join(tmpRoot, "src", "index.ts"), "export {}\n")
    git("add .")
    git('commit -m "add src/index.ts"')

    const dirs = await getProjectDirectories(tmpRoot)
    expect(dirs).not.toContain("src/index.ts")
  })
})
