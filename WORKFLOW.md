# Workflow

The process for working with agents in Faber has three phases: shape, execute, and ship. The agent skills and faber handle the mechanics of each phase.

Each phase has a defined output that feeds into the next. The goal is to front-load enough thinking before any agent starts so that there's nothing left to babysit.

## The principle

When you fire off a vague prompt, you're the only one who knows what done looks like. That means you can't leave. You have to watch. The way out is to write down what done looks like before the agent starts, clearly enough that something other than you can check it. That means thinking: clarifying the problem, grounding it in the codebase, breaking it into pieces with defined acceptance criteria. Once that work is done, an agent can execute against a spec rather than a hunch. You're reviewing finished work instead of steering work in progress.

Shaping forces you to think before anyone writes code, and that thinking prevents messes. Planning makes the thinking legible so agents can execute against it. Execution is spec-driven: the acceptance criteria are the quality gate. Shipping gets clean code in front of the people who need to review it.

Get shaping and planning right and execution is predictable.

## You: Shape the work (`shaping-work`)

This is a conversation between you and an agent. Start with a rough idea. An issue, a feature request, a problem that needs solving. The goal is to move from "we should do this" to "here's exactly what we're building and why."

Work through the problem together. What's the goal? What are the constraints? What does done look like? Get specific: not "add export support" but "users can export their usage metrics from the settings page in CSV or JSON format, scoped to a date range." Specific enough that you could write a test for it.

The agent investigates the codebase while you talk. It finds the actual files the implementation will touch, checks how related features are already built, identifies where new code hooks into old code, and looks for gotchas. You steer the conversation; the agent grounds it in reality.

Before the plan is final, the agent challenges it: listing assumptions, checking them against the codebase, and looking for simpler approaches. Problems are cheap to fix here and expensive to fix during execution.

Together you synthesize everything into a PLAN.md. This document is written at agent level: specific files, function signatures, data shapes, implementation steps, and sequencing. An agent should be able to pick it up cold with no prior context and execute it without asking questions.

When the plan is ready, you take it to faber:

> Execute the plan in @.plans/metrics-export/PLAN.md

**Output:** A PLAN.md with acceptance criteria precise enough for an agent to verify its own work. The plan is grounded in real files and functions, with a clear implementation order.

## Faber: Execute the plan (`executing-work`)

An orchestrating agent takes over from here.

It breaks the plan into tasks. Each task should be a bounded piece of work that an agent can complete independently. It figures out which tasks are truly independent (they touch different files, don't need each other's output) and which must sequence (one builds on a type or API that another introduces). Getting this wrong wastes time: conflicting changes on the same file, agents blocked on work that doesn't exist yet.

It runs the independent tasks in parallel. Each task gets its own agent in its own isolated git worktree. As each task finishes, the orchestrator reviews the diff against the plan: does it do what was asked? Are there changes that weren't asked for? Is anything incomplete or wrong? It merges what's clean, continues what needs fixing, and discards what's too far off to salvage.

It iterates through the batch. After dependent tasks are merged, it starts the follow-up work. If implementation reveals something the plan missed (a wrong assumption, an edge case), it updates the plan and adjusts remaining tasks. The loop continues until everything from the plan is merged and nothing is outstanding.

Once the task list is empty, the orchestrator does a final verification: reading the combined diff against the plan's requirements to make sure nothing was partially addressed or missed entirely. If there are gaps, it queues targeted follow-up tasks to close them.

**Output:** Working code on a branch that implements the plan. All acceptance criteria from the plan are met. Code is committed in logical units with messages that explain the why.

## Faber: Ship the work (`shipping-work`)

The agent makes sure the branch is clean and rebased, pushes to the remote, and opens a pull request with a description that explains what the code does and why it matters. It watches the build. If CI fails, it diagnoses and fixes. If a failure persists after a couple of attempts, it stops and reports what it tried rather than spinning. When everything is green, the PR is ready for reviewers.

**Output:** A pull request with passing checks, ready for review.
