import { execa, execaSync } from "execa"
import { readFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { readCurrentBranch } from "./worktree.js"
import { findDefaultBranch } from "./defaultBranch.js"
import { readState, findTask } from "./state.js"

export type ReviewTarget = {
  worktreeBase: string
  reviewBase: string
  summary: string
  contextLine: string
  originalTask?: string
}

export type ReviewMode =
  | { kind: "current" }
  | { kind: "branch"; name: string }
  | { kind: "pullRequest"; arg: string }
  | { kind: "task"; id: string }

export async function resolveReviewTarget(repoRoot: string, mode: ReviewMode): Promise<ReviewTarget> {
  if (mode.kind === "pullRequest") {
    return await resolvePullRequest(repoRoot, mode.arg)
  }

  if (mode.kind === "task") {
    const state = readState(repoRoot)
    const task = findTask(state.tasks, mode.id)
    if (!task) {
      throw new Error(`No task matching "${mode.id}"`)
    }
    if (task.status !== "ready") {
      throw new Error(`Task "${task.id}" has status "${task.status}" -- only "ready" tasks can be reviewed.`)
    }
    if (!task.hasCommits) {
      throw new Error(`Task "${task.id}" has no commits to review.`)
    }
    if (task.id === task.baseBranch) {
      throw new Error(`Cannot review task ${task.id}: its branch matches its base.`)
    }
    return {
      worktreeBase: task.id,
      reviewBase: task.baseBranch,
      summary: `task \`${task.id}\``,
      contextLine: `This is faber task \`${task.id}\` based on \`${task.baseBranch}\`.`,
      originalTask: task.prompt,
    }
  }

  const defaultBranch = findDefaultBranch(repoRoot)
  if (!defaultBranch) {
    throw new Error("Could not determine the default branch (no origin/HEAD and no local main or master).")
  }

  if (mode.kind === "branch") {
    if (mode.name === defaultBranch) {
      throw new Error(`Cannot review ${mode.name}: it is the default branch.`)
    }
    return {
      worktreeBase: mode.name,
      reviewBase: defaultBranch,
      summary: `branch \`${mode.name}\``,
      contextLine: "",
    }
  }

  const current = readCurrentBranch(repoRoot)
  if (!current) {
    throw new Error("HEAD is detached; cannot review the current branch.")
  }
  if (current === defaultBranch) {
    throw new Error(`Currently on ${defaultBranch}: nothing to review. Switch to a feature branch or pass --branch / --pull-request.`)
  }
  return {
    worktreeBase: current,
    reviewBase: defaultBranch,
    summary: `branch \`${current}\``,
    contextLine: `This is the current work on \`${current}\`.`,
  }
}

async function resolvePullRequest(repoRoot: string, arg: string): Promise<ReviewTarget> {
  try {
    execaSync("gh", ["--version"])
  } catch {
    throw new Error("The gh CLI is required for --pull-request mode. See https://cli.github.com/ to install.")
  }

  const prNumberMatch = arg.match(/^\d+$/) || arg.match(/\/pull\/(\d+)(?:\/|$)/)
  if (!prNumberMatch) {
    throw new Error(`Invalid --pull-request argument: ${arg}. Provide a PR number or URL.`)
  }
  const prNumber = prNumberMatch[1] ?? prNumberMatch[0]

  const { stdout } = await execa(
    "gh",
    ["pr", "view", arg, "--json", "number,url,title,baseRefName,headRefName"],
    { cwd: repoRoot },
  )
  const meta = JSON.parse(stdout) as { number: number; url: string; title: string; baseRefName: string; headRefName: string }

  const localRef = `refs/faber/pr-${meta.number}`
  // Some GitHub repos do not resolve the shorthand `pull/<id>/head` fetch ref,
  // but they do expose the fully-qualified remote ref.
  await execa("git", ["fetch", "origin", `refs/pull/${meta.number}/head:${localRef}`], { cwd: repoRoot })
  // Prefer the synthetic ref when it exists, but some git environments only
  // update FETCH_HEAD for this fetch and do not materialise refs/faber/*.
  let prHeadSha: string
  try {
    const { stdout } = await execa("git", ["rev-parse", `${localRef}^{commit}`], { cwd: repoRoot })
    prHeadSha = stdout.trim()
  } catch {
    // Read FETCH_HEAD directly rather than via `git rev-parse FETCH_HEAD`. The
    // fetch above just wrote it; another process could overwrite it before a
    // second git invocation runs, and we'd silently check out the wrong commit.
    prHeadSha = readFetchHeadSha(repoRoot)
  }

  return {
    worktreeBase: prHeadSha,
    reviewBase: meta.baseRefName,
    summary: `pull request #${meta.number}`,
    contextLine: `${meta.url}\n${meta.title}\n\nBase branch: ${meta.baseRefName}\nHead branch: ${meta.headRefName}`,
  }
}

// Parse the SHA from the first line of .git/FETCH_HEAD. The file format is
// stable across Git versions: each line starts with the fetched SHA followed
// by a tab. The first line is the ref we just fetched (subsequent lines, if
// any, would be additional refs from the same fetch invocation).
function readFetchHeadSha(repoRoot: string): string {
  const { stdout: gitDirOut } = execaSync("git", ["rev-parse", "--git-dir"], { cwd: repoRoot })
  const gitDir = gitDirOut.trim()
  const fetchHeadPath = isAbsolute(gitDir) ? join(gitDir, "FETCH_HEAD") : join(repoRoot, gitDir, "FETCH_HEAD")
  const contents = readFileSync(fetchHeadPath, "utf8")
  const firstLine = contents.split("\n", 1)[0] ?? ""
  const sha = firstLine.split("\t", 1)[0]?.trim() ?? ""
  if (!/^[0-9a-f]{7,64}$/.test(sha)) {
    throw new Error(`Could not parse FETCH_HEAD at ${fetchHeadPath}`)
  }
  return sha
}
