import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { resolve, join } from "node:path"
import { homedir } from "node:os"
import { existsSync, mkdirSync, readFileSync, writeFileSync, watch as fsWatch } from "node:fs"
import { App } from "./App.js"
import { acquireLock, ensureFaberDir, findTask, readState, reconcileRunningTasks, updateTask, findRepoRoot, taskOutputPath, stateFilePath } from "./lib/state.js"
import { createWorktree, worktreeHasCommits, readCurrentBranch, getDiff, mergeBranch, removeWorktree } from "./lib/worktree.js"
import { spawnAgent, DEFAULT_RESUME_PROMPT } from "./lib/agent.js"
import { logTaskFailure } from "./lib/failureLog.js"
import { finishTask } from "./lib/finishTask.js"
import { doneTask } from "./lib/doneTask.js"
import { deleteTask } from "./lib/deleteTask.js"
import { createAndDispatchTask } from "./lib/dispatch.js"
import { checkAndUpdate } from "./lib/update.js"
import { formatElapsed, readLogEntries } from "./lib/logParser.js"
import { formatLog } from "./lib/formatLog.js"
import type { Task, TaskStatus, Tier } from "./types.js"
import { DEFAULT_TIER, resolveTier } from "./types.js"
import { loadConfig } from "./lib/config.js"
import type { AgentConfig } from "./lib/config.js"
import { runReview } from "./review.js"
import type { ReviewMode } from "./lib/reviewTarget.js"

// Single exit point for the process. Everything routes through here so it's
// easy to find all the places we terminate and to add any future cleanup.
function exit(code: number): never {
  process.exit(code)
}

// Parse --dir <path> from an args array, returning the resolved path or null.
// Exits with an error if the path is provided but does not exist.
function parseDirFlag(args: string[]): string | null {
  const i = args.indexOf("--dir")
  if (i !== -1 && args[i + 1]) {
    const dir = resolve(args[i + 1]!)
    if (!existsSync(dir)) {
      console.error(`Directory does not exist: ${dir}`)
      exit(1)
    }
    return dir
  }
  return null
}

// Parse --status <value> from an args array. Returns the status string or null.
function parseStatusFlag(args: string[]): TaskStatus | null {
  const i = args.indexOf("--status")
  if (i !== -1 && args[i + 1]) return args[i + 1] as TaskStatus
  return null
}

// Parse --base <branch> from an args array. Returns the branch name or null.
function parseBaseFlag(args: string[]): string | null {
  const i = args.indexOf("--base")
  if (i !== -1 && args[i + 1]) return args[i + 1]!
  return null
}

// Parse --branch <name> from an args array. Returns the branch name or null.
function parseBranchFlag(args: string[]): string | null {
  const i = args.indexOf("--branch")
  if (i !== -1 && args[i + 1]) return args[i + 1]!
  return null
}

// Parse --pull-request <num-or-url> from an args array. Returns the value or null.
function parsePullRequestFlag(args: string[]): string | null {
  const i = args.indexOf("--pull-request")
  if (i !== -1 && args[i + 1]) return args[i + 1]!
  return null
}

// Strip all recognised flags and their values from an args array so that the
// remainder contains only positional arguments. This lets callers use index
// arithmetic (positional[1], positional[2], ...) without worrying about flags
// appearing before positionals.
//
// Flags that consume a following value: --model, --dir, --base, --status, --branch, --pull-request
// Boolean flags (no value): --full, --json, --yes, -h, --help
//
// The flag helpers (parseDirFlag, parseModelFlag, etc.) use indexOf so they
// still work on the original args array before stripping.
export function stripFlags(args: string[]): string[] {
  const VALUE_FLAGS = new Set(["--model", "--dir", "--base", "--status", "--branch", "--pull-request"])
  const result: string[] = []
  let i = 0
  while (i < args.length) {
    const arg = args[i]!
    if (VALUE_FLAGS.has(arg)) {
      // skip this flag and its value
      i += 2
    } else if (arg.startsWith("-")) {
      // boolean flag -- skip it but don't skip the next token
      i += 1
    } else {
      result.push(arg)
      i += 1
    }
  }
  return result
}

export function parseModelFlag(args: string[]): { tier: Tier; explicitModel: string | undefined } {
  const i = args.indexOf("--model")
  if (i === -1 || !args[i + 1]) return { tier: DEFAULT_TIER, explicitModel: undefined }
  const input = args[i + 1]!
  const resolvedTier = resolveTier(input)
  if (resolvedTier) return { tier: resolvedTier, explicitModel: undefined }
  return { tier: DEFAULT_TIER, explicitModel: input }
}

