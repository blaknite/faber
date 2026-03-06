# Workflow

The process for working with agents in Faber has three phases: shape, execute, and ship. The agent skills and faber work together to act as the harness.

Each phase has a defined output that feeds into the next. The goal is to front-load enough thinking before any agent starts so that there's nothing left to babysit.

## The principle

When you fire off a vague prompt, you're the only one who knows what done looks like. That means you can't leave. You have to watch. The way out is to write down what done looks like before the agent starts, clearly enough that something other than you can check it. That means thinking: clarifying the problem, grounding it in the codebase, breaking it into pieces with defined acceptance criteria. Once that work is done, an agent can execute against a spec rather than a hunch. You're reviewing finished work instead of steering work in progress.

Shaping forces you to think before anyone writes code. That thinking prevents messes. Planning makes the thinking legible so agents can execute against it. Execution is spec-driven: the acceptance criteria are the quality gate, not your gut. Shipping is the last mile: getting clean code in front of the people who need to review it.

Get shaping and planning right and execution is easy.

## You: Shape the work (`shaping-work`)

This is a conversation between you and an agent in [opencode](https://opencode.ai). Start with a rough idea. An issue, a feature request, a problem that needs solving. The goal is to move from "we should do this" to "here's exactly what we're building and why."

Work through the problem together. What's the goal? What are the constraints? What does done look like? Get specific: not "add export support" but "users can export their usage metrics from the settings page in CSV or JSON format, scoped to a date range." Specific enough that you could write a test for it.

The agent investigates the codebase while you talk. It finds the actual files the implementation will touch, checks how related features are already built, identifies where new code hooks into old code, and looks for gotchas. You steer the conversation; the agent grounds it in reality.

Together you synthesize everything into a PLAN.md. This document is written at agent level: specific files, function signatures, data shapes, implementation steps, and sequencing. An agent should be able to pick it up cold with no prior context and execute it without asking questions.

When the plan is ready, you take it to faber:

> Execute the plan in @.plans/metrics-export/PLAN.md

**Output:** A PLAN.md with acceptance criteria precise enough for an agent to verify its own work. The plan is grounded in real files and functions, with a clear implementation order that identifies which pieces are independent and which must sequence.

## Faber: Execute the plan (`executing-work`)

An orchestrating agent takes over from here.

It breaks the plan into tasks. Each task should be a bounded piece of work that an agent can complete independently. It figures out which tasks are truly independent (they touch different files, don't need each other's output) and which must sequence (one builds on a type or API that another introduces). Getting this wrong wastes time: conflicting changes on the same file, agents blocked on work that doesn't exist yet.

It dispatches the independent tasks in parallel. Each task gets its own agent in its own isolated git worktree. As each task finishes, the orchestrator reviews the diff against the plan: does it do what was asked? Are there changes that weren't asked for? Is anything incomplete or wrong? It merges what's clean, continues what needs fixing, and discards what's too far off to salvage.

It iterates through the batch. After dependent tasks are merged, it dispatches follow-up work. The loop continues until everything from the plan is merged and nothing is outstanding.

**Output:** Working code on a branch that implements the plan. All acceptance criteria from the plan are met. Code is committed in logical units with messages that explain the why.

## Faber: Ship it (`shipping-work`)

The agent pushes the branch to the remote, opens a pull request with a description that explains what the code does and why it matters, and watches the build. If CI fails, it diagnoses and fixes. When everything is green, the PR is ready for reviewers.

**Output:** A pull request with passing checks, ready for review.
