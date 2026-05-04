---
name: orchestrating-faber-tasks
description: Mechanics of running multiple Faber tasks in parallel. Covers dispatching batches, watching them, tracking rounds, and handling failures.
---

# Orchestrating Faber tasks

Load the `using-faber` skill for the full CLI reference. This skill covers the mechanics of running multiple tasks through Faber: dispatching batches, watching them, and managing rounds.

## Dispatching a batch

Write prompts following the guidance in `running-faber-tasks`. Each sub-task runs in its own isolated worktree, so the agent starts cold -- include everything it needs in the prompt.

Choose the right model for each task -- see `using-faber` for guidance on `fast`, `smart`, and `deep`.

Use the `--base` flag to set the branch your sub-tasks should branch from. The orchestrator runs in its own worktree on its own branch -- use `--base $(git branch --show-current)` so child worktrees branch from the orchestrator's branch instead of the main checkout.

Capture each task ID as you dispatch. Don't dispatch a dependent task until the task it depends on has been merged.

## Watching a batch

Watch all running tasks in parallel using `faber watch` in the background for each task ID. If you can't run them in the background, run them sequentially -- each one exits as soon as its task is ready, so the order doesn't matter.

Don't wait for all tasks to be ready before acting on the ones that are. Review what's done, route it, and move on.

## Reviewing and routing tasks

Load `reviewing-faber-tasks` for the mechanics of reading diffs and routing each task to merge, continue, done, or delete.

## Tracking progress

Keep track of what's been merged and what's still in flight:

```
Round 1 (parallel):
  a1b2-add-export-validation    -> merged
  c3d4-add-import-validation    -> merged (after continue)

Round 2 (depends on round 1):
  g7h8-update-api-docs          -> watching...
```

Use `faber list` to confirm nothing is outstanding.

## Handling failures and stuck tasks

If a task fails the same way twice, the prompt is probably wrong. Rewrite it with more context, a different scope, or a more constrained goal before retrying.

If a task keeps failing and the work can be done a different way, delete it and dispatch a replacement with a different framing.

Pass `--name <slug>` for every task. Orchestration is much easier to follow when each task id reflects what it does.

## Example

```bash
# Round 1: independent tasks, dispatch in parallel
faber run "Add rate limiting middleware. Limit unauthenticated requests to 60/min." --base $(git branch --show-current) --name rate-limiting-middleware
# Dispatching task: aa11bb-rate-limiting-middleware

faber run "Add Redis client config. The rate limiter will use Redis as the store." --base $(git branch --show-current) --name redis-client-config
# Dispatching task: bb22cc-redis-client-config

# Wait for both in parallel
faber watch aa11bb-rate-limiting-middleware &
faber watch bb22cc-redis-client-config &
wait

# Review and route each one (see reviewing-faber-tasks)
# aa11bb looks good -- merge it
faber merge aa11bb-rate-limiting-middleware

# bb22cc missed something -- continue it
faber continue bb22cc-redis-client-config "Add connection pooling config, the rate limiter needs it."
faber watch bb22cc-redis-client-config
faber merge bb22cc-redis-client-config

# Round 2: depends on both being merged
faber run "Wire the rate limiting middleware to the Redis client. Integration tests must pass." --base $(git branch --show-current) --name wire-rate-limiter-to-redis
# Dispatching task: cc33dd-wire-rate-limiter-to-redis

faber watch cc33dd-wire-rate-limiter-to-redis
faber merge cc33dd-wire-rate-limiter-to-redis

# Confirm nothing is left outstanding
faber list
```
