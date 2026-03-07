---
name: executing-work
description: Takes a plan and iteratively drives it to working code using Faber agents. Use when a PLAN.md exists and needs to be implemented across one or more parallel tasks.
---

# Executing work

Take a plan and turn it into working code. This skill orchestrates Faber tasks, reviews their output, and loops until everything in the plan is implemented and merged.

The output is working code on a branch, ready to ship.

## Step 1: Read the plan

Read the PLAN.md and understand:
- What components need to be built
- Which are independent (can run in parallel) and which must sequence
- What done looks like for each component

If the plan doesn't have an implementation order section, work one out before dispatching anything. Getting the task graph wrong wastes time: conflicting changes on the same file, missing dependencies, agents blocked on work that doesn't exist yet.

## Step 2: Dispatch tasks

Load the `orchestrating-faber-tasks` skill and follow its process. In short:

1. Break the goal into independent and dependent sub-tasks.
2. Dispatch all independent tasks upfront with self-contained prompts.
3. Watch the batch in parallel and act on each one as it completes.
4. After merging a round, dispatch any dependent tasks that were waiting on it.
5. Repeat until nothing is outstanding.

For each task, write a prompt that includes the relevant section of the PLAN.md (not the whole thing, just what this task needs), enough codebase context that the agent can work without asking questions, and what done looks like for this specific task.

## Step 3: Review results

As tasks complete, load `reviewing-faber-tasks` and follow its process. In short:

1. Read the diff to understand what the agent produced.
2. Review it as a quality gate: does the code do what was asked, does it make sense, would you build on top of it?
3. Route the task based on your judgment: merge, continue with feedback, done, or delete.
4. If a merge conflicts, continue the task with rebase instructions and retry.

Don't merge work you're not confident in. The final review in step 5 should be polishing a near-finished product, not cleaning up accumulated problems.

## Step 4: Iterate

After each round of reviews, check what's left:
- Are there dependent tasks waiting to be dispatched?
- Did any merged task reveal something the plan missed?

If the plan needs adjustment (a missed edge case, a wrong assumption that surfaced during implementation), update the PLAN.md and adjust the remaining tasks accordingly. This is normal. Implementation always teaches you things the plan couldn't anticipate.

Dispatch the next round and repeat from step 3.

## Step 5: Final review

When all tasks are merged and `faber list` shows nothing outstanding, do a proper review of the combined result before handing off to shipping.

Read through the full diff of all merged work. The per-task reviews in step 3 checked each slice individually. Now you're seeing it as one change for the first time. Does it hold together? Does the code read well as a whole, or does it feel like disconnected patches stitched together? Compare it against the plan's requirements and make sure nothing was missed or only partially addressed.

Run the tests that are relevant to what changed. For small projects that might mean the full suite. For large codebases, focus on the tests that cover the areas that were touched. The full integration test happens in CI later, but you should be confident the code works before you get there.

If something isn't right, dispatch targeted follow-up tasks to fix it and review the results before moving on. The goal is to hand off code that a human reviewer could approve without sending it back for rework. Don't stop until the code on the branch matches the plan.
