---
name: delivering-work
description: Takes a PLAN.md and drives it through implementation, review, and shipping. Use when you have a plan ready and want to deliver the change as a green PR without further intervention.
---

# Delivering work

Take a PLAN.md and produce a pull request with passing CI. Chains `faber execute`, `faber review`, and `faber ship` with a review->fix loop in between.

Load `reviewing-faber-tasks` for the review->fix loop and `reading-faber-logs` for inspecting failed tasks.

## Step 1: Execute

Pass `--name <slug>` derived from the plan name so the execute task id is identifiable across the chain.

```bash
faber execute <plan-path> --background --name <slug>
faber watch <executeTaskId>
```

If the task ends `ready` with no diff, the agent thought it finished but produced nothing -- often it wrote files but didn't commit. Continue it with specific direction.

If the task ends `failed` or `stopped`, read the log to find the cause and continue with directed feedback addressing it.

Stop after two unproductive iterations.

## Step 2: Review

Once the executor has commits, run a final review, passing the plan's intent as context:

```bash
faber review --background --task <executeTaskId> --context 'final review before shipping. Intent of the change:

Add CSV export to the metrics endpoint so operators can download data.

Requirements:

- GET /metrics/export returns a valid CSV file
- Filename includes the current date
- Empty result sets return a header row only, not a 404' --name <slug>-review
```

Extract the Summary and Requirements sections from the PLAN.md and pass them as the context value. Do not include the Implementation section or reference the plan path — the reviewer should evaluate the change on its own merits as a solution to the stated intent.

Follow `reviewing-faber-tasks` to drive the review->fix loop. Merge when clean.

If the reviewer rejects the approach, it usually names the better one. Pass that alternative back to the executor as a re-direction, not a fix. If no alternative is named, surface to the user -- the plan needs reshaping.

## Step 3: Ship

```bash
faber ship --background --name <slug>-ship
faber watch <shipTaskId>
faber read <shipTaskId>
```

The PR URL is in the agent's last message. If the task ended `ready` but the URL isn't there, check `gh pr list --head <currentBranch>` -- the agent may have opened the PR without printing the URL.

If the task failed, read the log and continue with directed feedback. Push rejections, missing PR fields, and CI failures are all recoverable. Environment failures (`gh` not authenticated, no remote) are not.

Stop after two unproductive iterations.

## Step 4: Report

Tell the user the PR URL, or which step failed and what you tried.
