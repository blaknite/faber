---
name: reviewing-faber-tasks
description: Assess what a ready Faber task produced and act on it. Use after faber watch returns to inspect the diff, form a judgment, and route the task to merge, done, continue, or delete.
---

# Reviewing Faber tasks

Load the `using-faber` skill for the full CLI reference. This skill covers the mechanics of assessing a completed task and routing it based on what you find.

## Step 1: Read the diff

Use `faber diff` to see what the task branch has on top of the base branch. Empty output means no changes were committed. If the diff alone doesn't give you enough to judge, load the `reading-faber-logs` skill for guidance on reading logs.

## Step 2: Review the changes

Read full changed files, not just diff hunks. The diff shows what changed; the file shows what it means. If the change touches a function, check its callers. If it changes a type, check its consumers. If it introduces a pattern, check whether the codebase already does the same thing a different way.

Look for problems in priority order:

1. **Correctness** -- Logic errors, wrong conditions, unhandled null/empty/error cases, off-by-one, ignored return values.
2. **Security** -- Unsanitized input, hardcoded secrets, missing auth checks. Only flag what you can trace to a concrete risk.
3. **Data integrity** -- Race conditions, missing transactions, inconsistent state on partial failure.
4. **Behavioral changes** -- Unintentional changes to existing behavior, especially in refactors.
5. **Pattern consistency** -- Handles something differently from how the rest of the codebase does it.
6. **Performance** -- Unbounded loops, N+1 queries, missing pagination. Only flag when the code path makes the problem realistic.

Don't flag style preferences unless they violate established project conventions. Don't review code the diff didn't touch. If you can't explain exactly why something is wrong, it's not a finding.

## Step 3: Route the task

Based on your findings, pick one of four paths.

**The work looks good and has commits:** merge it with `faber merge`. This rebases the task branch onto the current base branch HEAD, fast-forward merges it, and removes the worktree. Only merge when you're confident the changes are correct -- if something feels off but you can't pin it down, that's not "looks good."

**The task is ready but made no commits:** mark it done with `faber done`. Use this when the task was exploratory, when the agent correctly determined there was nothing to change, or when you want to keep the branch around for reference.

**The work needs correction, is incomplete, or you're unsure about something:** continue it with `faber continue "<new direction>"`. The agent picks up where it left off with full context of what it already did. Be specific about what's wrong, what's missing, or what you need investigated. After continuing, watch again and run through this loop from the top.

**The task should be discarded entirely:** delete it with `faber delete --yes`. Use this when the work is wrong enough that continuing isn't worth it, or when the task is no longer needed. This is irreversible.

## Conflict recovery

If `faber merge` fails with a conflict, the rebase is aborted automatically and the worktree is left intact. Continue the task with instructions to rebase onto the base branch, resolve the conflicts, and commit. Then watch again and retry the merge. If it conflicts again, repeat the loop -- give the agent more context about what changed on the base branch to help it resolve correctly.

## Examples

```bash
# The work looks good
faber diff b7c1-add-rate-limiting
# (diff looks correct -- middleware added, tests included)
faber merge b7c1-add-rate-limiting
# Merged and removed worktree.
```

```bash
# Task is ready but made no commits -- nothing to change was the right answer
faber diff b7c1-add-rate-limiting
# (empty -- agent correctly determined no changes were needed)
faber done b7c1-add-rate-limiting
```

```bash
# The implementation missed something
faber diff b7c1-add-rate-limiting
# (middleware added but no handling for admin users)
faber continue b7c1-add-rate-limiting "The rate limiter needs to skip authenticated admin users. Update the middleware and the tests."
faber watch b7c1-add-rate-limiting
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
# The work is too far off to salvage
faber diff b7c1-add-rate-limiting
# (completely wrong approach -- rewrote unrelated files)
faber delete b7c1-add-rate-limiting --yes
# Deleted. Dispatch a replacement with a better-scoped prompt.
```
