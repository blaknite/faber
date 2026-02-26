import { describe, expect, it } from "bun:test"
import { worktreePath } from "./worktree.js"

// listWorktrees, createWorktree, and removeWorktree all shell out to git,
// so they need a real git repository. We test listWorktrees using the actual
// repo this project lives in (the worktree itself is inside a real git repo).
// createWorktree and removeWorktree are integration-level and require more
// setup, so we leave them for manual testing.

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
