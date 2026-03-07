---
name: executing-work
description: Takes a plan and iteratively drives it to working code using Faber agents. Use when a PLAN.md exists and needs to be implemented across one or more parallel tasks.
---

# Executing work

Take a plan and turn it into working code. Break it into tasks, dispatch them through Faber, review the results, and loop until everything is implemented and merged. The output is working code on a branch, ready to ship.

## Step 1: Read the plan

Read the PLAN.md and understand what needs to be built, what depends on what, and what done looks like for each piece. If the plan doesn't have an implementation order section, work one out before dispatching anything.

## Step 2: Break it into tasks

Identify which pieces of the plan are independent and which must sequence. Independent work can run in parallel. Dependent work has to wait until its prerequisites are merged.

A task is independent when it touches different files or systems and doesn't need to know what another task decided or produced. When in doubt, sequence. Two tasks that conflict on the same file are harder to recover from than a slightly longer wall clock time.

For each task, write a prompt that includes the relevant section of the PLAN.md (not the whole thing, just what this task needs), enough codebase context that the agent can work without asking questions, and what done looks like for this specific task.

## Step 3: Run the loop

Load `orchestrating-faber-tasks` and `reviewing-faber-tasks` for the mechanics of dispatching and reviewing tasks with faber.

### Dispatch

Dispatch all independent tasks upfront. Hold dependent tasks until their prerequisites are merged. Each round should be as parallel as possible without risking conflicts.

### Review

As each task completes, read the diff. This is where the quality bar matters: read it like you'd review a colleague's work. Does it do what was asked? Does the code make sense? Is it something you'd be comfortable building on top of? Don't merge work you're not confident in. Everything that follows builds on what you merge here.

If a task isn't right, continue it with specific feedback. If it's unsalvageable, delete it and dispatch a replacement with a better prompt. Only merge work you're genuinely satisfied with.

### Iterate

After each round of reviews, check what's left. Are there dependent tasks ready to dispatch? Did anything that was merged reveal a gap in the plan? If the plan needs adjustment, update the PLAN.md and adjust the remaining tasks. This is normal. Implementation always teaches you things the plan couldn't anticipate.

Dispatch the next round and repeat. Keep going until every piece of the plan has been implemented and merged.

## Step 4: Final review

Do a proper review of the combined result before handing off to shipping.

Read through the full diff of all merged work. The per-task reviews in step 3 checked each slice individually. Now you're seeing it as one change for the first time. Does it hold together? Does the code read well as a whole, or does it feel like disconnected patches stitched together? Compare it against the plan's requirements and make sure nothing was missed or only partially addressed.

Run the tests that are relevant to what changed. For small projects that might mean the full suite. For large codebases, focus on the tests that cover the areas that were touched. The full integration test happens in CI later, but you should be confident the code works before you get there.

If something isn't right, dispatch targeted follow-up tasks to fix it and review the results before moving on. The goal is to hand off code that a human reviewer could approve without sending it back for rework. Don't stop until the code on the branch matches the plan.
