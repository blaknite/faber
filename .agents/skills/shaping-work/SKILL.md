---
name: shaping-work
description: Takes a rough idea and shapes it into an agent-ready plan. Use when someone has an idea, a vague requirement, or a problem to solve and needs to clarify what to build before building it.
---

# Shaping work

Turn a rough idea into a plan that agents can execute. This is the thinking phase. No code gets written here.

The output is a PLAN.md specific enough that an agent can pick it up cold and implement it without asking questions. Getting there means understanding the problem, grounding it in the codebase, writing the plan, and stress-testing it before handing off.

## Step 1: Clarify intent

Understand what the user wants and why before investigating anything.

Don't ask about things the user already told you. Start from what they gave you and press on the parts that are foggy.

Target the biggest source of ambiguity first. Whatever is foggiest is where to start.

Ask what things are before asking how to build them. Defining what something means in the context of this system forces the domain model into the open. Jumping straight to implementation produces answers built on unstated assumptions.

Question the problem statement itself. The stated problem isn't always the real problem. Ask what's actually going wrong, what's actually slow, what's actually painful. "What happens if we do nothing?" is a genuine question worth asking, not a rhetorical challenge. Sometimes the answer reshapes the whole effort.

Build on previous answers rather than cycling through categories. The user's response to one question should shape the next. If they reveal an unexpected constraint, follow that thread.

### What to establish

Be clear on all four of these before moving on:

**Goal.** What are we trying to achieve? Push past the solution framing to the underlying problem.

**Scope.** What's the smallest version of this that actually solves the problem? Ideas arrive overloaded with nice-to-haves. Ask what can be deferred or dropped without undermining the core. Solve the specific case before the general one.

**Constraints.** What are the boundaries? Existing systems to work within, backwards compatibility concerns, performance requirements, things we explicitly don't want to change.

**What done looks like.** Specific, observable outcomes. Someone should be able to verify the work is complete without asking the author what they meant.

If any of these are shaky, keep asking. If the user isn't sure, help them think it through rather than moving on with gaps.

## Step 2: Investigate the codebase

Ground the idea in reality. Even if the user provided context about the codebase, verify it yourself. Things change, and assumptions from a conversation might not match the code.

Use sub-agents to explore:
- Find the actual files the implementation will touch
- Check how related features are built (follow the existing patterns)
- Identify where new code hooks into old code
- Note data shapes, type signatures, naming conventions
- Look for gotchas: circular dependencies, performance-sensitive paths, shared state

Look for misalignment between what the user wants and what the codebase supports. When the change requires a concept the codebase doesn't have, that's the hardest part of the project and it should reshape the plan.

When the codebase surprises you, stop and reassess. The surprise might invalidate an assumption from Step 1. If so, go back and re-clarify before pressing forward.

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

Write with these in mind throughout, not as a checklist at the end:

- Specific enough to execute cold. An agent starting in an isolated worktree with no prior context should be able to read this and implement without asking questions.
- Grounded in real files. Every component in the implementation section should reference an actual file path.
- Honest about sequencing. If one step depends on output from another, say so. The orchestrator uses this to build the task graph.
- Concrete before abstract. If the plan introduces an abstraction, it should justify why a concrete implementation isn't enough. Abstractions that can't answer that question should be cut.
- No padding. Skip sections that don't apply. A short, precise plan beats a thorough one that buries the signal.

## Step 4: Challenge the plan

Try to break it before handing it off. Problems are cheap to fix now and expensive after agents have been working for an hour.

Start by writing down every assumption the plan makes. You can't challenge assumptions you haven't named.

For each one, ask: what if this is wrong? Go verify anything the plan assumes about the codebase. Confirm any constraints the user mentioned still hold.

Then step back and challenge the plan as a whole:

- What if we did nothing? The answer changes what you do with the plan. If inaction is fine for a while, revisit scope. If it isn't, that validates the urgency.
- Are we solving the right problem? Revisit whether the investigation in Step 2 confirmed or undermined the problem as stated in Step 1.
- Is there a simpler approach? Every abstraction is a layer agents have to get right. Look for opportunities to reuse what exists or reduce moving parts.

Also check the mechanics: edge cases and malformed input, sequencing dependencies between tasks, and sections vague enough that an agent would have to guess.

Fix what you can without asking. Update the plan directly for anything where the right answer is clear. Only surface findings that require intent the user hasn't expressed, or where getting it wrong could derail the whole effort.

If the challenge revealed incomplete inputs, go back and fill them: unclear intent or scope means Step 1, codebase unknowns mean Step 2. Keep cycling until the challenge finds nothing that sends you back.

## Step 5: Hand off

Present the plan and walk the user through what it proposes and why. This is the moment to catch anything the written plan obscures — a choice that made sense during investigation but reads ambiguously on the page, a sequencing decision that needs explaining. Adjust until they're satisfied.

Save the PLAN.md if not already saved (`.plans/<feature-slug>/PLAN.md` is a good default).
