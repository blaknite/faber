# How Faber works

## What is Faber?

Faber is a terminal UI orchestrator that lets you dispatch multiple autonomous coding tasks in parallel. It spins up isolated git worktrees and runs `opencode` agents in each one, while you keep the TUI open to dispatch more work, monitor progress, or attach to a running session.

## Core architecture

The codebase is TypeScript/JSX, built on Bun, with five library modules under `src/lib/`:

- `state.ts`: reads and writes `.faber/state.json`, the single source of truth for all task records. A file lock (via `proper-lockfile`) prevents two TUI instances from running against the same repo at once.
- `agent.ts`: spawns `opencode` subprocesses, tracks their PIDs and session IDs, and handles the completion callback.
- `worktree.ts`: thin wrappers around `git worktree add`, `git worktree remove`, and `git worktree list`.
- `slug.ts`: generates the task ID from the prompt (6 random hex chars + a hyphenated truncation of the prompt text).
- `failureLog.ts`: appends failure events to `.faber/failures.log` as JSON lines for post-mortem debugging.

The TUI itself is a React tree rendered to the terminal by `@opentui/react` (a React 19 renderer that targets terminal output). `App.tsx` owns all application state and keyboard handling; the four components are `AgentList`, `AgentLog`, `TaskInput`, and `StatusBar`.

## Task lifecycle

1. You press `n`, type a prompt, select a model with `Tab`, and press `Enter`
2. Faber generates a slug like `a3f2-resolve-issue-uic-002` and constructs the task record
3. `git worktree add .worktrees/a3f2-... -b a3f2-...` creates an isolated checkout on a new branch
4. Faber spawns the agent (see below) and stores the task as `status: "running"`
5. The agent runs; its JSON output streams to `.faber/tasks/<taskId>.jsonl` via `tee`
6. When the agent exits, `faber finish <taskId> $?` is called automatically, writing `status: "done"` or `"failed"` and the exit code to state
7. The TUI polls `state.json` every two seconds and updates the display

State transitions:

```
(new) ──── worktree creation fails ──────────────────────> "failed"
  |
  └── worktree created ──> "running"
                              |
                              ├── exit 0 ─────────────────> "done"
                              ├── exit != 0 ───────────────> "failed"
                              └── SIGTERM (x key) ──────────> "failed" (exit 143)

"done" or "failed" ──── r key (resume) ──────────────────> "running"

On startup: "running" with a dead PID ───────────────────> "unknown"
```

The `"unknown"` state is set at startup by `reconcileRunningTasks`: any task still marked `"running"` whose PID is no longer alive gets marked `"unknown"`. This catches agents that died while Faber was closed.

## How agents are spawned

`spawnAgent` in `agent.ts` builds a shell command along these lines:

```sh
set -o pipefail; opencode run --format json --model <model> '<prompt>' \
  | tee -a ".faber/tasks/<taskId>.jsonl" \
  ; faber finish <taskId> $?
```

A few things worth noting:

- The prompt is automatically prefixed with `Load the skill \`working-in-faber\`` so the agent knows it is running inside a Faber worktree and follows the expected commit/wrap-up conventions.
- `set -o pipefail` ensures `$?` reflects opencode's exit code, not `tee`'s.
- `tee` captures the JSON output to disk while it is still streaming to Faber's stdout listener.
- `faber finish` is appended with `;` (not `&&`) so it runs regardless of exit code.
- The process is spawned with `detached: true` and `child.unref()`, so agents survive Faber closing. The `finish` command writes directly to `state.json`, so the final status is persisted even if Faber is not running when the agent completes.
- The `OPENCODE_CONFIG_CONTENT` environment variable injects a generated opencode config that grants read access to the whole repo root but restricts writes to just the agent's own worktree path.

After spawning, Faber polls `pgrep -P <shellPid>` to find the actual opencode PID, and watches stdout for the first JSON line containing a `sessionID` field.

## The TUI

Layout:

- Header: "faber" logo, repo name, running task count
- Main body: `AgentList` (task list + input) or `AgentLog` (full log for the selected task)
- Footer: key binding hints, or an inline `y/n` confirmation prompt for kill/delete

The app is modal. The relevant modes are `normal` (navigating the list), `input` (typing a prompt), `kill` (confirming SIGTERM), and `delete` (confirming task + worktree removal).

Key bindings:

| Key | Action |
|-----|--------|
| `n` | New task (switch to input mode) |
| `j`/`k` or arrows | Navigate task list |
| `Enter`/`o` | Open log view for selected task |
| `x` | Kill running task (sends SIGTERM) |
| `r` | Resume a done or failed task (forks the opencode session) |
| `s` | Copy `opencode -s <sessionId>` to clipboard |
| `c` | Clone task (re-dispatch same prompt and model) |
| `d` | Delete task and remove worktree |
| `q` / `Ctrl-C` | Quit |
| `Escape` | Close log view or cancel confirmation |

`TaskInput` is a multi-line textarea (1-6 lines, auto-grows). `Tab` cycles through the three available models; the active model and its color are shown below the textarea.

## The log view

`AgentLog` renders a full-screen view of a single task's output, streaming in real time from the task's `.jsonl` file via `fs.watch` (falling back to 500ms polling).

Each line of the JSONL file is a JSON event from opencode. The log view normalises these into display rows:

- Text output is markdown-rendered with word wrapping
- Tool calls show a colored icon, tool name, and a concise summary (e.g. the shell command for Bash, the file path for Read, a truncated syntax-highlighted diff for Edit)
- Step finish events show a green "done" row with the model name and how long that reasoning step took
- Reasoning/thinking events show a truncated grey "Thinking: ..." preview

The log view uses sticky scroll by default: it follows new output as it arrives. Scrolling up disables sticky; scrolling back to the bottom re-enables it.

## Data on disk

```
.faber/
  state.json              # all task records
  state.json.lock/        # lockfile directory (proper-lockfile)
  tasks/<taskId>.jsonl    # raw JSON-lines output for each agent
  failures.log            # append-only failure event log
.worktrees/
  <task-slug>/            # isolated git checkout for each task
```

## Technology stack

- Runtime: Bun
- UI framework: `@opentui/core` + `@opentui/react` (React 19, terminal renderer)
- Language: TypeScript/JSX
- Key dependencies: `execa` (subprocess execution), `proper-lockfile` (file locking)

## Entry points

1. `faber` / `faber start` `[--dir path]` - opens the interactive TUI
2. `faber setup` `[--dir path]` - initialises `.faber/`, `.worktrees/`, and `.gitignore`
3. `faber run "<prompt>"` `[--dir path] [--model model]` - headless task dispatch
4. `faber update` - checks GitHub for a newer release and replaces the binary in-place
5. `faber version` - prints the current version and exits
6. `faber finish <taskId> <exitCode>` - called automatically by each agent on exit to write final status