// FABER_VERSION is injected at compile time via --define. When running from
// source with `bun src/index.tsx` (dev mode) it won't be set, so we fall back
// to "dev".
declare const FABER_VERSION: string | undefined
const VERSION = typeof FABER_VERSION !== "undefined" ? FABER_VERSION : "dev"

export async function main() {
  const args = process.argv.slice(2)
  const command = args[0]
  const positional = stripFlags(args)

  // faber --help | faber help
  if (command === "--help" || command === "-h" || command === "help") {
    console.log(`faber ${VERSION}

Usage: faber [command] [options]

Commands:
  (none)            Launch the TUI and manage tasks interactively
  run "<prompt>"    Dispatch a task headlessly without the TUI
  review            Dispatch a code-review task
  continue <taskId> Resume a stopped or failed task
  stop <taskId>     Stop a running task
  list              Print all tasks as a table
  read <taskId>     Print the log for a task
  watch <taskId>    Watch a task and exit when it stops running
  diff <taskId>     Print the unified diff for a task's branch
  merge <taskId>    Merge a ready task branch and remove its worktree
  done <taskId>     Mark a ready task as done without merging or cleaning up
  delete <taskId>   Delete a task and remove its worktree and branch
  setup             Initialise .faber/, .worktrees/, and .plans/ in the repo
  update            Check for a new release and install it
  extras            Install or update agent skills, opencode commands, and config
  version           Print the version and exit
  help              Show this help message

Options:
  --dir <path>      Path to the git repo root (defaults to nearest repo from cwd)
  --model <label>   Model to use for the task: smart, fast, or deep
                    (only applies to the run command)
  --status <value>  Filter tasks by status (only applies to the list command)
                    Valid values: running, ready, done, failed, stopped, unknown
  --full            Include tool call block content (only applies to the read command)
  --json            Output raw JSON (only applies to the read command)
  --branch <name>   Branch to review (only applies to the review command)
  --pull-request <n> PR number or URL to review (only applies to the review command)

Examples:
  faber
  faber run "Fix the login bug"
  faber review
  faber review --pull-request 123
  faber run "Refactor the auth module" --model deep
  faber continue a3f2-fix-the-login-bug
  faber continue a3f2-fix-the-login-bug "do X instead"
  faber stop a3f2-fix-the-login-bug
  faber list
  faber list --status ready
  faber read a3f2-fix-the-login-bug
  faber read a3f2-fix-the-login-bug --full
  faber watch a3f2-fix-the-login-bug
  faber diff a3f2-fix-the-login-bug
  faber setup --dir /path/to/repo

Run "faber <command> --help" for help on a specific command.`)
    exit(0)
  }

  // faber <command> --help
  // Per-command help. Check for --help in the args before dispatching any command.
  if (args.includes("--help") || args.includes("-h")) {
    switch (command) {
      case "stop":
        console.log(`Usage: faber stop <taskId>

Stop a running task. The task is marked as stopped and can be resumed later
with "faber continue".

Arguments:
  <taskId>          The task ID to stop

Options:
  --dir <path>      Path to the git repo root (defaults to nearest repo from cwd)

Examples:
  faber stop a3f2-fix-the-login-bug`)
        exit(0)
      case "continue":
        console.log(`Usage: faber continue <taskId> ["<prompt>"] [options]

Resume a stopped, failed, or unknown task. The agent restarts in the same
session so it retains context from the previous run.

Arguments:
  <taskId>          The task ID to resume
  "<prompt>"        Optional follow-up prompt (default: resume from interruption)

Options:
  --dir <path>      Path to the git repo root (defaults to nearest repo from cwd)

Examples:
  faber continue a3f2-fix-the-login-bug
  faber continue a3f2-fix-the-login-bug "do X instead"`)
        exit(0)
      case "run":
        console.log(`Usage: faber run "<prompt>" [options]

Dispatch a task headlessly without the TUI. A new git worktree is created and
an agent is spawned immediately. Use "faber watch <taskId>" to wait for it to
finish, or "faber read <taskId>" to see its output.

Options:
  --model <label>   Model to use: smart (default), fast, or deep
  --dir <path>      Path to the git repo root (defaults to nearest repo from cwd)
  --base <branch>   Branch to create the worktree from (defaults to current branch)

Examples:
  faber run "Fix the login bug"
  faber run "Refactor the auth module" --model deep
  faber run "Add tests for the billing flow" --dir /path/to/repo`)
        exit(0)
      case "list":
        console.log(`Usage: faber list [options]

Print all tasks as a table showing ID, status, elapsed time, and prompt.

Options:
  --status <value>  Filter by status: running, ready, done, failed, stopped, unknown
  --dir <path>      Path to the git repo root (defaults to nearest repo from cwd)

Examples:
  faber list
  faber list --status running
  faber list --status ready`)
        exit(0)
      case "read":
        console.log(`Usage: faber read <taskId> [options]

Print the log for a task. By default shows the prompt and text output with tool
calls summarised as one-liners.

Options:
  --full            Include full tool call block content
  --json            Output the raw log as JSON
  --dir <path>      Path to the git repo root (defaults to nearest repo from cwd)

Examples:
  faber read a3f2-fix-the-login-bug
  faber read a3f2-fix-the-login-bug --full
  faber read a3f2-fix-the-login-bug --json`)
        exit(0)
      case "watch":
        console.log(`Usage: faber watch <taskId> [options]

Watch a task and exit when it stops running. Useful for scripting: the exit
code is 0 regardless of how the task finished.

Options:
  --dir <path>      Path to the git repo root (defaults to nearest repo from cwd)

Examples:
  faber watch a3f2-fix-the-login-bug
  faber run "Fix the login bug" && faber watch \$(faber list --status running | head -1 | awk '{print \$1}')`)
        exit(0)
      case "diff":
        console.log(`Usage: faber diff <taskId> [options]

Print the unified diff for a task's branch against its base branch. Outputs
nothing (not an error) when the task has no commits yet.

Options:
  --dir <path>      Path to the git repo root (defaults to nearest repo from cwd)

Examples:
  faber diff a3f2-fix-the-login-bug
  faber diff a3f2`)
        exit(0)
      case "merge":
        console.log(`Usage: faber merge <taskId> [options]

Merge a ready task branch into the current branch via rebase and remove its
worktree. The task must have status "ready" and at least one commit.

Options:
  --dir <path>      Path to the git repo root (defaults to nearest repo from cwd)

Examples:
  faber merge a3f2-fix-the-login-bug
  faber merge a3f2-fix-the-login-bug --dir /path/to/repo`)
        exit(0)
      case "done":
        console.log(`Usage: faber done <taskId> [options]

Mark a ready task as done. The worktree and branch are left intact -- this is
a pure bookkeeping action. Use "faber merge" instead if you want to merge the
changes and remove the worktree.

Options:
  --dir <path>      Path to the git repo root (defaults to nearest repo from cwd)

Examples:
  faber done a3f2-fix-the-login-bug`)
        exit(0)
      case "delete":
        console.log(`Usage: faber delete <taskId> [options]

Delete a task and remove its worktree and branch. This is destructive and
cannot be undone. You will be asked to confirm unless --yes is passed.

Options:
  --yes             Skip the confirmation prompt (useful in scripts and agents)
  --dir <path>      Path to the git repo root (defaults to nearest repo from cwd)

Examples:
  faber delete a3f2-fix-the-login-bug
  faber delete a3f2-fix-the-login-bug --yes`)
        exit(0)
      case "review":
        console.log(`Usage: faber review [options]

Dispatch a code-review task. Reviews the current branch against the default
branch by default. The task runs as a normal faber task: use "faber watch"
to block until it finishes, "faber read" to see its output, and "faber diff"
to inspect any fixes it applied.

Options:
  --branch <name>             Review <name> against the default branch
  --pull-request <num-or-url> Review a pull request against its base branch
  --model <label>             Model to use: smart (default), fast, or deep
  --dir <path>                Path to the git repo root (defaults to nearest repo from cwd)

Examples:
  faber review
  faber review --branch feature/new-auth
  faber review --pull-request 123
  faber review --pull-request https://github.com/org/repo/pull/123
  faber review --model deep`)
        exit(0)
      case "setup":
        console.log(`Usage: faber setup [options]

Initialise .faber/, .worktrees/, and .plans/ in the repo and add them to .gitignore.
Safe to run multiple times.

Options:
  --dir <path>      Path to the git repo root (defaults to cwd)

Examples:
  faber setup
  faber setup --dir /path/to/repo`)
        exit(0)
      case "update":
        console.log(`Usage: faber update

Check for a new release on GitHub and install it if one is available.`)
        exit(0)
      case "extras":
        console.log(`Usage: faber extras

Install or update faber's optional agent tooling:

  - Skills          SKILL.md files to ~/.config/agents/skills/ (or ~/.claude/skills/)
  - Opencode setup  Slash commands and agent config to ~/.opencode/

Each group is prompted individually. Existing files that differ from the
release version are flagged as conflicts and you're asked before overwriting.

Safe to run multiple times.`)
        exit(0)
      default:
        // Unknown command with --help: fall through to the main dispatcher,
        // which will handle it (likely erroring out with a usage message).
        break
    }
  }

  // faber version
  if (command === "version") {
    console.log(VERSION)
    exit(0)
  }

  // faber list [--dir <repo>] [--status <status>]
  if (command === "list") {
    const dirArg = parseDirFlag(args)
    const repoRoot = dirArg ?? findRepoRoot(process.cwd())
    if (!repoRoot) {
      console.error("Could not find faber state file from current directory")
      exit(1)
    }
    const statusFilter = parseStatusFlag(args)
    listTasks(repoRoot, statusFilter)
    return
  }

  // faber finish <taskId> <exitCode>
  // Called via command chaining after opencode exits, passing the real exit code via $?.
  // This is the single place where task exit status is written to state.
  if (command === "finish") {
    const taskId = positional[1]
    const exitCode = positional[2] !== undefined ? parseInt(positional[2], 10) : 0
    if (!taskId) {
      console.error("Usage: faber finish <taskId> <exitCode>")
      exit(1)
    }
    const dirArg = parseDirFlag(args)
    const repoRoot = dirArg ?? findRepoRoot(process.cwd())
    if (!repoRoot) {
      console.error("Could not find faber state file from current directory")
      exit(exitCode)
    }
    await finishTask(repoRoot, taskId, exitCode)
    exit(exitCode)
  }

  // faber continue <taskId> ["<prompt>"] [--dir <repo>]
  if (command === "continue") {
    const taskIdArg = positional[1]
    if (!taskIdArg) {
      console.error('Usage: faber continue <taskId> ["<prompt>"] [--dir <repo>]')
      exit(1)
    }
    const prompt = positional[2]
    const dirArg = parseDirFlag(args)
    const repoRoot = dirArg ?? findRepoRoot(process.cwd())
    if (!repoRoot) {
      console.error("Could not find faber state file from current directory")
      exit(1)
    }
    const continueState = readState(repoRoot)
    let continueTask_: Task | null
    try {
      continueTask_ = findTask(continueState.tasks, taskIdArg)
    } catch (err: any) {
      console.error(err.message)
      exit(1)
    }
    if (!continueTask_) {
      console.error(`No task matching "${taskIdArg}"`)
      exit(1)
    }
    continueTask(repoRoot, continueTask_.id, prompt)
    return
  }

  // faber stop <taskId> [--dir <repo>]
  if (command === "stop") {
    const taskIdArg = positional[1]
    if (!taskIdArg) {
      console.error('Usage: faber stop <taskId>')
      exit(1)
    }
    const dirArg = parseDirFlag(args)
    const repoRoot = dirArg ?? findRepoRoot(process.cwd())
    if (!repoRoot) {
      console.error("Could not find faber state file from current directory")
      exit(1)
    }
    stopTask(repoRoot, taskIdArg)
    return
  }

  // faber run "<prompt>" [--dir <repo>] [--model <label>] [--base <branch>]
  if (command === "run") {
    const prompt = positional[1]
    if (!prompt) {
      console.error('Usage: faber run "<prompt>" [--dir <repo>] [--model <label>] [--base <branch>]')
      exit(1)
    }
    const dirArg = parseDirFlag(args)
    const repoRoot = dirArg ?? findRepoRoot(process.cwd()) ?? resolve(process.cwd())
    const { tier, explicitModel } = parseModelFlag(args)
    const baseBranch = parseBaseFlag(args) ?? undefined
    const globalConfigPath = join(homedir(), '.faber', 'faber.json')
    const projectConfigPath = join(repoRoot, '.faber', 'faber.json')
    const loadedConfig = loadConfig(globalConfigPath, projectConfigPath)
    await runHeadless(repoRoot, prompt, tier, baseBranch, loadedConfig, explicitModel)
    return
  }

  // faber review [--branch <name>] [--pull-request <num-or-url>] [--model <label>] [--dir <repo>]
  if (command === "review") {
    const branch = parseBranchFlag(args)
    const pullRequest = parsePullRequestFlag(args)
    if (branch && pullRequest) {
      console.error("Usage: faber review [--branch <name> | --pull-request <num-or-url>]")
      console.error("--branch and --pull-request cannot be used together")
      exit(1)
    }
    if (args.includes("--pull-request") && !pullRequest) {
      console.error("--pull-request requires an argument (PR number or URL)")
      exit(1)
    }
    if (args.includes("--branch") && !branch) {
      console.error("--branch requires an argument (branch name)")
      exit(1)
    }

    const dirArg = parseDirFlag(args)
    const repoRoot = dirArg ?? findRepoRoot(process.cwd()) ?? resolve(process.cwd())
    const { tier, explicitModel } = parseModelFlag(args)
    const background = args.includes("--background")

    const mode: ReviewMode =
      pullRequest ? { kind: "pullRequest", arg: pullRequest } :
      branch ? { kind: "branch", name: branch } :
      { kind: "current" }

    try {
      await runReview(repoRoot, mode, tier, explicitModel, background)
    } catch (err: any) {
      console.error(err.message ?? String(err))
      exit(1)
    }
    return
  }

  // faber read <taskId> [--full] [--json] [--dir <repo>]
  // Print the log for a task. By default shows the prompt and text output with
  // tool calls summarised as one-liners. --full adds block content; --json
  // outputs the raw LogEntry array.
  if (command === "read") {
    const taskIdArg = positional[1]
    if (!taskIdArg) {
      console.error("Usage: faber read <taskId> [--full] [--json] [--dir <repo>]")
      exit(1)
    }
    const dirArg = parseDirFlag(args)
    const repoRoot = dirArg ?? findRepoRoot(process.cwd())
    if (!repoRoot) {
      console.error("Could not find faber state file from current directory")
      exit(1)
    }
    const readState_ = readState(repoRoot)
    let readTask: Task | null
    try {
      readTask = findTask(readState_.tasks, taskIdArg)
    } catch (err: any) {
      console.error(err.message)
      exit(1)
    }
    if (!readTask) {
      console.error(`No task matching "${taskIdArg}"`)
      exit(1)
    }
    const full = args.includes("--full")
    const json = args.includes("--json")
    const entries = readLogEntries(repoRoot, readTask.id)
    const output = formatLog(entries, { full, json })
    console.log(output)
    return
  }

  // faber watch <taskId> [--dir <repo>]
  // Watches a task's status and exits when it stops running.
  if (command === "watch") {
    const taskIdArg = positional[1]
    if (!taskIdArg) {
      console.error("Usage: faber watch <taskId> [--dir <repo>]")
      exit(1)
    }
    const dirArg = parseDirFlag(args)
    const repoRoot = dirArg ?? findRepoRoot(process.cwd())
    if (!repoRoot) {
      console.error("Could not find faber state file from current directory")
      exit(1)
    }
    const watchState = readState(repoRoot)
    let watchTask_: Task | null
    try {
      watchTask_ = findTask(watchState.tasks, taskIdArg)
    } catch (err: any) {
      console.error(err.message)
      exit(1)
    }
    if (!watchTask_) {
      console.error(`No task matching "${taskIdArg}"`)
      exit(1)
    }
    await watchTask(repoRoot, watchTask_.id)
    return
  }

  // faber diff <taskId> [--dir <repo>]
  // Prints the unified diff for a task's branch. Empty output is not an error
  // (it just means the task has no commits yet).
  if (command === "diff") {
    const taskIdArg = positional[1]
    if (!taskIdArg) {
      console.error("Usage: faber diff <taskId> [--dir <repo>]")
      exit(1)
    }
    const dirArg = parseDirFlag(args)
    const repoRoot = dirArg ?? findRepoRoot(process.cwd())
    if (!repoRoot) {
      console.error("Could not find faber state file from current directory")
      exit(1)
    }
    const state = readState(repoRoot)
    let task: Task | null
    try {
      task = findTask(state.tasks, taskIdArg)
    } catch (err: any) {
      console.error(err.message)
      exit(1)
    }
    if (!task) {
      console.error(`No task matching "${taskIdArg}"`)
      exit(1)
    }
    const diff = await getDiff(repoRoot, task.id)
    if (diff) process.stdout.write(diff + "\n")
    return
  }

  // faber update
  if (command === "update") {
    try {
      await checkAndUpdate(VERSION)
    } catch (err: any) {
      console.error(`Update failed: ${err.message}`)
      exit(1)
    }
    return
  }

  // faber extras
  if (command === "extras") {
    const { installExtras } = await import("./lib/extras.js")
    await installExtras(VERSION)
    return
  }

  // faber merge <taskId> [--dir <repo>]
  // Rebase the task branch onto the current HEAD, fast-forward merge it, and
  // remove the worktree. Exits 1 if the task is not found, not ready, has no
  // commits, or the rebase hits a conflict.
  if (command === "merge") {
    const taskId = positional[1]
    if (!taskId) {
      console.error("Usage: faber merge <taskId> [--dir <repo>]")
      exit(1)
    }
    const dirArg = parseDirFlag(args)
    const repoRoot = dirArg ?? findRepoRoot(process.cwd())
    if (!repoRoot) {
      console.error("Could not find faber state file from current directory")
      exit(1)
    }
    const state = readState(repoRoot)
    let task: Task | null
    try {
      task = findTask(state.tasks, taskId)
    } catch (err: any) {
      console.error(err.message)
      exit(1)
    }
    if (!task) {
      console.error(`No task matching "${taskId}"`)
      exit(1)
    }
    if (task.status !== "ready") {
      console.error(`Task "${task.id}" has status "${task.status}" -- only "ready" tasks can be merged`)
      exit(1)
    }
    if (!task.hasCommits) {
      console.error(`Task "${task.id}" has no commits. Use "faber done" to dismiss it instead.`)
      exit(1)
    }
    try {
      await mergeBranch(repoRoot, task.id, task.baseBranch)
    } catch (err: any) {
      console.error(`Merge failed: ${err.message}`)
      exit(1)
    }
    await removeWorktree(repoRoot, task.id)
    updateTask(repoRoot, task.id, { status: "done" })
    return
  }

  // faber done <taskId> [--dir <repo>]
  // Marks a ready task as done without touching the worktree or branch.
  if (command === "done") {
    const taskId = positional[1]
    if (!taskId) {
      console.error("Usage: faber done <taskId> [--dir <repo>]")
      exit(1)
    }
    const dirArg = parseDirFlag(args)
    const repoRoot = dirArg ?? findRepoRoot(process.cwd())
    if (!repoRoot) {
      console.error("Could not find faber state file from current directory")
      exit(1)
    }
    doneTask(repoRoot, taskId)
    return
  }

  // faber delete <taskId> [--yes] [--dir <repo>]
  // Removes the task from state, removes its worktree, and deletes its branch.
  // Destructive and irreversible -- requires confirmation unless --yes is set.
  if (command === "delete") {
    const taskId = positional[1]
    if (!taskId) {
      console.error("Usage: faber delete <taskId> [--yes] [--dir <repo>]")
      exit(1)
    }
    const dirArg = parseDirFlag(args)
    const repoRoot = dirArg ?? findRepoRoot(process.cwd())
    if (!repoRoot) {
      console.error("Could not find faber state file from current directory")
      exit(1)
    }
    // Resolve the full task ID upfront so we can show it in the confirm prompt.
    // deleteTask will validate existence and running status, but we need the
    // full ID before asking the user to confirm.
    const state = readState(repoRoot)
    let task: Task | null
    try {
      task = findTask(state.tasks, taskId)
    } catch (err: any) {
      console.error(err.message)
      exit(1)
    }
    if (!task) {
      console.error(`No task matching "${taskId}"`)
      exit(1)
    }
    if (task.status === "running") {
      console.error(`Task "${task.id}" is currently running. Stop it before deleting.`)
      exit(1)
    }
    const skipConfirm = args.includes("--yes")
    if (!skipConfirm) {
      process.stdout.write(`Delete task "${task.id}" and remove its worktree and branch? This cannot be undone. [y/N] `)
      const confirmed = await new Promise<boolean>((resolve) => {
        let input = ""
        process.stdin.setEncoding("utf8")
        process.stdin.setRawMode?.(true)
        process.stdin.resume()
        process.stdin.on("data", (chunk: string) => {
          const char = chunk.toString()
          if (char === "\r" || char === "\n") {
            process.stdin.setRawMode?.(false)
            process.stdin.pause()
            process.stdout.write("\n")
            resolve(input.toLowerCase() === "y")
          } else if (char === "\u0003") {
            // Ctrl-C
            process.stdin.setRawMode?.(false)
            process.stdin.pause()
            process.stdout.write("\n")
            resolve(false)
          } else {
            input += char
            process.stdout.write(char)
          }
        })
      })
      if (!confirmed) {
        console.log("Aborted.")
        exit(0)
      }
    }
    const deletedId = await deleteTask(repoRoot, task.id)
    console.log(`Deleted task "${deletedId}"`)
    return
  }

  // faber setup [--dir <repo>]
  if (command === "setup") {
    const dirArg = parseDirFlag(args)
    const repoRoot = dirArg ?? resolve(process.cwd())
    await setup(repoRoot)
    return
  }

  // Unknown command -- anything that didn't match a known command above.
  if (command && !command.startsWith("-")) {
    console.error(`Unknown command: "${command}". Run "faber --help" for usage.`)
    exit(1)
  }

  // faber [--dir <repo>]
  // No command -- launch the TUI.
  const dirArg = parseDirFlag(args)
  const repoRoot = dirArg ?? findRepoRoot(process.cwd()) ?? resolve(process.cwd())

  if (!existsSync(`${repoRoot}/.git`)) {
    console.error(`Not a git repository: ${repoRoot}`)
    exit(1)
  }

  ensureFaberDir(repoRoot)
  reconcileRunningTasks(repoRoot)

  let releaseLock: (() => Promise<void>) | null = null
  try {
    releaseLock = await acquireLock(repoRoot)
  } catch (err: any) {
    console.error(err.message)
    exit(1)
  }

  const globalConfigPath = join(homedir(), '.faber', 'faber.json')
  const projectConfigPath = join(repoRoot, '.faber', 'faber.json')
  const loadedConfig = loadConfig(globalConfigPath, projectConfigPath)

  const state = readState(repoRoot)
  const repoName = repoRoot.replace(homedir(), "~")

  const renderer = await createCliRenderer({ exitOnCtrlC: false, autoFocus: false })
  renderer.on('selection', (selection) => {
    const text = selection.getSelectedText()
    if (text) {
      renderer.copyToClipboardOSC52(text)
    }
  })
  const root = createRoot(renderer)

  root.render(
    <App
      repoRoot={repoRoot}
      repoName={repoName}
      version={VERSION}
      initialTasks={state.tasks}
      renderer={renderer}
      loadedConfig={loadedConfig}
      onExit={async () => {
        root.unmount()
        await releaseLock?.()
        renderer.destroy()
        exit(0)
      }}
    />
  )

  renderer.start()
}

