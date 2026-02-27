# faber

A terminal UI for running multiple autonomous coding agents in parallel. Give it a prompt, it spins up a git worktree and a [opencode](https://opencode.ai) agent to work on it, while you keep dispatching more tasks.

<img width="1211" height="1344" alt="Screenshot 2026-02-26 at 11 58 29 pm" src="https://github.com/user-attachments/assets/9f007317-9617-4397-8952-3f35b0d9162c" />

## How it works

Each task gets its own git worktree at `.worktrees/<task-slug>`. An `opencode` agent runs inside that worktree, so tasks are fully isolated from each other and from your working directory. State is persisted to `.faber/state.json`, so you can close and reopen faber without losing track of what's running.

## Prerequisites

- [Bun](https://bun.sh)
- [opencode](https://opencode.ai) on your `PATH`
- A git repository to work in

## Installation

```bash
bun install
bun run build:bin   # produces a ./faber binary
```

Or run directly from source:

```bash
bun run dev
```

## Usage

```bash
faber [path/to/repo]   # opens the TUI in the current directory or a specified one
```

### Headless dispatch

Fire off a task without opening the TUI:

```bash
faber dispatch "fix the login bug" --dir /path/to/repo
faber dispatch "add tests for UserService" --model anthropic/claude-haiku-4-5
```

### TUI keybindings

**Task list**

| Key | Action |
|-----|--------|
| `n` | New task |
| `j` / `k` or arrows | Navigate list |
| `enter` | Open task |
| `r` | Resume a done or failed task |
| `c` | Clone task (re-dispatch same prompt) |
| `s` | Copy `opencode -s <sessionId>` to clipboard |
| `x` | Kill running task (confirms with y/n) |
| `d` | Delete task and remove its worktree (confirms with y/n) |
| `f` | Open diff view (task branch vs HEAD) |
| `q` / `Ctrl-C` | Quit |

**Log pane** (after pressing `enter` on a task)

| Key | Action |
|-----|--------|
| `j` / `k` or arrows | Scroll |
| `PgUp` / `PgDn` | Scroll by page |
| `r` | Resume task |
| `s` | Copy session ID to clipboard |
| `x` | Kill running task |
| `d` | Delete task and worktree |
| `f` | Open diff view |
| `q` / `Escape` | Back to task list |

**Diff view** (after pressing `f`)

| Key | Action |
|-----|--------|
| `j` / `k` or arrows | Scroll |
| `PgUp` / `PgDn` | Scroll by page |
| `m` | Merge branch into HEAD (git merge --no-ff, confirms with y/n) |
| `q` / `Escape` | Back |

When creating a task, `Tab` cycles through models and `Enter` submits. Multi-line prompts are supported with `Shift-Enter`, `Ctrl-Enter`, or `Ctrl-J`.

### Models

| Label | Model |
|-------|-------|
| Smart (default) | `anthropic/claude-sonnet-4-6` |
| Fast | `anthropic/claude-haiku-4-5` |
| Deep | `anthropic/claude-opus-4-6` |

## Reviewing and merging agent work

When an agent finishes with commits on its branch, the task is marked "ready to merge" and the pending count appears in the top bar. The typical flow from there:

1. Select the task and press `enter`. If the task is ready to merge, you'll go straight to the diff view. Otherwise you land on the log, where `f` takes you to the diff.
2. The diff view runs `git diff HEAD...{branch}` (three-dot syntax), so you see exactly what the agent changed relative to the point where work began, regardless of anything that landed on `HEAD` in the meantime.
3. The diff renders with character-level highlighting and two layout modes: side-by-side (default) and inline. Press `Tab` to switch between them.
4. When you're happy with the changes, press `m`. You'll get a `[y/n]` confirmation prompt, then faber runs `git merge --no-ff {branch}` from the repo root. The `--no-ff` flag forces a merge commit so the history clearly records that these commits came from an agent task. If the merge fails (conflicts, etc.), faber automatically aborts and leaves your repo clean.
5. After merging, the task moves to "done". The worktree and branch are still there so you can review the log or diff again. When you're done with them, press `d` to delete the worktree and branch in one go.

## Development

```bash
bun run dev       # run from source
bun run build     # compile to dist/
bun run build:bin # compile to a standalone binary
```
