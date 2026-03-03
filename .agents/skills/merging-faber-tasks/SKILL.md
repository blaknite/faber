---
name: merging-faber-tasks
description: Decides what to do after faber watch returns for a task. Covers the decision loop an orchestrator runs after each task finishes: read the log, inspect the diff, then route to merge, done, or continue.
---

# Merging Faber tasks

After `faber watch <taskId>` returns, the task is no longer running. Before doing anything, understand what it actually did.

## Step 1: Read the log

```bash
faber read <taskId>
```

This prints the agent's log with tool calls summarised. If you need to see full file contents or diffs inline, add `--full`:

```bash
faber read <taskId> --full
```

Look for: what the agent changed, whether it committed, and whether it stopped cleanly or ran into trouble.

## Step 2: Inspect the diff

```bash
faber diff <taskId>
```

This shows what the task branch has on top of the base branch. Empty output means no changes were committed.

## Step 3: Route the task

Based on what you see, pick one of three paths.

### The work looks good and has commits: merge it

```bash
faber merge <taskId>
```

This rebases the task branch onto the current base branch HEAD, fast-forward merges it, and removes the worktree. The task moves to `done`.

### The task finished cleanly but made no commits (or you want to keep the branch): mark it done

```bash
faber done <taskId>
```

This marks the task `done` without touching the worktree or branch. Use this when the task was exploratory, when the agent correctly determined there was nothing to change, or when you want to keep the branch around for reference.

### The work needs correction or is incomplete: continue it

```bash
faber continue <taskId> "<new direction>"
```

This resumes the agent in the same session with the new prompt appended. The agent picks up where it left off, with full context of what it already did. Use this when the output is close but wrong, when the agent missed something, or when requirements changed.

After continuing, watch again and run through this decision loop from the top:

```bash
faber watch <taskId>
```

## Conflict recovery

If `faber merge` fails with a conflict, the rebase is aborted automatically and the worktree is left intact. Continue the task with instructions to resolve it:

```bash
faber continue <taskId> "The merge failed due to a conflict. Rebase the branch onto main, resolve any conflicts, and commit the result."
faber watch <taskId>
faber merge <taskId>
```

If it conflicts again, repeat the loop. Conflicts usually mean two tasks touched the same file -- give the agent enough context about what changed on main to resolve it correctly.

## Example: full decision flow

```bash
faber run "Add rate limiting to the API"
# Dispatching task: b7c1-add-rate-limiting

faber watch b7c1-add-rate-limiting
# Task b7c1-add-rate-limiting finished (status: ready)

faber read b7c1-add-rate-limiting
# Agent added middleware, wrote tests, committed two changes.

faber diff b7c1-add-rate-limiting
# (shows the diff -- looks correct)

faber merge b7c1-add-rate-limiting
# Merged and removed worktree.
```

```bash
# Task finished but made no commits -- nothing to change was the right answer
faber done b7c1-add-rate-limiting
```

```bash
# The implementation missed something
faber continue b7c1-add-rate-limiting "The rate limiter needs to skip authenticated admin users. Update the middleware and the tests."
faber watch b7c1-add-rate-limiting
faber merge b7c1-add-rate-limiting
```

```bash
# Merge failed due to conflict
faber merge b7c1-add-rate-limiting
# Error: merge conflict in src/middleware/rateLimit.ts

faber continue b7c1-add-rate-limiting "faber merge failed with a conflict in src/middleware/rateLimit.ts. Rebase onto main, resolve the conflict, and commit."
faber watch b7c1-add-rate-limiting
faber merge b7c1-add-rate-limiting
# Merged and removed worktree.
```