export async function runHeadless(repoRoot: string, prompt: string, tier: Tier = DEFAULT_TIER, baseBranch?: string, loadedConfig: AgentConfig = {}, explicitModel?: string) {
  if (!existsSync(`${repoRoot}/.git`)) {
    console.error(`Not a git repository: ${repoRoot}`)
    exit(1)
  }

  ensureFaberDir(repoRoot)

  const resolvedBaseBranch = baseBranch ?? readCurrentBranch(repoRoot)

  let task: Task
  try {
    task = await createAndDispatchTask({
      repoRoot,
      prompt,
      tier,
      baseBranch: resolvedBaseBranch,
      callSite: "index.tsx:runHeadless",
      loadedConfig,
      explicitModel,
    })
  } catch (err: any) {
    console.error(`Failed to create worktree: ${err.message}`)
    throw err
  }

  console.log(`Task ${task.id} running`)
}

export async function setup(repoRoot: string) {
  if (!existsSync(join(repoRoot, ".git"))) {
    console.error(`Not a git repository: ${repoRoot}`)
    exit(1)
  }

  // Create .faber/, .worktrees/, and .plans/
  ensureFaberDir(repoRoot)
  const worktreesDir = join(repoRoot, ".worktrees")
  if (!existsSync(worktreesDir)) {
    mkdirSync(worktreesDir, { recursive: true })
  }
  const plansDir = join(repoRoot, ".plans")
  if (!existsSync(plansDir)) {
    mkdirSync(plansDir, { recursive: true })
  }

  // Add .faber/, .worktrees/, and .plans/ to the repo's .gitignore if not already present
  const gitignorePath = join(repoRoot, ".gitignore")
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : ""
  const lines = existing.split("\n")

  const toAdd: string[] = []
  if (!lines.some((l) => l.trim() === ".faber/")) toAdd.push(".faber/")
  if (!lines.some((l) => l.trim() === ".worktrees/")) toAdd.push(".worktrees/")
  if (!lines.some((l) => l.trim() === ".plans/")) toAdd.push(".plans/")

  if (toAdd.length > 0) {
    const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : ""
    writeFileSync(gitignorePath, existing + separator + toAdd.join("\n") + "\n")
    console.log(`Added to .gitignore: ${toAdd.join(", ")}`)
  }

  console.log("Faber setup complete.")
}



