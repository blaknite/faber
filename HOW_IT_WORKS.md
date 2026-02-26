# How Faber works

## What is Faber?

Faber is a terminal UI orchestrator that lets you dispatch multiple autonomous coding tasks in parallel. It spins up isolated git worktrees and runs `opencode` agents in each one, while you keep the main TUI open to dispatch more work.

## Core architecture

Key components:

- **State management** (`state.ts`): Persistent JSON file in `.faber/state.json` tracks all tasks. Uses file locking to ensure only one TUI instance runs per repo.
- **Agent orchestration** (`agent.ts`): Spawns `opencode` subprocesses with prompt + model selection, tracks PIDs, and listens for completion.
- **Git integration** (`worktree.ts`): Creates isolated git worktrees for each task so they don't interfere with each other.
- **React TUI** (`App.tsx`): Renders the terminal UI with task list, status display, and keyboard controls.

## Task lifecycle

1. You press [n] in the TUI and type a prompt
2. Faber generates a unique task ID (like `a3f2-resolve-issue`)
3. Creates a new git worktree at `.worktrees/a3f2-resolve-issue`
4. Spawns an `opencode` subprocess inside that worktree
5. The subprocess runs your prompt with the selected Claude model
6. When done, the process exits and calls `faber --finish <taskId>` to update state
7. Task shows as "done" or "failed" in the TUI

## Key features

- **Parallel execution**: Dispatch as many tasks as you want; they run in parallel across different worktrees
- **Session attachment**: Copy the session ID and `opencode -s <sessionId>` to attach to a running task
- **Persistent state**: All task metadata survives terminal crashes; tasks marked "unknown" if their PID dies
- **Model selection**: Tab through Claude Sonnet (default), Haiku, or Opus before submitting
- **Lightweight**: Just JSON state files and git worktrees--no database or complex infrastructure

## Design philosophy

Simple and git-native: Faber leverages git's built-in worktree isolation instead of containers, stores state as JSON instead of a database, and trusts OS process management. It's essentially a dispatcher that wraps `opencode` in a multi-task TUI wrapper.

## Technology stack

- **Runtime**: Bun (fast JavaScript runtime)
- **UI framework**: OpenTUI with React 19
- **Language**: TypeScript/JSX
- **Key dependencies**: `execa` (subprocess execution), `proper-lockfile` (file-based locking)

## Main entry points

1. **TUI mode** (default): `faber [path/to/repo]` - Opens interactive terminal UI
2. **Headless dispatch**: `faber dispatch "prompt" [--dir path] [--model model]` - Creates task without TUI
3. **Task completion hook**: `faber --finish <taskId> [exitCode]` - Called automatically by subprocess
