---
name: reviewing-faber-tasks
description: Assess what a ready Faber task produced and act on it. Use after faber watch returns to dispatch a review and route the task to merge, done, continue, or delete.
---

# Reviewing Faber tasks

Load the `using-faber` skill for the full CLI reference. This skill covers
the mechanics of assessing a completed task and routing it based on what
the review found.

## Step 1: Run a review

Dispatch a review in the background using these four calls in sequence:

**1. Dispatch the review:**

```bash
faber review --background --task <originalTaskId>
# Task <reviewTaskId> running  <- capture this ID
```

`faber review --task` rejects tasks that aren't `ready` and tasks with no commits. If the task has no commits, the command errors before dispatching a review task -- skip to Step 2's no-commits path.

Pass `--context` if you have a quick steer for the reviewer -- a constraint that emerged after dispatch, scope that's out of bounds, a follow-up direction:

```bash
faber review --background --task <originalTaskId> --context 'the auth changes are the focus; tests are deferred'
```

For trivial mechanical changes you can pass `--model fast` to save tokens, but the default is right for almost everything.

**2. Wait for the review to finish:**

```bash
faber watch <reviewTaskId>
```

**3. Read the findings:**

```bash
faber read <reviewTaskId>
```

The findings are the final text section starting with `# Review Findings`. If the review task ended in `failed` or `stopped` (visible via `faber list`, or absent findings heading), the review didn't complete -- retry the four-call sequence or escalate rather than routing the original task.

**4. Close the review task:**

```bash
faber done <reviewTaskId>
```

Background mode does not auto-complete the review task, so this step is required.

If you need more context than the findings give you -- to understand what the agent attempted, or why -- load the `reading-faber-logs` skill.

## Step 2: Route the task

Pick one of four paths based on the review findings.

**The work looks good and has commits:** merge it with `faber merge`. This rebases the task branch onto the current base branch HEAD, fast-forward merges it, and removes the worktree. Only merge when the review came back clean (or with findings you've judged not to be blockers).

**The task is ready but made no commits:** call `faber done <originalTaskId>` directly. No review task was dispatched (Step 1 errored before dispatching it), so there is nothing to clean up on the review side.

**The work needs correction, is incomplete, or you're unsure about something:** send directed feedback with `faber continue <originalTaskId> '<feedback>'` and move to Step 3. Write the prompt as a self-contained instruction -- the executing agent has not seen the review, so describe the change to make in its own terms. Continue the *original* task, not the review task. (`faber continue <reviewTaskId>` is for asking the reviewer follow-up questions while the review task is still open -- a separate use case from the fix loop.)

**The task should be discarded entirely:** delete it with `faber delete <taskId> --yes`. Use this when the work is wrong enough that continuing isn't worth it, or when the task is no longer needed. This is irreversible.

## Step 3: The review->fix loop

When a review surfaces findings that need addressing, the pattern is:

**1. Send directed feedback to the original task:**

```bash
faber continue <originalTaskId> '<directed feedback>'
```

The executing agent has no view into the review -- only what you write here. State what to change, where (using `path:line` references from the review), and what done looks like. Bound scope positively: "limit changes to X". If you're intentionally leaving something unaddressed, record it for the next reviewer via `--context` (step 3 below).

**2. Wait for the fix:**

```bash
faber watch <originalTaskId>
```

**3. Run a fresh review** using Step 1's four calls. The new reviewer is a fresh task -- it has the diff and your `--context`, nothing else. Pass the intent of the change and any concrete out-of-scope items so the reviewer evaluates the diff on its own merits.

```bash
faber review --background --task <originalTaskId> --context 'Intent of the change:

Cap unauthenticated traffic to 60 requests per minute, with admins exempt.

Out of scope:

- Per-user override limits
- The legacy /login throttle
- Anything in src/admin/'
```

Each iteration dispatches a new review task. Without `--context`, the reviewer may re-flag findings you've already decided to leave alone.

**4. Route via Step 2** -- merge if clean, continue if there are new findings, delete if the approach is wrong.

**When to stop looping:** stop after two unproductive iterations and surface the situation to the user. An iteration is unproductive if (a) the same finding comes back unfixed, or (b) each fix introduces a different problem -- meaning the task isn't converging. Don't loop indefinitely.

### Conflict recovery

If `faber merge` fails with a conflict, the rebase is aborted automatically and the worktree is left intact. This follows the same shape as the fix loop:

```bash
faber continue <originalTaskId> 'faber merge failed with a conflict in <file>. Rebase onto the base branch, resolve the conflict, and commit.'
faber watch <originalTaskId>
faber merge <originalTaskId>
```

If it conflicts again, repeat -- give the agent more context about what changed on the base branch to help it resolve correctly.

## Examples

```bash
# Clean review -> merge
faber review --background --task b7c1-add-rate-limiting
# Task r1v2-review-b7c1-add-rate-limiting running  <- capture this ID
faber watch r1v2-review-b7c1-add-rate-limiting
faber read r1v2-review-b7c1-add-rate-limiting
# (findings section shows nothing blocking)
faber done r1v2-review-b7c1-add-rate-limiting
faber merge b7c1-add-rate-limiting
```

```bash
# No commits -> faber done
faber review --background --task b7c1-add-rate-limiting
# Error: Task "b7c1-add-rate-limiting" has no commits to review.
faber done b7c1-add-rate-limiting
```

```bash
# Findings -> fix loop -> merge
faber review --background --task b7c1-add-rate-limiting
# Task r1v2-review-b7c1-add-rate-limiting running  <- capture this ID
faber watch r1v2-review-b7c1-add-rate-limiting
faber read r1v2-review-b7c1-add-rate-limiting
# findings: admin users aren't skipped (src/middleware/rateLimit.ts:42)
faber done r1v2-review-b7c1-add-rate-limiting

faber continue b7c1-add-rate-limiting 'The rate limiter at src/middleware/rateLimit.ts:42 does not skip admin users. Update the middleware to exempt admin users from the limit and update the tests to cover this case. Limit changes to the rate limiter and its tests.'
faber watch b7c1-add-rate-limiting

faber review --background --task b7c1-add-rate-limiting --context 'Intent of the change:

Cap unauthenticated traffic to 60 requests per minute, with admins exempt.

Out of scope:

- Per-user override limits'
# Task r3v4-review-b7c1-add-rate-limiting running  <- capture this ID
faber watch r3v4-review-b7c1-add-rate-limiting
faber read r3v4-review-b7c1-add-rate-limiting
# (findings section shows nothing blocking)
faber done r3v4-review-b7c1-add-rate-limiting
faber merge b7c1-add-rate-limiting
```

```bash
# Conflict on merge -- follow the conflict recovery pattern from Step 3
faber merge b7c1-add-rate-limiting
# Error: merge conflict in src/middleware/rateLimit.ts
faber continue b7c1-add-rate-limiting 'faber merge failed with a conflict in src/middleware/rateLimit.ts. Rebase onto main, resolve the conflict, and commit.'
faber watch b7c1-add-rate-limiting
faber merge b7c1-add-rate-limiting
```

```bash
# Approach is wrong -> delete
faber review --background --task b7c1-add-rate-limiting
# Task r1v2-review-b7c1-add-rate-limiting running  <- capture this ID
faber watch r1v2-review-b7c1-add-rate-limiting
faber read r1v2-review-b7c1-add-rate-limiting
# findings: the approach patches the wrong layer; this needs to be redone at the router level
faber done r1v2-review-b7c1-add-rate-limiting
faber delete b7c1-add-rate-limiting --yes
```