// Poll state.json until the given task is no longer running, then exit.
// Uses fs.watch for low-latency change detection, with a 1-second fallback
// interval to handle cases where file-system events are dropped (common on
// macOS with FSEvents under high I/O).
export async function watchTask(repoRoot: string, taskId: string): Promise<void> {
  const statePath = stateFilePath(repoRoot)

  function getStatus(): string | null {
    const state = readState(repoRoot)
    const task = state.tasks.find((t) => t.id === taskId)
    return task ? task.status : null
  }

  const initial = getStatus()
  if (initial === null) {
    console.error(`Task "${taskId}" not found`)
    exit(1)
  }

  console.log(`Watching task ${taskId} (status: ${initial})`)

  if (initial !== "running") {
    console.log(`Task ${taskId} is not running (status: ${initial})`)
    exit(0)
  }

  return new Promise<void>((resolve) => {
    let settled = false

    function check() {
      if (settled) return
      const status = getStatus()
      if (status === null) {
        // Task was removed from state.
        settled = true
        watcher.close()
        clearInterval(interval)
        console.log(`Task ${taskId} was removed`)
        resolve()
        exit(0)
      }
      if (status !== "running") {
        settled = true
        watcher.close()
        clearInterval(interval)
        console.log(`Task ${taskId} finished (status: ${status})`)
        resolve()
        exit(0)
      }
    }

    const watcher = fsWatch(statePath, () => check())
    const interval = setInterval(check, 1000)

    watcher.on("error", () => {
      // If the watch itself errors, fall back to polling only.
    })
  })
}

