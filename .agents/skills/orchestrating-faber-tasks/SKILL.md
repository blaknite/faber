---
name: orchestrating-faber-tasks
description: Runs a full multi-task orchestration loop from start to finish. Use when breaking a goal into parallel sub-tasks, dispatching them with faber run, and routing results through the review-merge-continue cycle.
---

# Orchestrating Faber tasks

This skill covers the full loop: break a goal into sub-tasks, dispatch them in parallel, wait for results, route each one, and repeat until the work is done.

For the primitives, load the supporting skills:
- `running-faber-tasks` -- how to run and watch tasks
- `reading-faber-tasks` -- how to read task logs and list tasks
- `merging-faber-tasks` -- how to route a finished task (merge, done, or continue)

## The loop at a glance

1. Break the goal into independent sub-tasks
2. Dispatch all of them upfront with `faber run`, capture each task ID
3. Watch the batch in parallel with `faber watch`
4. Route each finished task using `merging-faber-tasks`
5. Dispatch follow-up tasks for anything that depends on earlier results
6. Repeat until all tasks are merged or done and nothing is outstanding

## Step 1: Break the goal into sub-tasks

Before dispatching anything, identify which parts of the goal are independent and which must sequence. Independent work can run in parallel from the start. Work that depends on a prior result has to wait.

A task is independent when:
- It touches different files or systems than the others
- It doesn't need to know what another task decided or produced
- It can be reviewed and merged without coordination

A task must sequence when:
- It builds on code that doesn't exist yet
- It needs to know the API or schema that a prior task will define
- Merging it before the other task would break the build

If in doubt, lean toward sequencing. Two tasks that conflict on the same file are harder to recover from than a slightly longer wall clock time.

## Step 2: Write self-contained prompts

Each sub-task runs in its own isolated worktree. The agent starts cold -- it has only what you put in the prompt and what it can discover from the code. Don't assume it knows the goal of the wider effort.

A good sub-task prompt includes:

- **What to do** -- specific enough that the agent can start without guessing
- **What done looks like** -- the expected behaviour or test outcome
- **Relevant constraints** -- known pitfalls, things to avoid, related files to check
- **Base branch** -- always include `Base branch: <branch>` at the end

Example:

```
Add request validation to the POST /api/exports endpoint.

The endpoint currently accepts any body. It should reject requests missing
the `format` field (valid values: csv, json, xlsx) with a 422 and a
descriptive error message.

Add tests covering the happy path and each invalid input case.

Base branch: main
```

Keep prompts focused. A task that tries to do too much is hard to review and hard to continue if it goes sideways. If the scope feels large, split it.

## Step 3: Dispatch the batch

Run all independent tasks upfront. Capture the task ID from each `faber run` output -- you'll need them to watch and route.

```bash
faber run "Add validation to POST /api/exports. ... Base branch: main"
# Dispatching task: a1b2-add-export-validation

faber run "Add validation to POST /api/imports. ... Base branch: main"
# Dispatching task: c3d4-add-import-validation

faber run "Write integration tests for the validation middleware. ... Base branch: main"
# Dispatching task: e5f6-validation-integration-tests
```

Note which tasks are independent and which are waiting on others. Don't dispatch a dependent task until the task it depends on has been merged.

## Step 4: Wait for the batch

Watch all running tasks. Run multiple `faber watch` calls in parallel -- each one blocks until its task finishes, and they don't interfere with each other.

```bash
faber watch a1b2-add-export-validation &
faber watch c3d4-add-import-validation &
faber watch e5f6-validation-integration-tests &
wait
```

If you can't run them in the background, run them sequentially. The order doesn't matter much -- each one exits as soon as its task is ready.

## Step 5: Route each finished task

Once a task finishes, run through the `merging-faber-tasks` decision loop for it: read the log, inspect the diff, then pick merge, done, or continue.

Do this for each task in the batch before dispatching the next round.

### Mixed outcomes

A batch rarely finishes cleanly all at once. Expect a mix:

