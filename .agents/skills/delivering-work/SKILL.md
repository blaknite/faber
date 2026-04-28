---
name: delivering-work
description: Takes a PLAN.md and drives it through implementation, review, and shipping. Use when you have a plan ready and want to deliver the change as a green PR without further intervention.
---

# Delivering work

Take a PLAN.md and produce a pull request with passing CI. Input: a path to a PLAN.md. Output: a PR URL. This skill chains three faber subcommands -- `faber execute`, `faber review`, and `faber ship` -- with a review->fix loop in between when needed.

## Why this is a separate skill from `executing-work`

`executing-work` ends with the implementer's own pre-handoff review: a sanity check by the agent that wrote the code. This skill is the next agent in the chain. It did not write the code and cannot rely on the implementer's self-assessment. It runs its own post-handoff review before shipping because shipping creates external artefacts (a PR, CI runs) that are expensive to roll back.

Reference `reviewing-faber-tasks` for the review->fix loop mechanics and `using-faber` for command flags and exit codes.

## Step 1: Execute the plan

Run `faber execute` in foreground mode and capture the task ID from the printed status line (`Task <shortId> ended in status: <status>`):

```bash
faber execute <plan-path>
```

When it returns, read the status line. If the status is `failed` or `stopped`, or if `faber diff <executeTaskId>` produces empty output (no commits), surface the situation to the user and stop. Do not attempt to ship a broken or empty implementation.

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

Run `faber ship` in foreground mode against the current branch (the orchestrator's branch, which now includes the merged executor work). Run in foreground mode to capture the status line and final message:

```bash
faber ship
```

Read the agent's last message for the PR URL. The prompt asks the ship agent for `PR: <url>`. Surface that URL to the user.

If the status line shows anything other than `ready`, or if the final message does not contain a parseable PR URL, surface what happened and stop. Do not retry ship -- CI flakes are the user's call, not the orchestrator's.

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
4. **Ship failed.** `faber ship` printed a non-`ready` status, or the agent's final message did not include a PR URL.

Do not loop indefinitely. Do not delete tasks autonomously. Preserve the failure state for the user to inspect.

## What this skill does not do

- No autonomous deletion or rollback of any task.
- No skipping the review step on the assumption that `executing-work` already reviewed -- that was a different agent with a different lens.
- No retrying ship more than once.