// Resume a stopped, failed, or unknown task by patching its state and
// re-spawning the agent in the same session. Exits with 1 if the task cannot
// be resumed. Prints the task ID to stdout so callers can pipe it into
// `faber watch`.
export function continueTask(repoRoot: string, taskId: string, prompt?: string): void {
  const state = readState(repoRoot)
  const task = state.tasks.find((t) => t.id === taskId)

  if (!task) {
    console.error(`Task "${taskId}" not found`)
    exit(1)
  }

  if (!task.sessionId) {
    console.error(`Task "${taskId}" has no session ID and cannot be resumed`)
    exit(1)
  }

  if (task.status === "running") {
    console.error(`Task "${taskId}" is already running`)
    exit(1)
  }

  updateTask(repoRoot, taskId, {
    status: "running",
    completedAt: null,
    exitCode: null,
  })

  const globalConfigPath = join(homedir(), '.faber', 'faber.json')
  const projectConfigPath = join(repoRoot, '.faber', 'faber.json')
  const loadedConfig = loadConfig(globalConfigPath, projectConfigPath)

  const resumePrompt = prompt ?? DEFAULT_RESUME_PROMPT
  spawnAgent(task, repoRoot, loadedConfig, task.sessionId, resumePrompt)

  console.log(taskId)
}

