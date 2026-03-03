---
name: reading-faber-tasks
description: Lists and reads Faber task output using faber list and faber read. Use when you need to inspect task status, read what another task produced, or collect results from sub-tasks you dispatched.
---

# Reading Faber tasks

## Listing tasks

`faber list` prints a table of all tasks with their ID, status, elapsed time, and prompt:

```bash
faber list
```

Filter by status to narrow it down:

```bash
faber list --status running
faber list --status ready
faber list --status failed
```

## Reading task output

`faber read` prints the log for a specific task. Pass the task ID from `faber list`:

```bash
faber read a3f2-fix-the-login-bug
```

By default, tool calls are summarised as one-liners so the output stays readable. Use `--full` to expand everything, including bash output, file contents, and diffs:

```bash
faber read a3f2-fix-the-login-bug --full
```
