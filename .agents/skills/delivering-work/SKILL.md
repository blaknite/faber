---
name: delivering-work
description: Takes a PLAN.md and drives it through implementation, review, and shipping. Use when you have a plan ready and want to deliver the change as a green PR without further intervention.
---

# Delivering work

Take a PLAN.md and produce a pull request with passing CI. Input: a path to a PLAN.md. Output: a PR URL. This skill chains three faber subcommands -- `faber execute`, `faber review`, and `faber ship` -- with a review->fix loop in between when needed.

Reference `reviewing-faber-tasks` for the review->fix loop mechanics and `using-faber` for command flags and exit codes.

## Step 1: Execute the plan

Dispatch the executor in the background, then watch it to completion:

```bash
faber execute <plan-path> --background
# Task <executeTaskId> running  <- capture this ID
faber watch <executeTaskId>
# Task <executeTaskId> finished (status: <status>)
```

If the status is `failed` or `stopped`, or if `faber diff <executeTaskId>` produces empty output (no commits), surface the situation to the user and stop. Do not attempt to ship a broken or empty implementation.

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
- **Approach is fundamentally wrong** -- surface the finding to the user and stop. Do not delete the executor task autonomously; the user decides what to do with it.

## Step 3: Ship the merged branch

Dispatch the ship agent in the background, then watch it to completion. The current branch (the orchestrator's branch) now includes the merged executor work, so `faber ship` with no flags ships that:

```bash
faber ship --background
# Task <shipTaskId> running  <- capture this ID
faber watch <shipTaskId>
# Task <shipTaskId> finished (status: <status>)
faber read <shipTaskId>
```

The PR URL is in the ship agent's last message. Surface it to the user.

If the status is anything other than `ready`, or if the agent's last message does not contain a PR URL, surface what happened and stop. Do not retry ship -- CI flakes are the user's call, not the orchestrator's.

## Step 4: Surface a summary

End with a short report regardless of how the workflow ended:

- Plan path
- Executor task ID
- Review iterations (count and outcome)
- PR URL, or the reason there isn't one

## Failure modes

Four conditions end the workflow before a PR is open. In each case, output a clear summary of what stage failed and what was tried, then stop.

1. **Executor failed.** Status is `failed` or `stopped`, or `faber diff <executeTaskId>` is empty. Cannot ship nothing.
2. **Review never converged.** Two iterations of continue -> review -> findings, with the same finding returning unfixed or new findings appearing each time.
3. **Reviewer flagged a fundamentally wrong approach.** A finding that says the work needs to be redone differently. This is a re-shaping decision; stop and surface to the user.
4. **Ship failed.** The ship task ended in a non-`ready` status, or the agent's last message did not include a PR URL.

Do not loop indefinitely. Do not delete tasks autonomously. Preserve the failure state for the user to inspect.
