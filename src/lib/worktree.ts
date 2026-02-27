import { execa } from "execa"
import { join } from "node:path"
import { readFileSync, existsSync } from "node:fs"

export function worktreePath(repoRoot: string, slug: string): string {
  return join(repoRoot, ".worktrees", slug)
}

export async function createWorktree(repoRoot: string, slug: string): Promise<string> {
  const path = worktreePath(repoRoot, slug)
  await execa("git", ["worktree", "add", path, "-b", slug], { cwd: repoRoot })
  return path
}

export async function removeWorktree(repoRoot: string, slug: string): Promise<void> {
  const path = worktreePath(repoRoot, slug)
  await execa("git", ["worktree", "remove", "--force", path], { cwd: repoRoot })
  // Remove the branch too
  try {
    await execa("git", ["branch", "-D", slug], { cwd: repoRoot })
  } catch {
    // Branch may already be gone, that's fine
  }
}

export async function worktreeHasCommits(repoRoot: string, slug: string): Promise<boolean> {
  try {
    const { stdout } = await execa("git", ["log", "--oneline", `HEAD..${slug}`], { cwd: repoRoot })
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

// Returns the path to the main repo's HEAD file, which contains the current
// branch name in the format "ref: refs/heads/<branch>".
export function gitHeadPath(repoRoot: string): string {
  return join(repoRoot, ".git", "HEAD")
}

// Reads the current branch name directly from .git/HEAD without spawning a
// subprocess. Returns an empty string if HEAD is detached or unreadable.
export function readCurrentBranch(repoRoot: string): string {
  try {
    const content = readFileSync(gitHeadPath(repoRoot), "utf8").trim()
    const match = content.match(/^ref: refs\/heads\/(.+)$/)
    return match ? match[1]! : ""
  } catch {
    return ""
  }
}

export async function getCurrentBranch(repoRoot: string): Promise<string> {
  const { stdout } = await execa("git", ["branch", "--show-current"], { cwd: repoRoot })
  return stdout.trim()
}

export async function hasUnpushedCommits(repoRoot: string): Promise<boolean> {
  try {
    const { stdout } = await execa("git", ["rev-list", "--count", "@{u}..HEAD"], { cwd: repoRoot })
    return parseInt(stdout.trim(), 10) > 0
  } catch {
    // No upstream configured -- treat as unpushed
    return true
  }
}

export async function getDiff(repoRoot: string, slug: string): Promise<string> {
  const { stdout } = await execa("git", ["diff", `HEAD...${slug}`], { cwd: repoRoot })
  return stdout
}

export async function mergeBranch(repoRoot: string, slug: string): Promise<void> {
  try {
    await execa("git", ["merge", "--no-ff", slug], { cwd: repoRoot })
  } catch (err) {
    // Clean up any partial merge state so the repo isn't left dirty
    try {
      await execa("git", ["merge", "--abort"], { cwd: repoRoot })
    } catch {
      // If abort fails there's nothing more we can do
    }
    throw err
  }
}

export async function pushBranch(repoRoot: string): Promise<void> {
  await execa("git", ["push", "--set-upstream", "origin", "HEAD"], { cwd: repoRoot })
}

export async function switchBranch(repoRoot: string, slug: string): Promise<void> {
  // Check if the branch already exists
  try {
    await execa("git", ["rev-parse", "--verify", slug], { cwd: repoRoot })
    // Branch exists, switch to it
    await execa("git", ["checkout", slug], { cwd: repoRoot })
  } catch {
    // Branch does not exist, create it from the current HEAD
    await execa("git", ["checkout", "-b", slug], { cwd: repoRoot })
  }
}

export async function listWorktrees(repoRoot: string): Promise<string[]> {
  const { stdout } = await execa("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot })
  return stdout
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const match = block.match(/^worktree (.+)/)
      return match ? match[1]! : null
    })
    .filter((p): p is string => p !== null)
}
