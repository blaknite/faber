---
name: reviewing-faber-tasks
description: Assess what a ready Faber task produced and act on it. Use after faber watch returns to dispatch a review and route the task to merge, done, continue, or delete.
---

# Reviewing Faber tasks

Load the `using-faber` skill for the full CLI reference. This skill covers
the mechanics of assessing a completed task and routing it based on what
the review found.

## Step 1: Run a review

Use `faber review --task <id>` to dispatch a review of the task's branch
against its base. The review runs as another faber task at the `deep` tier
and blocks until it finishes, then prints its findings to stdout. The
original task prompt is automatically included in the review prompt, so
the reviewer knows what was asked.

If you have additional context the reviewer should know -- a follow-up
direction, a constraint that emerged after dispatch, or "ignore the test
file changes, those are out of scope" -- pass it with `--context`:

```bash
faber review --task <id> --context "the auth changes are the focus; tests are deferred"
```

`faber review --task` rejects tasks that aren't `ready` and tasks with no
commits. If the task has no commits, skip to `faber done` (see Step 2).
For trivial mechanical changes you can pass `--model fast` to save tokens,
but the default is right for almost everything.

The review task itself is auto-completed once it finishes, so you don't
need to chase it down with `faber done`. If you want to ask the reviewer
follow-up questions, the `faber continue <reviewTaskId>` hint at the end
of the output still works.

If you need more context than the findings give you -- to understand what
the agent attempted, or why -- load the `reading-faber-logs` skill.

## Step 2: Route the task

Pick one of four paths based on the review findings.

**The work looks good and has commits:** merge it with `faber merge`. This rebases the task branch onto the current base branch HEAD, fast-forward merges it, and removes the worktree. Only merge when the review came back clean (or with findings you've judged not to be blockers).

**The task is ready but made no commits:** mark it done with `faber done`. This case is reached when `faber review --task` errors with `Task "<id>" has no commits to review.`; the response is to call `faber done` directly.

**The work needs correction, is incomplete, or you're unsure about something:** continue it with `faber continue "<new direction>"`. The agent picks up where it left off with full context of what it already did. Use the review findings as the basis for the new prompt. Be specific about which findings to address and which to ignore. After continuing, watch again and run through this loop from the top.

**The task should be discarded entirely:** delete it with `faber delete --yes`. Use this when the work is wrong enough that continuing isn't worth it, or when the task is no longer needed. This is irreversible.

## Conflict recovery

If `faber merge` fails with a conflict, the rebase is aborted automatically and the worktree is left intact. Continue the task with instructions to rebase onto the base branch, resolve the conflicts, and commit. Then watch again and retry the merge. If it conflicts again, repeat the loop -- give the agent more context about what changed on the base branch to help it resolve correctly.

## Examples

```bash
# The work looks good
faber review --task b7c1-add-rate-limiting
# (review finds nothing blocking)
faber merge b7c1-add-rate-limiting
# Merged and removed worktree.
```

```bash
# Task has no commits -- review surfaces the error, then mark done
faber review --task b7c1-add-rate-limiting
# Error: Task "b7c1-add-rate-limiting" has no commits to review.
faber done b7c1-add-rate-limiting
```

```bash
# Review flagged something -- continue with specific feedback
faber review --task b7c1-add-rate-limiting
# Review flagged that admin users aren't skipped.
faber continue b7c1-add-rate-limiting "The review found that admin users aren't skipped by the rate limiter. Update the middleware and the tests."
faber watch b7c1-add-rate-limiting
faber review --task b7c1-add-rate-limiting
faber merge b7c1-add-rate-limiting
```

```bash
# Merge failed due to a conflict
faber merge b7c1-add-rate-limiting
# Error: merge conflict in src/middleware/rateLimit.ts
faber continue b7c1-add-rate-limiting "faber merge failed with a conflict in src/middleware/rateLimit.ts. Rebase onto main, resolve the conflict, and commit."
faber watch b7c1-add-rate-limiting
faber merge b7c1-add-rate-limiting
# Merged and removed worktree.
```

```bash
# The approach is wrong -- discard
faber review --task b7c1-add-rate-limiting
# Review flagged that the approach is fundamentally wrong.
faber delete b7c1-add-rate-limiting --yes
```
