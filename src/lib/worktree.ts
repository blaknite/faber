import { execa } from "execa"
import { join } from "node:path"

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

export async function getDiff(repoRoot: string, slug: string): Promise<string> {
  const { stdout } = await execa("git", ["diff", `HEAD...${slug}`], { cwd: repoRoot })
  return stdout
}

export async function mergeBranch(repoRoot: string, slug: string): Promise<void> {
  await execa("git", ["merge", "--no-ff", slug], { cwd: repoRoot })
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
