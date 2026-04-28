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

As each task completes, follow `reviewing-faber-tasks` to assess it. The mechanics live there -- run `faber review --task <id>`, read the findings, route the task. This step exists to remind you that the quality bar matters: don't merge work you're not confident in. Everything that follows builds on what you merge here.

If a task isn't right, continue it with specific feedback drawn from the review. If it's unsalvageable, delete it and dispatch a replacement with a better prompt. Only merge work you're genuinely satisfied with.

### Iterate

After each round of reviews, check what's left. Are there dependent tasks ready to dispatch? Did anything that was merged reveal a gap in the plan? If the plan needs adjustment, update the PLAN.md and adjust the remaining tasks. This is normal. Implementation always teaches you things the plan couldn't anticipate.

Dispatch the next round and repeat. Keep going until every piece of the plan has been implemented and merged.

## Step 4: Final review

Do a proper review of the combined result before handing off to shipping. The per-task reviews in step 3 checked each slice individually; now you're seeing it as one change for the first time.

Run `faber review` on the current branch (no flags) to get a fresh read of the merged work against the base branch. Add `--context` to point the reviewer at the plan or anything else worth flagging:

```bash
faber review --context "implements the plan at .plans/<feature>/PLAN.md; check for gaps against the requirements"
```

The findings tell you whether the slices hold together, whether anything was missed, and whether the code reads well as a whole. Skim the diff yourself too -- you're the one signing off.

Run the tests that are relevant to what changed. For small projects that might mean the full suite. For large codebases, focus on the tests that cover the areas that were touched. The full integration test happens in CI later, but you should be confident the code works before you get there.

If something isn't right, dispatch targeted follow-up tasks to fix it and review the results before moving on. The goal is to hand off code that a human reviewer could approve without sending it back for rework. Don't stop until the code on the branch matches the plan.
