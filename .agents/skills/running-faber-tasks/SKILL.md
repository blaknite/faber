---
name: running-faber-tasks
description: Runs prompts in Faber tasks via the CLI. Use when creating autonomous tasks or submitting work to Faber.
---

# Running Faber Tasks

## What is Faber?

Faber is a terminal UI for running multiple autonomous coding agents in parallel. You give it a prompt, and it creates an isolated git worktree, spins up an agent to work on the task, and keeps the work organized while you dispatch more tasks.

## Writing a task prompt

A good prompt gives the agent enough to work independently. Three things matter:

**What to do.** Be specific about the goal. "Add CSV export to the metrics endpoint" is better than "add export support".

**Why it matters or what to watch out for.** If there's relevant context the agent can't discover from the code, include it. Known pitfalls, related work, constraints.

**What done looks like.** Describe the expected behaviour.

Example:

```
Fix the crash when users with no avatar visit their profile.

User#avatar_url returns nil when no avatar is set, which breaks the
profile template. Add a fallback to a default avatar URL.

Visiting a profile without an avatar should show the default image
instead of crashing.
```

## Running a task

Use `faber run`:

```bash
faber run "your prompt here"
```

Or for a specific project directory use:

```bash
faber run "your prompt here" --dir <projectDir>
```

You can also pass `--model` to choose the model for the task. The default is `smart`:

```bash
faber run "your prompt here" --model smart
```

Valid model labels are `smart`, `fast`, and `deep`.

That's it. Faber handles the rest.

## Watching a task

After dispatching a task headlessly, you can wait for it to finish using `faber watch`:

```bash
faber watch <taskId>
```

The task ID is the slug printed by `faber run` (e.g. `a3f2-fix-the-login-bug`). `faber watch` blocks until the task is no longer running, then exits. This is useful in scripts that dispatch a task and need to wait for the result before continuing.

If the task is already finished when you run `faber watch`, it exits immediately.

Example:

```bash
faber run "Fix the login bug"
# Dispatching task: a3f2-fix-the-login-bug

faber watch a3f2-fix-the-login-bug
# Watching task a3f2-fix-the-login-bug (status: running)
# Task a3f2-fix-the-login-bug finished (status: ready)
```
