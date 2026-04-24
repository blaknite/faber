import { execaSync } from "execa"

export function findDefaultBranch(repoRoot: string): string | null {
  try {
    const { stdout } = execaSync("git", ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], { cwd: repoRoot })
    const match = stdout.trim().match(/^refs\/remotes\/origin\/(.+)$/)
    if (match) return match[1]!
  } catch { /* no origin HEAD */ }

  for (const candidate of ["main", "master"]) {
    try {
      execaSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`], { cwd: repoRoot })
      return candidate
    } catch { /* not found */ }
  }

  return null
}
