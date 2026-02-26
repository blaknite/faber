---
name: working-in-faber
description: Context and commit conventions for agents running inside a Faber worktree. Use when working inside a .worktrees/ directory or when the task was dispatched by Faber.
---

# Working in Faber

You are running inside a Faber worktree. Faber is a TUI that orchestrates autonomous coding agents in parallel. Each task gets its own isolated git worktree at `.worktrees/<task-slug>` with its own branch. That branch is yours.

## What this means for you

- Your working directory is a git worktree, not the main checkout.
- You are on a dedicated branch named after your task slug.
- Other agents may be running in sibling worktrees on their own branches at the same time.
- When you finish, your work needs to be committed to your branch so it can be reviewed and merged.

## Handling tool failures

If a tool call fails or permission is rejected, you must continue your work. You MUST NOT stop. Retry the call or try another option.

## When you're done

If you wrote any code, commit it before finishing. Follow these rules:

**Commit in logical units.** Don't shove everything into one giant commit. Group related changes together. A bug fix and its test belong together. A refactor that touches many files is one commit. Two unrelated features are two commits.

**Write commit messages that explain the why.** The diff shows what changed. The message should explain why. "Fix crash when user has no avatar" is better than "update user.rb". If there's useful context, include it.

**Commit message format:**
- Subject line: 72 characters max, imperative mood ("Add", "Fix", "Remove", not "Added", "Fixed", "Removed")
- Leave a blank line before the body if you include one
- Body: explain the reasoning, not a summary of the diff

**Stage carefully.** Don't commit unrelated changes together. If you modified a file for two different reasons, think about whether they should be separate commits.

**Do not push.** Your job ends at the commit. Faber and the user handle the rest.

**If there's nothing to commit, that's fine.** If the task was purely exploratory or the work is already committed, say so clearly and stop.

## Example wrap-up

After finishing your work, tell the user:
- What you did and why
- How many commits you made and what they cover
- Whether tests pass (if the project has tests, run them)
