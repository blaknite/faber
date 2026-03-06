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

Load the `orchestrating-faber-tasks` skill and follow its process.

For each task, write a prompt that includes:
- The relevant section of the PLAN.md (not the whole thing, just what this task needs)
- Enough codebase context that the agent can work without asking questions
- What done looks like for this specific task

Dispatch all independent tasks upfront. Hold dependent tasks until their prerequisites are merged.

## Step 3: Review results

As tasks complete, load `reviewing-faber-tasks` and assess each one:
- Does the output match what the plan asked for?
- Are there changes that weren't asked for?
- Does anything look wrong or incomplete?

Route each task: merge if good, continue if incomplete, delete if unsalvageable.

## Step 4: Iterate

After each round of reviews, check what's left:
- Are there dependent tasks waiting to be dispatched?
- Did any merged task reveal something the plan missed?

If the plan needs adjustment (a missed edge case, a wrong assumption that surfaced during implementation), update the PLAN.md and adjust the remaining tasks accordingly. This is normal. Implementation always teaches you things the plan couldn't anticipate.

Dispatch the next round and repeat from step 3.

## Step 5: Verify intent

When all tasks are merged and `faber list` shows nothing outstanding, do a final check. Read through the combined diff of all merged work and compare it against the plan's requirements:

- Does the implementation cover every requirement in the plan?
- Are there requirements that were partially addressed or missed entirely?
- Did the implementation introduce anything that contradicts the plan's constraints?

If something is missing or wrong, dispatch targeted follow-up tasks to close the gaps. Don't ship incomplete work just because the task list is empty.

## Step 6: Done

The code is on a branch and matches the plan.