- **Merged** -- the work is in, no further action needed for this task
- **Done (no commits)** -- the agent correctly found nothing to change; move on
- **Continued** -- the output needed correction; re-watch this task before the next round

Don't wait for all tasks to merge before acting on the ones that are ready. Merge what's clean, continue what needs fixing, and move to the next round with whatever is left.

Example routing after a batch finishes:

```bash
# a1b2 looks good
faber read a1b2-add-export-validation   # log looks clean
faber diff a1b2-add-export-validation   # diff looks right
faber merge a1b2-add-export-validation

# c3d4 missed a case
faber read c3d4-add-import-validation   # agent skipped the 422 for missing format
faber continue c3d4-add-import-validation "The 422 response for a missing format field is missing. Add it and update the tests."
faber watch c3d4-add-import-validation
faber merge c3d4-add-import-validation

# e5f6 made no commits -- the tests already existed
faber done e5f6-validation-integration-tests
```

## Step 6: Dispatch follow-up tasks

After the first round is merged, you can dispatch tasks that depended on that work.

```bash
# Now that validation is in, dispatch the dependent task
faber run "Update the API docs to document the new 422 responses for /api/exports and /api/imports. ... Base branch: main"
# Dispatching task: g7h8-update-api-docs
```

Keep track of what's been merged and what's still in flight. A simple mental (or written) list works:

```
Round 1 (parallel):
  a1b2-add-export-validation    -> merged
  c3d4-add-import-validation    -> merged (after continue)
  e5f6-validation-integration-tests -> done

Round 2 (depends on round 1):
  g7h8-update-api-docs          -> watching...
```

## Step 7: Recognise when you're done

The goal is complete when:
- All tasks are either merged or done
- No tasks are running or waiting
- Nothing from the original goal is unaddressed

Run `faber list` to confirm nothing is still running or stuck in a ready state:

```bash
faber list
```

If everything is `done` and the goal is met, the orchestration loop is finished.

## Handling failures and stuck tasks

If a task fails or the agent stops without finishing:

```bash
faber continue <taskId> "<corrected direction>"
faber watch <taskId>
```

If a task fails the same way twice, the prompt is probably wrong. Rewrite it with more context, a different scope, or a more constrained goal before continuing.

If a task keeps failing and the work can be done a different way, consider dismissing it and dispatching a new task with a different approach:

```bash
faber done <taskId>   # dismiss the stuck task
faber run "..."       # dispatch a replacement with a different framing
```

If a merge fails due to a conflict, follow the conflict recovery steps in `merging-faber-tasks`. Two tasks that touched the same file is the most common cause -- give the second agent enough context about what the first one changed so it can resolve the conflict cleanly.

## Example: full orchestration

```bash
# Round 1: independent tasks, dispatch in parallel
faber run "Add rate limiting middleware. Limit unauthenticated requests to 60/min. Base branch: main"
# Dispatching task: aa11-rate-limiting-middleware

faber run "Add Redis client config. The rate limiter will use Redis as the store. Base branch: main"
# Dispatching task: bb22-redis-client-config

# Wait for both
faber watch aa11-rate-limiting-middleware
faber watch bb22-redis-client-config

# Route them
faber read aa11-rate-limiting-middleware && faber diff aa11-rate-limiting-middleware
faber merge aa11-rate-limiting-middleware

faber read bb22-redis-client-config && faber diff bb22-redis-client-config
faber merge bb22-redis-client-config

# Round 2: depends on both being merged
faber run "Wire the rate limiting middleware to the Redis client. Integration tests must pass. Base branch: main"
# Dispatching task: cc33-wire-rate-limiter-to-redis

faber watch cc33-wire-rate-limiter-to-redis
faber read cc33-wire-rate-limiter-to-redis && faber diff cc33-wire-rate-limiter-to-redis
faber merge cc33-wire-rate-limiter-to-redis

# Done -- faber list shows everything as done, goal is met
faber list
```
