---
name: delivering-work
description: Takes a PLAN.md and drives it through implementation, review, and shipping. Use when you have a plan ready and want to deliver the change as a green PR without further intervention.
---

# Delivering work

Take a PLAN.md and produce a pull request with passing CI. Input: a path to a PLAN.md. Output: a PR URL. This skill chains three faber subcommands -- `faber execute`, `faber review`, and `faber ship` -- with a review->fix loop in between when needed.

Reference `reviewing-faber-tasks` for the review->fix loop mechanics, `reading-faber-logs` for inspecting failed tasks, and `using-faber` for command flags and exit codes.

## Step 1: Execute the plan

Dispatch the executor in the background, then watch it to completion:

```bash
faber execute <plan-path> --background
# Task <executeTaskId> running  <- capture this ID
faber watch <executeTaskId>
# Task <executeTaskId> finished (status: <status>)
```

The executor is your worker. When it stumbles, your job is to nudge it back on track, not give up. There are three cases:

**Status is `ready` and `faber diff <executeTaskId>` shows commits.** Proceed to Step 2.

**Status is `ready` but `faber diff <executeTaskId>` is empty.** The agent thought it was done but produced nothing. The two common causes are: it wrote files without committing them, or it genuinely concluded there was nothing to do. Check the worktree at `.worktrees/<executeTaskId>` -- if `git status` there shows uncommitted changes, send `faber continue <executeTaskId> 'You wrote changes but did not commit them. Stage and commit your work in logical units following the working-in-faber skill, then stop.'`. If the worktree is genuinely clean, send `faber continue <executeTaskId> 'You finished without committing any changes. If you made progress on the plan, commit it now. If you concluded there was nothing to change, explain why in detail.'` and decide what to do based on the response.

**Status is `failed` or `stopped`.** The agent hit something it could not handle alone. Load `reading-faber-logs` and delegate to a sub-agent to read the log and answer: what was the agent attempting when it stopped, and what was the immediate cause? Use the answer to craft a directed `faber continue` -- a tool error, a permission rejection, or running out of context are all recoverable. A genuinely confused agent that misread the plan is harder; reframe the part of the plan it tripped on and send it back.

After any `faber continue`, run `faber watch <executeTaskId>` again and route through the same three cases. Stop after two unproductive iterations (the same problem returns or each fix introduces a new one) and surface to the user with what you tried.

## Step 2: Review the implementation

Run a background review of the executor task, pointing the reviewer at the plan so it can check for gaps:

```bash
faber review --background --task <executeTaskId> --context 'final review before shipping; the implementation should match the plan at <plan-path>'
# Task <reviewTaskId> running  <- capture this ID, then:
faber watch <reviewTaskId>
faber read <reviewTaskId>
faber done <reviewTaskId>
```

Route based on the findings:

- **Clean** -- when `faber watch <reviewTaskId>` returns and findings are clean, run `faber merge <executeTaskId>` to merge the executor branch, then proceed to Step 3.
- **Findings that need addressing** -- run `faber continue <executeTaskId>` with directed feedback citing the specific findings, then run `faber watch <executeTaskId>` to wait for the fix, then re-review. Pass `--context` on the next review to tell the reviewer what was addressed and what was intentionally skipped. Stop after two unproductive iterations (same finding returns unfixed, or each fix introduces a different problem) and surface what was tried to the user.
- **Approach is fundamentally wrong** -- the reviewer usually names the better approach in the finding ("this should be at the router level instead", "use the existing X helper rather than reimplementing it"). Pass that alternative back to the executor with `faber continue <executeTaskId>` framed as a re-direction, not a fix. If the reviewer's finding does not name an alternative, or the re-direction fails to land, that is a re-shaping problem above this skill -- surface to the user with the finding and what you tried.

## Step 3: Ship the merged branch

Dispatch the ship agent in the background, then watch it to completion. The current branch (the orchestrator's branch) now includes the merged executor work, so `faber ship` with no flags ships that:

```bash
faber ship --background
# Task <shipTaskId> running  <- capture this ID
faber watch <shipTaskId>
# Task <shipTaskId> finished (status: <status>)
faber read <shipTaskId>
```

Three cases:

**Status is `ready` and the last message contains a PR URL.** Surface the URL to the user. Done.

**Status is `ready` but no PR URL is in the last message.** The agent may have opened the PR but forgotten to print the URL, or it may not have opened one. Verify with `gh pr list --head <currentBranch>`. If a PR exists, surface its URL. If not, send `faber continue <shipTaskId> 'No PR was opened. Open the pull request for the current branch and share the URL in your final message.'` and re-watch.

**Status is `failed` or `stopped`.** Load `reading-faber-logs` and delegate to a sub-agent to read the log and answer: what was the agent doing when it stopped, and what was the immediate cause? Common recoverable cases and the directed `faber continue` for each:
- *Push rejected because the remote diverged*: "fetch and use `git push --force-with-lease` to push the target branch."
- *Missing PR template fields*: pass the missing values back so the agent can fill them in.
- *CI failed*: pass the failing test names or job links so the agent can fix the breakage and re-push.
- *`gh` not authenticated*: surface to the user; this is environment, not orchestration.

Re-watch after any `faber continue` and route through the same three cases. Stop after two unproductive iterations and surface to the user with what you tried.

## Step 4: Surface a summary

End with a short report regardless of how the workflow ended:

- Plan path
- Executor task ID
- Review iterations (count and outcome)
- PR URL, or the reason there isn't one

## When to stop

Three conditions end the workflow before a PR is open. Each step above tells you to attempt recovery first. These are the situations where recovery is no longer your job.

1. **Two unproductive iterations on the same problem.** The same finding returns unfixed, or each `faber continue` introduces a different problem. The task is not converging, and more iterations cost more than they earn.
2. **Re-shaping needed.** The reviewer's finding rejects the approach and does not name an alternative, or your re-direction attempt failed. The plan itself needs rework, which is above this skill.
3. **Environment failure outside the orchestrator's control.** `gh` is not authenticated. The remote repository does not exist. CI is offline. The agent cannot fix these and neither can you.

When you stop, surface to the user with: which step failed, what you tried, and what the agent's last message said. Do not delete tasks autonomously. Preserve the failure state for the user to inspect.