// Mark a running task as stopped. The task remains in state and can be
// resumed later with `faber continue`. Exits with 130 (SIGINT convention).
export function stopTask(repoRoot: string, taskId: string): void {
  const state = readState(repoRoot)
  const task = state.tasks.find((t) => t.id === taskId)

  if (!task) {
    console.error(`Task "${taskId}" not found`)
    exit(1)
  }

  if (task.status !== "running") {
    console.error(`Task "${taskId}" is not running (status: ${task.status})`)
    exit(1)
  }

  updateTask(repoRoot, taskId, {
    status: "stopped",
    completedAt: new Date().toISOString(),
    exitCode: null,
    pid: null,
  })

  console.log(taskId)
  process.exit(130)
}

// Print tasks as a table: ID, status, elapsed time, and truncated prompt.
// The prompt column is sized to fill the remaining terminal width.
export function listTasks(repoRoot: string, statusFilter: TaskStatus | null): void {
  const state = readState(repoRoot)
  let tasks = state.tasks

  if (statusFilter !== null) {
    tasks = tasks.filter((t) => t.status === statusFilter)
  }

  if (tasks.length === 0) {
    return
  }

  const now = Date.now()

  const idWidth = Math.max(...tasks.map((t) => t.id.length))
  const statusWidth = Math.max(...tasks.map((t) => t.status.length))
  const elapsedWidth = Math.max(...tasks.map((t) => formatElapsed(t.startedAt, t.completedAt, now).length))

  // Use stdout columns if available, otherwise fall back to 80.
  const termWidth = process.stdout.columns ?? 80
  // 3 spaces between each of the 4 columns, so 9 spaces total as separators.
  const separators = 9
  const promptWidth = Math.max(10, termWidth - idWidth - statusWidth - elapsedWidth - separators)

  for (const task of tasks) {
    const id = task.id.padEnd(idWidth)
    const status = task.status.padEnd(statusWidth)
    const elapsed = formatElapsed(task.startedAt, task.completedAt, now).padEnd(elapsedWidth)
    const displayText = task.summaryText ?? task.prompt
    const prompt = displayText.length > promptWidth
      ? displayText.slice(0, promptWidth - 3) + "..."
      : displayText
    console.log(`${id}   ${status}   ${elapsed}   ${prompt}`)
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err)
    exit(1)
  })
}
