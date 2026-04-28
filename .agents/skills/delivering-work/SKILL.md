---
name: delivering-work
description: Takes a PLAN.md and drives it through implementation, review, and shipping. Use when you have a plan ready and want to deliver the change as a green PR without further intervention.
---

# Delivering work

Take a PLAN.md and produce a pull request with passing CI. Input: a path to a PLAN.md. Output: a PR URL. This skill chains three faber subcommands -- `faber execute`, `faber review`, and `faber ship` -- with a review->fix loop in between when needed.

Reference `reviewing-faber-tasks` for the review->fix loop mechanics, `reading-faber-logs` for inspecting failed tasks, and `using-faber` for command flags and exit codes.

## Step 1: Execute the plan

```bash
faber execute <plan-path> --background
# Task <executeTaskId> running  <- capture this ID
faber watch <executeTaskId>
# Task <executeTaskId> finished (status: <status>)
```

Three cases after watch returns:

**Status is `ready` and `faber diff <executeTaskId>` shows commits.** Proceed to Step 2.

**Status is `ready` but `faber diff <executeTaskId>` is empty.** The agent thought it was done but produced nothing. Check the worktree at `.worktrees/<executeTaskId>` -- if `git status` there shows uncommitted changes, send `faber continue <executeTaskId> 'You wrote changes but did not commit them. Stage and commit your work in logical units following the working-in-faber skill, then stop.'`. If the worktree is genuinely clean, send `faber continue <executeTaskId> 'You finished without committing any changes. If you made progress on the plan, commit it now. If you concluded there was nothing to change, explain why in detail.'` and decide based on the response.

**Status is `failed` or `stopped`.** Read the log via `reading-faber-logs` to find the immediate cause, then send a directed `faber continue` addressing it. Tool errors, permission rejections, and context exhaustion are all recoverable. If the agent misread the plan, reframe the part it tripped on.

Stop after two unproductive iterations (same problem returns, or each fix introduces a new one) and surface to the user.

## Step 2: Review the implementation

Point the reviewer at the plan so it can check for gaps:

```bash
faber review --background --task <executeTaskId> --context 'final review before shipping; the implementation should match the plan at <plan-path>'
# Task <reviewTaskId> running  <- capture this ID, then:
faber watch <reviewTaskId>
faber read <reviewTaskId>
faber done <reviewTaskId>
```

Route based on the findings:

- **Clean** -- run `faber merge <executeTaskId>` and proceed to Step 3.
- **Findings that need addressing** -- send `faber continue <executeTaskId>` with directed feedback, watch, then re-review with `--context` describing what was addressed and what was intentionally skipped. Stop after two unproductive iterations and surface to the user.
- **Approach is fundamentally wrong** -- the reviewer usually names the better approach in the finding ("this should be at the router level instead", "use the existing X helper rather than reimplementing it"). Pass that alternative back to the executor with `faber continue <executeTaskId>` framed as a re-direction, not a fix. If no alternative is named, or the re-direction fails, surface to the user -- the plan needs reshaping.

## Step 3: Ship the merged branch

The current branch now includes the merged executor work, so `faber ship` with no flags ships that:

```bash
faber ship --background
# Task <shipTaskId> running  <- capture this ID
faber watch <shipTaskId>
# Task <shipTaskId> finished (status: <status>)
faber read <shipTaskId>
```

Three cases after watch returns:

**Status is `ready` and the last message contains a PR URL.** Surface the URL.

**Status is `ready` but no PR URL is in the last message.** The agent may have opened the PR without printing the URL, or it may not have opened one. Verify with `gh pr list --head <currentBranch>`. If a PR exists, surface its URL. If not, send `faber continue <shipTaskId> 'No PR was opened. Open the pull request for the current branch and share the URL in your final message.'` and re-watch.

**Status is `failed` or `stopped`.** Read the log via `reading-faber-logs` to find the immediate cause and send a directed `faber continue`. Push rejections, missing PR fields, and CI failures are all recoverable with the right specific fix. Environment failures (`gh` not authenticated, no remote) are not -- surface those.

Stop after two unproductive iterations and surface to the user.

## Step 4: Surface a summary

End with a short report regardless of how the workflow ended:

- Plan path
- Executor task ID
- Review iterations (count and outcome)
- PR URL, or the reason there isn't one

If you stopped before opening a PR, name which step failed, what you tried, and what the agent's last message said. Do not delete tasks autonomously -- preserve the failure state for the user to inspect.
