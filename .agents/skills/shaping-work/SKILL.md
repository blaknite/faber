---
name: shaping-work
description: Takes a rough idea and shapes it into an agent-ready plan. Use when someone has an idea, a vague requirement, or a problem to solve and needs to clarify what to build before building it.
---

# Shaping work

Turn a rough idea into a plan that agents can execute. This is the thinking phase. No code gets written here.

The output is a PLAN.md: a document specific enough that an agent can pick it up cold and implement it without asking questions. Getting there means understanding the problem, grounding it in the codebase, writing the plan, and stress-testing it before handing off.

## When to use this

When someone says something like:
- "I want to build..."
- "We need to add..."
- "There's a problem with..."
- "Scope this out..."
- "I have an idea..."

Or when they paste a block of context (an issue, a conversation, a product spec) and want to turn it into work.

## Step 1: Clarify intent

Before investigating anything, make sure you understand what the user wants and why. The goal is to get to a point where you could explain the work to someone else in a few sentences.

Don't ask about things the user already told you. If they gave you a detailed description of the problem, don't ask them to re-explain it. Start from what they gave you and press on the parts that are foggy.

### How to ask

Target the biggest source of ambiguity first. Whatever is foggiest in the user's description is where to start, not the first item on a checklist.

Ask what things ARE before asking how to build them. Defining what something means in the context of this system forces the domain model into the open. Jumping straight to implementation skips that and produces answers built on unstated assumptions.

Question the problem statement itself. The stated problem isn't always the real problem. Ask what's actually going wrong, what's actually slow, what's actually painful. Ask "what happens if we do nothing?" as a genuine question, not a challenge. Sometimes the answer reshapes the whole effort.

Build on previous answers rather than working through a checklist. The user's response to one question should shape the next. If they reveal an unexpected constraint, follow that thread.

### What you need to understand

Work through these until you're confident in all of them:

**Goal.** What are we trying to achieve? Push past the solution framing ("build X") to the underlying problem ("prevent Y from happening").

**Constraints.** What are the boundaries? Existing systems we need to work within, backwards compatibility concerns, performance requirements, things we explicitly don't want to change.

**What done looks like.** Specific, observable outcomes. Someone should be able to verify the work is complete without asking the author what they meant.

### Readiness check

Before moving on, you should be able to answer:
- Can you explain the goal in one sentence without hand-waving?
- Are the constraints clear enough that you'd know if a solution violated them?
- Could you write a test for "done" right now?

If any of those are shaky, keep asking. If the user isn't sure, help them think it through rather than moving on with gaps.

## Step 2: Investigate the codebase

Ground the idea in reality. Even if the user provided context about the codebase, verify it yourself. Things change, and assumptions from a conversation might not match the code.

### What to look for

Use sub-agents to explore:
- Find the actual files the implementation will touch
- Check how related features are built (follow the existing patterns)
- Identify where new code hooks into old code
- Note data shapes, type signatures, naming conventions
- Look for gotchas: circular dependencies, performance-sensitive paths, shared state

### How to think about what you find

The most important thing to surface is misalignment between what the user wants and what the codebase supports. When the change requires a concept the codebase doesn't have, that's not a footnote. That's the hardest part of the project and it should reshape the plan.

Ask yourself: if we started with a blank slate, would we build what's already here? If not, figure out whether the plan should work within the existing structure or propose changing it. Both are valid, but the plan needs to be explicit about which path it's taking and why.

When the codebase surprises you, stop and reassess. Sometimes the surprise invalidates an assumption from Step 1. If so, go back and re-clarify with the user rather than pressing forward on a shaky foundation.

### Readiness check

Don't move to planning until you can name specific files and functions. Vague understanding produces vague plans, and vague plans produce agents that guess.

## Step 3: Write the plan

Synthesise the clarifying conversation from Step 1 and the codebase investigation from Step 2 into a PLAN.md. This is not a design document for humans. It's instructions an agent can execute cold.

### Structure

```markdown
# <Feature name>

## Summary
Why this exists. 1-3 sentences. What problem it solves.

## Requirements
User-visible or API-visible behaviour, precise enough for an agent to verify its own work.
Include exact UI text, data formats, edge case handling.

## Context
Existing systems, data flows, and patterns the implementation builds on.
Name specific files. Include relevant code shapes (types, function signatures) already in the codebase.
Explain constraints or gotchas discovered during investigation.

## Implementation
Per-component breakdown. For each piece:
- Which file(s) it touches
- What changes or gets added (new types, new functions, modified behaviour)
- Exact signatures where they matter
- What done looks like

## Implementation order
Numbered list of sequenced steps when ordering matters.
Identify which steps are independent (can run in parallel) and which must follow earlier steps.
```

### What makes a good plan

- **Specific enough to execute cold.** An agent starting in an isolated worktree with no prior context should be able to read this plan and implement without asking questions.
- **Grounded in real files.** Every component in the implementation section should reference an actual file path.
- **Honest about sequencing.** If one step depends on output from another, say so. The orchestrator uses this to build the task graph.
- **No padding.** Skip sections that don't apply. A short, precise plan beats a thorough one that buries the signal.

## Step 4: Challenge the plan

Before handing the plan off, try to break it. Problems are cheap to fix now and expensive to fix after agents have been working for an hour.

### Surface assumptions first

Before reviewing individual sections, write down every assumption the plan makes. These are things the plan treats as true without verifying: data shapes it expects to exist, patterns it expects to follow, boundaries it expects to hold. You can't challenge assumptions you haven't named.

### Then try to break each one

For each assumption, ask: what if this is wrong? Not as an abstract exercise, but concretely. If the plan assumes something about the codebase, go verify it. If it assumes a constraint the user mentioned, confirm it still holds.

Beyond individual assumptions, challenge the plan as a whole:

**What if we did nothing?** This isn't rhetorical. If inaction is tolerable for a while, the plan might be over-engineered for the actual urgency. If inaction is catastrophic, that validates the approach and might raise the priority of certain steps.

**Are we solving the right problem?** A well-crafted solution to the wrong problem is still wrong. Revisit whether the investigation in Step 2 confirmed or undermined the problem as stated in Step 1.

**Is there a simpler approach?** Every abstraction the plan introduces is a layer agents have to get right. Look for opportunities to reuse what exists or reduce the number of moving parts.

### Check the mechanics

**Missing cases.** What happens at the edges? Empty input, enormous input, malformed input, concurrent access, existing data that doesn't fit the new model.

**Sequencing problems.** Does the implementation order actually work? Are dependencies between steps explicit? Could two parallel tasks conflict on the same file?

**Drift risk.** Is the plan so large or vague in places that agents are likely to wander? Are there sections where an agent would have to make judgment calls that could go wrong?

### What to do with what you find

Present your findings. If everything looks solid, say so and move on. If you found issues, walk through them:
- For each concern, explain the problem and suggest a fix
- If something is high-risk (could cause the whole plan to fail or require a restart), flag it clearly and get the user's input before proceeding
- For lower-risk concerns, propose the fix and apply it unless the user disagrees

Then check whether the plan holds up. If the challenge exposed gaps in intent, go back to Step 1. If it revealed codebase unknowns, go back to Step 2. If the plan structure needs rethinking, go back to Step 3. Only move to the hand off when the plan passes through the challenge without needing to revisit anything.

## Step 5: Hand off

Present the plan to the user and ask if it captures what they had in mind. Adjust until they're happy.

Save the PLAN.md if not already saved (`.plans/<feature-slug>/PLAN.md` is a good default).
