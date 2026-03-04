---
name: reading-faber-logs
description: Read and query Faber task logs from outside a worktree. Use when you need to inspect what an agent did, extract specific information from a task log, or answer questions about a task's output.
---

# Reading Faber logs

Faber stores each task's log as a JSONL file at `.faber/tasks/<taskId>.jsonl` inside the project root. The `faber read` command is the primary way to access it.

You do not need to be inside a Faber worktree to use any of these commands. Run them from the project root or pass `--dir` to point at the right repo.

## Commands

### Default (summarised)

```bash
faber read <taskId>
```

Prints two sections: `# Prompt` and `# Output`. Tool calls appear as single lines with a prefix character indicating the type:

- `$` -- bash command
- `→` -- file read or directory list
- `←` -- file write or edit
- `✱` -- glob or grep (match count in parentheses)
- `%` -- web fetch
- `#` -- todo list
- `✓` / `•` / `✗` -- sub-agent task (done / running / failed)
- `⚙` -- any other tool

Block content (bash output, file contents, diffs) is suppressed. This is the right mode for a quick overview of what the agent did.

### Full output

```bash
faber read <taskId> --full
```

Same structure, but expands block content beneath each tool line. Use this when you need to see actual command output, file contents, or diffs produced by the agent.

### JSON

```bash
faber read <taskId> --json
```

Dumps the parsed log as a JSON array of `LogEntry` objects. Useful when you need to programmatically query the log -- pipe it to `jq` to filter or extract specific data.

## Practical workflows

### Did the agent run tests, and did they pass?

```bash
faber read <taskId> --full | grep -A 20 'bun test'
```

Or with JSON for something more reliable:

```bash
faber read <taskId> --json | jq '[.[] | select(.tool == "bash" and (.title | test("bun test")))] | .[].blockContent'
```

### What files did the agent write?

```bash
faber read <taskId> | grep '^  ←'
```

### What files did the agent read?

```bash
faber read <taskId> | grep '^  →'
```

### Did anything fail?

```bash
faber read <taskId> | grep '^  !'
```

Errors appear with a `!` prefix and include the error message.

### What was the agent's final text output?

The last `text` entries in the log are the agent's closing message. In JSON mode:

```bash
faber read <taskId> --json | jq '[.[] | select(.kind == "text")] | last | .text'
```

### Show just the prompt

```bash
faber read <taskId> | sed -n '/^# Prompt/,/^# Output/p' | head -n -1
```

## Reading the raw JSONL directly

If `faber` is not available or you want maximum control, the log file is at:

```
<projectRoot>/.faber/tasks/<taskId>.jsonl
```

Each line is a JSON object with a `type` field. The main types are:

| type | what it is |
|---|---|
| `prompt` | the initial prompt sent to the agent, plus the model name |
| `text` | a text message from the agent |
| `tool_use` | a single tool invocation: input, output, status |
| `step_finish` | end of one inference step; includes the model ID |
| `reasoning` | the agent's internal reasoning (often empty or minimal) |

A `tool_use` line looks like this:

```json
{"type":"tool_use","timestamp":1234567890,"part":{"tool":"bash","state":{"input":{"command":"bun test"},"status":"completed","output":"3 pass\n0 fail"}}}
```

You can `grep` or `jq` the raw file without going through `faber read`:

```bash
# All bash commands the agent ran
jq -r 'select(.type == "tool_use" and .part.tool == "bash") | .part.state.input.command' \
  .faber/tasks/<taskId>.jsonl

# All files written
jq -r 'select(.type == "tool_use" and (.part.tool | test("write"))) | .part.state.input.filePath' \
  .faber/tasks/<taskId>.jsonl

# Full text output from the agent
jq -r 'select(.type == "text") | .part.text' \
  .faber/tasks/<taskId>.jsonl
```

## Delegating to a sub-agent

Task logs can be long. If you need to answer a specific question about a task, delegate to a sub-agent rather than loading the full log into your own context.

Tell the sub-agent:
- The task ID
- Exactly what question to answer
- To use `faber read` or `faber read --json` to get the log
- To return only the answer, not a full transcript

Example sub-agent prompt:

> Read the log for Faber task `a3f2-fix-the-login-bug` using `faber read a3f2-fix-the-login-bug --full`. Tell me: did the agent run the test suite, and if so, did the tests pass? Return only that answer.

## Checking the diff instead

For code changes specifically, `faber diff` is more direct than reading the log:

```bash
faber diff <taskId>
```

This shows the git diff of the task branch on top of the base branch. It's the right starting point when you want to review the code rather than understand the agent's process.
