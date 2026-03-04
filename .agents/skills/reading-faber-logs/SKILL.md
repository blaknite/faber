---
name: reading-faber-logs
description: Read and query Faber task logs from outside a worktree. Use when you need to inspect what an agent did, extract specific information from a task log, or answer questions about a task's output.
---

# Reading Faber logs

## Start with the diff, not the log

If you want to know what a task produced, `faber diff <taskId>` is almost always the right first move. It shows exactly what the agent committed -- nothing more. The log tells you the story of how it got there, which you usually don't need.

Only reach for the log when the diff isn't enough: when you need to know why a decision was made, whether tests passed, what the agent's closing summary said, or why a task failed.

## Don't load the full log into your context

Logs from real tasks are long. Loading one into your own context burns a lot of tokens and buries you in detail that isn't relevant to what you're trying to answer.

The better approach is to delegate. Spin up a sub-agent, give it the task ID and a specific question, and have it return only the answer. The sub-agent pays the context cost; you get a clean summary.

Example prompt to the sub-agent:

> Read the log for Faber task `a3f2-fix-the-login-bug` using `faber read a3f2-fix-the-login-bug`. Did the agent run the test suite, and if so, did they pass? Return only that.

Keep the question narrow. "What did the agent do?" produces a wall of text. "Did the tests pass?" produces one sentence.

## When you do read it yourself, start summarised

`faber read <taskId>` without flags gives you a condensed view: one line per tool call, no output blocks. For most questions this is enough to orient yourself -- you can see what files were touched, what commands ran, and whether anything errored.

Only add `--full` when you need the actual output of a command or the content of a file the agent wrote. It's a lot noisier, so wait until you know which specific tool call you need to expand.

## Ask one question at a time

The log is a transcript. Reading it linearly looking for "anything interesting" is slow and unreliable. It works better to come in with a specific question and stop as soon as you have the answer.

Good questions:
- Did the test suite pass?
- What did the agent say at the end?
- Which files did it modify?
- Did any tool call produce an error?

Avoid open-ended fishing like "summarise what the agent did" unless a human is genuinely asking for that. The diff is better for code review; the log is better for debugging.

## Use `--json` for precision

When you need to extract something specific and `grep` on the text output feels fragile, `faber read <taskId> --json` gives you a structured array you can query with `jq`. The fields are consistent and typed, so you can select by tool name, status, or content without worrying about formatting changes.

This is especially useful for: checking exit status of a specific command, finding all files written, or pulling the agent's final message.

## Reading the raw file

If `faber` isn't available, the log is at `.faber/tasks/<taskId>.jsonl` in the project root -- newline-delimited JSON, one event per line. You can `jq` it directly without the CLI. The same rules apply: come in with a specific question, don't try to process the whole file.
