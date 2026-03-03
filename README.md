# faber

[![Build status](https://badge.buildkite.com/8fb27e4a3237fe4b1eb4aee9e060756e262e9fa471ccbf6168.svg)](https://buildkite.com/blaknite/faber)

A terminal UI for running multiple autonomous coding agents in parallel. Give it a prompt, it spins up a git worktree and a [opencode](https://opencode.ai) agent to work on it, while you keep dispatching more tasks.

<img width="1297" height="298" alt="Screenshot 2026-02-27 at 1 16 51 pm" src="https://github.com/user-attachments/assets/f669a614-34f9-429a-b82d-70207ad3aa01" />

<img width="1298" height="398" alt="Screenshot 2026-02-27 at 1 17 04 pm" src="https://github.com/user-attachments/assets/f4f2f45e-2c95-4a24-8805-791571254f5e" />

<img width="1297" height="508" alt="Screenshot 2026-02-27 at 1 17 20 pm" src="https://github.com/user-attachments/assets/326b51e7-41a2-4d54-a75a-a21437bc5a21" />

## How it works

Each task gets its own git worktree at `.worktrees/<task-slug>`. An `opencode` agent runs inside that worktree, so tasks are fully isolated from each other and from your working directory. State is persisted to `.faber/state.json`, so you can close and reopen faber without losing track of what's running.

## Prerequisites

- [Bun](https://bun.sh)
- [opencode](https://opencode.ai) on your `PATH`, connected to Claude via a Pro/Max subscription or an Anthropic API key
- A git repository to work in

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/blaknite/faber/main/install.sh | bash
```

This downloads the latest release binary for your OS and architecture, installs it to `~/.faber/bin`, and adds it to your PATH.

**Building from source**

```bash
bun install
bun run build:bin   # produces a ./faber binary
```

Or run directly from source:

```bash
bun run dev
```

## Updating

```bash
faber update
```

Checks for a newer release on GitHub and replaces the running binary in-place if one is available. Supports macOS (arm64/x64) and Linux (arm64/x64).

## Getting the best results

Faber automatically injects the `working-in-faber` skill into every agent prompt. The skill tells the agent about its environment (git worktrees, branch isolation, sibling agents) and sets expectations around committing in logical units, writing meaningful commit messages, and not pushing.

For this to work, the skill needs to be available in your agent's environment.

## Usage

```bash
faber                        # open the TUI in the current directory
faber start                  # same as above, explicit subcommand
faber --dir /path/to/repo    # open the TUI in a specific directory
```

### Setup

Initialise a repo for use with faber (creates `.faber/`, `.worktrees/`, and updates `.gitignore`):

```bash
faber setup
faber setup --dir /path/to/repo
```

### Headless run

Fire off a task without opening the TUI:

```bash
faber run "fix the login bug"
faber run "fix the login bug" --dir /path/to/repo
faber run "add tests for UserService" --model fast
```

### List tasks

Print a table of all tasks with their ID, status, elapsed time, and a truncated prompt:

```bash
faber list
faber list --dir /path/to/repo
faber list --status running     # filter by status (running, done, failed, etc.)
```

### Read a task log

Print a task's prompt and the agent's text output, with tool calls summarised as one-liners:

```bash
faber read <taskId>
faber read <taskId> --full      # include full tool block content
faber read <taskId> --json      # raw LogEntry[] as JSON
faber read <taskId> --dir /path/to/repo
```

### Cross-task references

Agents can pull context from other tasks by referencing them with `@taskId` in a prompt. Selecting a task from the autocomplete inserts the task ID (e.g. `@a3f2-fix-login-bug`) into the prompt as plain text. Faber doesn't do anything special with it beyond that -- the `working-in-faber` skill, which is injected into every agent prompt, teaches the agent to recognise the `@taskId` pattern and run `faber read <taskId>` to pull the output and extract whatever context it needs.

This is useful when one task builds on the work of another -- for example, pointing a "write tests" task at a completed "refactor UserService" task so the agent can see exactly what changed before writing assertions.

### TUI keybindings

**Task list**

| Key | Action |
|-----|--------|
| `n` | New task |
| `j` / `k` or arrows | Navigate list |
| `Tab` | Toggle filter between active and all tasks |
| `Enter` / `o` | Open task |
| `c` | Continue a stopped or failed task |
| `s` | Kill running task (confirms with y/n) |
| `x` | Mark task as done |
| `d` | Delete task and remove its worktree (confirms with y/n) |
| `b` | Switch branch |
| `p` | Push branch to origin (confirms with y/n) |
| `q` / `Ctrl-C` | Quit |

**Log pane** (after pressing `Enter` on a task with no commits)

| Key | Action |
|-----|--------|
| `j` / `k` or arrows | Scroll |
| `PgUp` / `PgDn` | Scroll by page |
| `c` | Continue task |
| `s` | Kill running task |
| `x` | Mark task as done |
| `d` | Delete task and worktree |
| `f` | Open diff view |
| `,` / `.` | Cycle to next / previous active task |
| `q` / `Escape` | Back to task list |

**Diff view** (after pressing `Enter` on a task with commits, or `f` from the log)

| Key | Action |
|-----|--------|
| `j` / `k` or arrows | Scroll |
| `PgUp` / `PgDn` | Scroll by page |
| `g` / `G` | Jump to top / bottom |
| `Tab` | Toggle between side-by-side and inline layout |
| `c` | Continue task |
| `l` | Switch to log view |
| `m` | Rebase branch onto HEAD and fast-forward merge (confirms with y/n) |
| `x` | Mark task as done |
| `d` | Delete task and worktree |
| `,` / `.` | Cycle to next / previous active task |
| `q` / `Escape` | Back |

**New task / continue input**

| Key | Action |
|-----|--------|
| `Enter` | Submit |
| `Shift-Enter` / `Ctrl-Enter` / `Ctrl-J` | Insert newline |
| `Tab` | Cycle through models (or select file suggestion if autocomplete is open) |
| `Escape` | Cancel (or clear text if the field is non-empty) |

When typing `@` in a prompt, faber opens an autocomplete showing both files and tasks. Each suggestion is labelled with its type. Selecting a file inserts its path; selecting a task inserts the task ID (e.g. `@a3f2-fix-login-bug`). Use `Up` / `Down` to navigate and `Tab` or `Enter` to select. `Escape` dismisses the list.

### Models

| Label | Model |
|-------|-------|
| smart (default) | `anthropic/claude-sonnet-4-6` |
| fast | `anthropic/claude-haiku-4-5` |
| deep | `anthropic/claude-opus-4-6` |

## Reviewing and merging agent work

When an agent finishes with commits on its branch, the task is marked "ready to merge" and the pending count appears in the top bar. The typical flow from there:

1. Select the task and press `enter`. If the branch has commits, you go straight to the diff view. Otherwise you land on the log, where `f` takes you to the diff.
2. The diff view runs `git diff HEAD...{branch}` (three-dot syntax), so you see exactly what the agent changed relative to the point where work began, regardless of anything that landed on `HEAD` in the meantime.
3. The diff renders with character-level highlighting and two layout modes: side-by-side (default) and inline. Press `Tab` to switch between them.
4. When you're happy with the changes, press `m`. You'll get a `[y/n]` confirmation prompt, then faber rebases the task branch onto the current `HEAD` and fast-forward merges it in. The result is a linear history with no merge commits. If the rebase hits a conflict, faber automatically aborts and leaves your repo clean.
5. After merging, the task moves to "done". The worktree and branch are still there so you can review the log or diff again. When you're done with them, press `d` to delete the worktree and branch in one go.

## Working with feature branches

Faber works just as well when your repo is on a feature branch. Agents will branch off whatever `HEAD` points to, so all their worktrees and merges stay scoped to that branch.

The typical flow:

1. Launch faber in your repo as usual.
2. Switch to your feature branch by pressing `b` from the task list and typing the branch name.
3. Create tasks as normal. Each agent branches off the feature branch tip, isolated from both `main` and each other.
4. Review and merge each task into the feature branch the same as any other task: open the task to reach the diff view, then press `m`.

When you're happy with the feature branch as a whole, merge it into `main` yourself outside of faber.

## Branch selection and filtering

### Switching branches

Press `b` from the task list to open the branch switcher. A modal appears with a list of your repo's branches sorted by most recently committed, task branches excluded.

Start typing to filter the list. The filter is a case-insensitive substring match, so `feat` matches `feature/auth`, `my-feat`, etc. Use `Up` / `Down` to move through the results, then `Enter` to switch.

If you type a name that doesn't match anything, the list shows "no matches -- press enter to create". Pressing `Enter` at that point creates a new branch off the current `HEAD` and switches to it.

### How tasks are scoped to a branch

Each task records the branch that was checked out when it was dispatched. The task list is always filtered to only show tasks that belong to the current branch, so switching branches gives you a clean slate for that context.

Tasks created before branch scoping was introduced show up on every branch.

The active/all toggle (Tab) applies on top of that filter, so "active" means "active tasks on this branch".

## Development

```bash
bun run dev       # run from source
bun run build     # compile to dist/
bun run build:bin # compile to a standalone binary
```
