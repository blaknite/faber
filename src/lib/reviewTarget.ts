import { execa, execaSync } from "execa"
import { readCurrentBranch } from "./worktree.js"
import { findDefaultBranch } from "./defaultBranch.js"

export type ReviewTarget = {
  worktreeBase: string
  reviewBase: string
  summary: string
  contextLine: string
}

export type ReviewMode =
  | { kind: "current" }
  | { kind: "branch"; name: string }
  | { kind: "pullRequest"; arg: string }

export async function resolveReviewTarget(repoRoot: string, mode: ReviewMode): Promise<ReviewTarget> {
  if (mode.kind === "pullRequest") {
    return await resolvePullRequest(repoRoot, mode.arg)
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
  await execa("git", ["fetch", "origin", `pull/${meta.number}/head:${localRef}`], { cwd: repoRoot })

  return {
    worktreeBase: localRef,
    reviewBase: meta.baseRefName,
    summary: `pull request #${meta.number}`,
    contextLine: `${meta.url}\n${meta.title}\n\nBase branch: ${meta.baseRefName}\nHead branch: ${meta.headRefName}`,
  }
}
