# faber

A terminal UI for running multiple autonomous coding agents in parallel. Give it a prompt, and it spins up a git worktree and an [opencode](https://opencode.ai) agent to work on it, while you keep dispatching more tasks.

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

| Key | Action |
|-----|--------|
| `n` | New task |
| `j` / `k` or arrows | Navigate list |
| `o` | Copy `opencode -s <sessionId>` to clipboard (to attach to a running session) |
| `x` | Kill running task |
| `d` | Delete task and remove its worktree |
| `q` / `Ctrl-C` | Quit |

When creating a task, `Tab` cycles through available models and `Enter` submits.

### Models

- `anthropic/claude-sonnet-4-6` (default)
- `anthropic/claude-haiku-4-5`
- `anthropic/claude-opus-4-6`

## Development

```bash
bun run dev       # run from source
bun run build     # compile to dist/
bun run build:bin # compile to a standalone binary
```
