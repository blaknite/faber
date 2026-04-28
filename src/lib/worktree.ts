import { execa, execaSync } from "execa"
import { join } from "node:path"
import { readFileSync, existsSync, symlinkSync, rmSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { randomBytes } from "node:crypto"

export function worktreePath(repoRoot: string, slug: string): string {
  return join(repoRoot, ".worktrees", slug)
}

export async function createWorktree(repoRoot: string, slug: string, baseBranch?: string): Promise<string> {
  const path = worktreePath(repoRoot, slug)
  const args = ["worktree", "add", path, "-b", slug]
  if (baseBranch) args.push(baseBranch)
  await execa("git", args, { cwd: repoRoot })
  const plansSource = join(repoRoot, ".plans")
  const plansTarget = join(path, ".plans")
  if (existsSync(plansSource) && !existsSync(plansTarget)) {
    symlinkSync(plansSource, plansTarget)
  }
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

export function branchExists(repoRoot: string, name: string): boolean {
  try {
    execaSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${name}`], { cwd: repoRoot })
    return true
  } catch {
    return false
  }
}

export async function commitsAhead(repoRoot: string, branch: string, base: string): Promise<number> {
  try {
    const { stdout } = await execa("git", ["rev-list", "--count", `${base}..${branch}`], { cwd: repoRoot })
    return parseInt(stdout.trim(), 10) || 0
  } catch {
    return 0
  }
}

export async function worktreeHasCommits(repoRoot: string, slug: string, baseBranch?: string): Promise<boolean> {
  try {
    const base = baseBranch ?? 'HEAD'
    const { stdout } = await execa("git", ["log", "--oneline", `${base}..${slug}`], { cwd: repoRoot })
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

// Returns the path to the refs/heads directory where branch refs are stored.
// Git writes branch tip updates here when merging or rebasing.
export function gitRefsHeadsPath(repoRoot: string): string {
  return join(repoRoot, ".git", "refs", "heads")
}

// Returns the path to FETCH_HEAD, which git rewrites on every push and fetch.
// Watching this file is more reliable than watching per-branch remote refs
// because those can be absorbed into packed-refs and disappear as loose files.
export function gitFetchHeadPath(repoRoot: string): string {
  return join(repoRoot, ".git", "FETCH_HEAD")
}

// Returns the path to .git/index, which git rewrites when files are staged or
// unstaged. Watching this catches staging-related changes, but it does NOT fire
// when new untracked files appear in the working tree.
export function gitIndexPath(repoRoot: string): string {
  return join(repoRoot, ".git", "index")
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

export async function hasUnpushedCommits(repoRoot: string): Promise<boolean> {
  try {
    const { stdout } = await execa("git", ["rev-list", "--count", "@{u}..HEAD"], { cwd: repoRoot })
    return parseInt(stdout.trim(), 10) > 0
  } catch {
    // No upstream configured -- treat as unpushed
    return true
  }
}

export async function getDiff(repoRoot: string, slug: string, baseBranch?: string): Promise<string> {
  const base = baseBranch || "HEAD"
  const { stdout } = await execa("git", ["diff", `${base}...${slug}`], { cwd: repoRoot })
  return stdout
}

// Returns all files visible to git (tracked + untracked, but not gitignored),
// relative to the repo root. Combines `git ls-files` for tracked files and
// `git ls-files --others --exclude-standard` for untracked ones.
//
// Also includes files from .plans/ directly, since that directory is gitignored
// but users need to reference plan files when writing task prompts.
async function getAllProjectFiles(repoRoot: string): Promise<string[]> {
  const [{ stdout: tracked }, { stdout: untracked }] = await Promise.all([
    execa("git", ["ls-files"], { cwd: repoRoot }),
    execa("git", ["ls-files", "--others", "--exclude-standard"], { cwd: repoRoot }),
  ])
  const files = [...tracked.split("\n"), ...untracked.split("\n")].filter(Boolean)

  // .plans/ is gitignored, so git never returns those files. Read the directory
  // directly and merge the paths in so they show up in the @ file selector.
  const plansDir = join(repoRoot, ".plans")
  if (existsSync(plansDir)) {
    const planFiles = readdirSync(plansDir, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => join(".plans", entry.parentPath.slice(plansDir.length), entry.name).replace(/\\/g, "/").replace(/\/+/g, "/"))
    files.push(...planFiles)
  }

  return [...new Set(files)].sort()
}

// Returns all files visible to git (tracked + untracked, but not gitignored),
// relative to the repo root.
export async function getProjectFiles(repoRoot: string): Promise<string[]> {
  return getAllProjectFiles(repoRoot)
}

// Returns all unique directories that contain tracked or untracked files,
// relative to the repo root. Respects .gitignore via `git ls-files`.
export async function getProjectDirectories(repoRoot: string): Promise<string[]> {
  const files = await getAllProjectFiles(repoRoot)
  const seen = new Set<string>()
  for (const file of files) {
    const parts = file.split("/")
    // Accumulate each ancestor directory (stop before the filename itself).
    for (let i = 1; i < parts.length; i++) {
      seen.add(parts.slice(0, i).join("/"))
    }
  }
  return Array.from(seen).sort()
}

// Returns the path of the worktree where `branch` is currently checked out,
// by querying `git worktree list`. Returns null if the branch isn't checked
// out in any worktree.
async function findWorktreeForBranch(repoRoot: string, branch: string): Promise<string | null> {
  const { stdout } = await execa("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot })
  // Each entry is separated by a blank line. Fields: worktree, HEAD, branch.
  const entries = stdout.trim().split(/\n\n/)
  for (const entry of entries) {
    const branchLine = entry.split("\n").find(l => l.startsWith("branch "))
    const worktreeLine = entry.split("\n").find(l => l.startsWith("worktree "))
    if (!branchLine || !worktreeLine) continue
    // branch lines look like: "branch refs/heads/<name>"
    const checkedOutBranch = branchLine.replace("branch refs/heads/", "")
    if (checkedOutBranch === branch) {
      return worktreeLine.replace("worktree ", "")
    }
  }
  return null
}

export async function mergeBranch(repoRoot: string, slug: string, baseBranch: string): Promise<void> {
  // Rebase the task branch onto baseBranch's current tip. Because the task
  // branch is checked out in its own worktree we can't reference it by name
  // from outside -- we run the rebase from inside that worktree instead.
  const wtPath = worktreePath(repoRoot, slug)
  const { stdout: headSha } = await execa("git", ["rev-parse", baseBranch], { cwd: repoRoot })
  try {
    await execa("git", ["rebase", headSha.trim()], { cwd: wtPath })
  } catch (err) {
    // Rebase hit a conflict -- clean up and surface the error.
    try {
      await execa("git", ["rebase", "--abort"], { cwd: wtPath })
    } catch {
      // If abort fails there's nothing more we can do
    }
    throw err
  }

  // git merge always advances the currently checked out branch, so we need to
  // run it from a directory where baseBranch is HEAD. If it's already checked
  // out in an existing worktree we use that. Otherwise we spin up a temporary
  // worktree, merge, and immediately tear it down.
  const existingPath = await findWorktreeForBranch(repoRoot, baseBranch)
  if (existingPath) {
    await execa("git", ["merge", "--ff-only", slug], { cwd: existingPath })
    return
  }

  const tmpPath = join(tmpdir(), `faber-merge-${randomBytes(4).toString("hex")}`)
  try {
    await execa("git", ["worktree", "add", tmpPath, baseBranch], { cwd: repoRoot })
    await execa("git", ["merge", "--ff-only", slug], { cwd: tmpPath })
  } finally {
    try {
      await execa("git", ["worktree", "remove", "--force", tmpPath], { cwd: repoRoot })
    } catch {
      rmSync(tmpPath, { recursive: true, force: true })
    }
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


