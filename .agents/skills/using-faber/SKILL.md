---
name: using-faber
description: CLI reference for Faber. Covers every command an agent might need to dispatch, watch, inspect, and route tasks. No role logic -- just the raw interactions.
---

# Using Faber

Faber is a terminal UI for running multiple autonomous coding agents in parallel. Each task gets its own isolated git worktree and an agent to work on it. You interact with Faber through the `faber` CLI.

## Running a task

```bash
faber run "your prompt here"
```

For a specific project directory:

```bash
faber run "your prompt here" --dir <projectDir>
```

To choose a model:

```bash
faber run "your prompt here" --model smart
```

To set the branch the worktree is created from:

```bash
faber run "your prompt here" --base <branch>
```

`--base` sets the branch the worktree is created from, and tells the agent where to diff from. Defaults to the current branch of the main checkout.

To give the task a meaningful name:

```bash
faber run "your prompt here" --name <slug>
```

## Naming tasks

Always pass `--name <slug>` with a short kebab-case description of the work (e.g. `fix-login-crash`, `add-csv-export`). The task id becomes `<6hex>-<slug>` instead of being derived from the prompt text, which keeps task lists readable and makes ids easy to refer back to. Use lowercase letters, digits, and hyphens; aim for 2-5 words.

Valid model labels are `fast`, `smart`, and `deep`:

- `fast`: mechanical or well-scoped tasks where the path is obvious. Reformatting, renaming, boilerplate, simple one-file fixes.
- `smart`: the right default for most real work. Anything that requires understanding context across files, making judgment calls, or following a multi-step plan.
- `deep`: tasks where getting it wrong is expensive or the problem is genuinely hard to frame. Architecture decisions, elusive bugs, competing constraints.

`faber run` prints a task ID (e.g. `a3f21b-fix-the-login-bug`). Capture it -- you'll need it for every other command.

## Watching a task

Blocks until a task is no longer running, then exits:

```bash
faber watch <taskId>
```

Exits immediately if the task is already in a terminal state (`ready`, `done`, `failed`, or `stopped`). Useful in scripts that dispatch a task and need to wait before continuing.

## Reviewing a task

```bash
faber review --background [--task <id>] [--branch <name>] [--pull-request <num-or-url>] [--context <text>] [--model <label>] [--name <slug>]
```

`--background` is the mode agents use. Without it, the command runs in the foreground for humans -- spinner, rendered findings, auto-complete. That mode is not suitable for agents.

With `--background`, the command prints `Task <reviewTaskId> running` and exits immediately. The caller is responsible for watching, reading, and closing the review task. Background mode does not auto-complete the review task.

```bash
faber review --background --task <taskId> --name <slug>
# Task <reviewTaskId> running  <- capture this ID
faber watch <reviewTaskId>
faber read <reviewTaskId>
faber done <reviewTaskId>
```

The findings are the final assistant message in the review task log, identifiable by the `# Review Findings` heading. Everything before that heading in `faber read` output is tool calls and earlier messages. Locate the heading and read from there.

Use `--context` to pass the reviewer anything it should know: scope that is out of bounds, follow-up direction, what was addressed in a previous iteration. Use `--model fast` for trivial changes; the default deep tier is right for almost everything.

Load `reviewing-faber-tasks` for the full review->fix loop pattern.

## Listing tasks

```bash
faber list
```

Prints a table of all tasks with their ID, status, elapsed time, and prompt. Filter by status:

```bash
faber list --status running
faber list --status ready
faber list --status failed
```

## Reading a task log

```bash
faber read <taskId>
```

Prints the agent's log with tool calls summarised as one-liners. To expand everything including file contents and diffs:

```bash
faber read <taskId> --full
```

## Inspecting a task diff

```bash
faber diff <taskId>
```

Shows what the task branch has on top of the base branch. Empty output means no changes were committed.

## Merging a task

```bash
faber merge <taskId>
```

Rebases the task branch onto the current base branch HEAD, fast-forward merges it, and removes the worktree. The task moves to `done`.

## Marking a task done

```bash
faber done <taskId>
```

Marks the task `done` without touching the worktree or branch. Use when the task was exploratory, when the agent correctly determined there was nothing to change, or when you want to keep the branch around for reference.

## Continuing a task

```bash
faber continue <taskId> "<new direction>"
```

Resumes the agent in the same session with the new prompt appended. The agent picks up where it left off with full context of what it already did.

## Deleting a task

```bash
faber delete <taskId> --yes
```

Removes the task from state, its worktree, and its branch. This is destructive and cannot be undone. The command prompts for confirmation before proceeding. Pass `--yes` to skip the prompt.

Running tasks are rejected -- stop the task before deleting it.
