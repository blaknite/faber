---
name: orchestrating-faber-tasks
description: Runs a full multi-task orchestration loop from start to finish. Use when breaking a goal into parallel sub-tasks, dispatching them with faber run, and routing results through the review-merge-continue cycle.
---

# Orchestrating Faber tasks

This skill covers the full loop: break a goal into sub-tasks, dispatch them in parallel, wait for results, route each one, and repeat until the work is done.

Load these supporting skills before starting -- they cover the primitives this skill builds on:
- `running-faber-tasks` -- how to write prompts, run tasks, and watch for completion
- `reading-faber-tasks` -- how to list tasks and read their logs
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

## Step 2: Write prompts and dispatch the batch

Write prompts following the guidance in `running-faber-tasks`. Each sub-task runs in its own isolated worktree, so the agent starts cold -- include everything it needs in the prompt.

Always end each sub-task prompt with `Base branch: <branch>` so the agent knows where it was cut from.

Run all independent tasks upfront. Capture the task ID from each `faber run` output -- you'll need them to watch and route.

```bash
faber run "Add validation to POST /api/exports. ... Base branch: main"
# Dispatching task: a1b2-add-export-validation

faber run "Add validation to POST /api/imports. ... Base branch: main"
# Dispatching task: c3d4-add-import-validation
```

Note which tasks are independent and which are waiting on others. Don't dispatch a dependent task until the task it depends on has been merged.

## Step 3: Wait for the batch

Watch all running tasks in parallel -- each one blocks until its task finishes, and they don't interfere with each other.

```bash
faber watch a1b2-add-export-validation &
faber watch c3d4-add-import-validation &
wait
```

If you can't run them in the background, run them sequentially. The order doesn't matter -- each one exits as soon as its task is ready.

## Step 4: Route each finished task

Once a task finishes, run through the `merging-faber-tasks` decision loop: read the log, inspect the diff, then pick merge, done, or continue.

Do this for each task in the batch before dispatching the next round.

Don't wait for all tasks to finish before acting on the ones that are ready. Merge what's clean, continue what needs fixing, and move to the next round with whatever is left.

## Step 5: Dispatch follow-up tasks

After dependent tasks are merged, dispatch the work that was waiting on them.

Keep track of what's been merged and what's still in flight. A simple list works:

```
Round 1 (parallel):
  a1b2-add-export-validation    -> merged
  c3d4-add-import-validation    -> merged (after continue)

Round 2 (depends on round 1):
  g7h8-update-api-docs          -> watching...
```

## Step 6: Recognise when you're done

The goal is complete when:
- All tasks are either merged or done
- No tasks are running or waiting
- Nothing from the original goal is unaddressed

Run `faber list` to confirm nothing is still running or stuck in a ready state. If everything is `done` and the goal is met, the orchestration loop is finished.

## Handling failures and stuck tasks

If a task fails the same way twice, the prompt is probably wrong. Rewrite it with more context, a different scope, or a more constrained goal before continuing.

If a task keeps failing and the work can be done a different way, dismiss it and dispatch a replacement:

```bash
faber done <taskId>   # dismiss the stuck task
faber run "..."       # dispatch a replacement with a different framing
```

If a merge fails due to a conflict, follow the conflict recovery steps in `merging-faber-tasks`.

## Example: full orchestration

```bash
# Round 1: independent tasks, dispatch in parallel
faber run "Add rate limiting middleware. Limit unauthenticated requests to 60/min. Base branch: main"
# Dispatching task: aa11-rate-limiting-middleware

faber run "Add Redis client config. The rate limiter will use Redis as the store. Base branch: main"
# Dispatching task: bb22-redis-client-config

# Wait for both
faber watch aa11-rate-limiting-middleware &
faber watch bb22-redis-client-config &
wait

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
