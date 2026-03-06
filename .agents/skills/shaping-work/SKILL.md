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

Or when they paste a block of context (a Linear issue, a Slack conversation, a product spec) and want to turn it into work.

If a PLAN.md already exists and just needs execution, skip this.

## Step 1: Clarify intent

Before investigating anything, make sure you understand what the user wants and why. The goal is to get to a point where you could explain the work to someone else in a few sentences.

Ask about what's missing from the context provided. Don't ask about things the user already told you. If they pasted a detailed Linear issue, don't ask them to re-explain the problem.

Work through these until you're confident in all of them:

**Goal.** What are we trying to achieve? Not "build a rate limiter" but "prevent a single org from starving others of API capacity."

**Constraints.** What are the boundaries? Existing systems we need to work within, backwards compatibility concerns, performance requirements, things we explicitly don't want to change.

**What done looks like.** How will we know this is finished? Specific, observable outcomes. "An org hitting the rate limit gets a 429 response with a Retry-After header" is better than "rate limiting works."

### Readiness check

Before moving on, you should be able to answer:
- Can you explain the goal in one sentence without hand-waving?
- Are the constraints clear enough that you'd know if a solution violated them?
- Could you write a test for "done" right now?

If any of those are shaky, keep asking. If the user isn't sure, help them think it through rather than moving on with gaps.

## Step 2: Investigate the codebase

Ground the idea in reality. Even if the user provided context about the codebase, verify it yourself. Things change, and assumptions from a conversation might not match the code.

Use sub-agents to explore:
- Find the actual files the implementation will touch
- Check how related features are built (follow the existing patterns)
- Identify where new code hooks into old code
- Note data shapes, type signatures, naming conventions
- Look for gotchas: circular dependencies, performance-sensitive paths, shared state

Don't move to planning until you can name specific files and functions. Vague understanding produces vague plans, and vague plans produce agents that guess.

## Step 3: Plan

Load the `planning-faber-orchestration` skill and follow its process to produce a PLAN.md.

The clarifying conversation from step 1 and the codebase investigation from step 2 are your inputs. The planning skill will structure them into an agent-ready document with specific files, function signatures, implementation steps, and sequencing.

## Step 4: Challenge the plan

Before handing the plan off, try to break it. Review the PLAN.md with a critical eye and look for:

**Wrong assumptions.** Does the plan assume something about the codebase that isn't true? Does it assume a pattern exists that doesn't? Does it assume a file works a certain way without checking?

**Missing cases.** What happens at the edges? What if the input is empty, huge, or malformed? What about concurrent access? What about existing data that doesn't fit the new model?

**Unnecessary complexity.** Is there a simpler approach? Could we solve this with less code, fewer moving parts, or by reusing something that already exists? Every layer of abstraction the plan introduces is a layer agents have to get right.

**Sequencing problems.** Does the implementation order actually work? If task B depends on a type from task A, is that dependency explicit? Could two parallel tasks conflict on the same file?

**Drift risk.** Is the plan so large or vague in places that agents are likely to wander? Are there sections where an agent would have to make judgment calls that could go wrong?

Present what you find. If everything looks solid, say so and move on. If you found issues, walk through them:
- For each concern, explain the problem and suggest a fix
- If something is high-risk (could cause the whole plan to fail or require a restart), flag it clearly and get the user's input before proceeding
- For lower-risk concerns, propose the fix and apply it unless the user disagrees

Update the PLAN.md with any changes.

## Step 5: Hand off

Save the PLAN.md if not already saved (`.plans/<feature-slug>/PLAN.md` is a good default).
