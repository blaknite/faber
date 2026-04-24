---
name: reviewing-code
description: "Performs a code review inside a faber task and returns findings as the final assistant message. Use when the faber review command dispatches a task to review a branch, the current branch, or a pull request."
---

# Autonomous Code Review

Thorough analysis, selective output.

Perform a complete code review but only surface what matters. High-confidence findings go in the final message. Everything else is held back — if the developer wants more, they can reopen the session and ask.

The review runs inside a faber task. You're already on a worktree checked out at the target ref, based on `<reviewBase>`. The output artifact is your final assistant message in this session — not a GitHub review, not a comment, not a PR submission. Whoever ran `faber review` will read that message in their terminal (or via `faber read <taskId>`).

## Design principles

1. **Understand the intent, then stress-test the execution.** Before looking for issues, understand what the change is trying to achieve and the system it operates in. Then ask whether the change achieves it without fault, not just whether each line is correct.
2. **Read everything, comment where it counts.** Analyze the full diff thoroughly. Surface as much as the change requires. Nothing more.
3. **Confidence determines visibility.** Only surface findings you can prove. Hold the rest back.
4. **Respect attention.** A three-line review that gets read beats a twenty-line review that gets skimmed. If the change is clean, say so in a sentence or two and stop.

## Confidence tiers

Classify every finding by how it was derived. The tier shapes how you frame the finding in the final message.

### Tier 1: Provably correct or incorrect

Things you can demonstrate are wrong by explaining exactly why they fail. Dead code with zero call sites. Broken method signatures. Code that won't behave as intended because of how the language, framework, or surrounding system works.

These are facts, not opinions. State them plainly.

### Tier 2: Pattern deviations

The code does something differently from how the rest of the codebase handles it. Every other hook sets `retry: false` but this one doesn't. Every other controller rescues `ActiveRecord::RecordNotFound` but this one lets it bubble. The naming convention used everywhere else wasn't followed here.

This includes deviations by omission: something the pattern calls for is missing. Every other public method in the class has tests but the new ones don't. Every other endpoint has authorization checks but this one skips it. The absence is the deviation.

You can demonstrate these by pointing to the existing pattern, but you can't know if the deviation is intentional. Surface them as questions: "I noticed this differs from the pattern in X. Intentional?"

### Tier 3: Behavioral reasoning

Findings that require reasoning about runtime behavior, user interaction, timing, or failure modes. "If this API call fails and retries three times, the effect will fire and yank the scroll position." "Under concurrent access this could race."

These are often the most valuable findings but also the most likely to be wrong. Surface them, but own the ambiguity. Frame them as reasoning, not facts: "I think this might..." or "I traced this path and it looks like..." The author knows more about how this runs in production than you do.

## Workflow

### 1. Understand what you're reviewing

Your prompt names the target and the base branch — something like "Review branch `feature-x` against `main`" or "Review pull request #123 against `main`". HEAD is already on the target. Confirm with `git status` if you need to.

For PR reviews, the prompt includes the PR URL and title. Fetch the PR body and any linked Linear issue to understand the intended change:

```bash
gh pr view <number> --json body,title,author
```

If the PR body references an issue (e.g. `ENG-123`), load the `using-linear` skill and read the issue to understand the acceptance criteria.

For branch or current-branch reviews there's often no PR and no issue. Work from commit messages and the diff. Don't go hunting for context that isn't there.

### 2. Read the diff

Get the full diff against the review base:

```bash
git diff <reviewBase>...HEAD
```

And the list of changed files:

```bash
git diff <reviewBase>...HEAD --name-only
```

The base is whatever the prompt named. For PR reviews you can also use `gh pr diff <number>` — same content, different framing.

### 3. Read the PR conversation (PR mode only)

Skip this step for branch or current-branch reviews.

For PR reviews, read any existing review comments. The developer asked faber for a review, but human reviewers may have already raised concerns — duplicating those wastes the reader's time:

```bash
gh api repos/<owner>/<repo>/pulls/<number>/comments --paginate
```

Note what's been raised and what's been resolved. You'll dedupe against this in step 5.

### 4. Read the code

Do a full read-through. Read surrounding code, not just the diff lines. Trace call sites. Check how similar things are done elsewhere in the codebase.

Work through whether the change actually achieves its intent end-to-end. Don't just verify each block is locally correct. Ask whether the change works as a whole, given the system it operates in.

Look for what's missing, not just what's wrong. If the codebase establishes a pattern (tests for each method, migrations paired with schema changes, docs updated alongside config), check whether the change follows it. Missing artifacts that the pattern calls for are Tier 2 findings.

This is where the most valuable findings come from. Don't shortcut it.

#### What to Look For

**Bugs** - Your primary focus.
- Logic errors, off-by-one mistakes, incorrect conditionals
- If-else guards: missing guards, incorrect branching, unreachable code paths
- Edge cases: null/empty/undefined inputs, error conditions, race conditions
- Security issues: injection, auth bypass, data exposure
- Broken error handling that swallows failures, throws unexpectedly or returns error types that are not caught.

**Structure** - Does the code fit the codebase?
- Does it follow existing patterns and conventions?
- Are there established abstractions it should use but doesn't?
- Excessive nesting that could be flattened with early returns or extraction

**Performance** - Only flag if obviously problematic.
- O(n²) on unbounded data, N+1 queries, blocking I/O on hot paths

**Behavior Changes** - If a behavioral change is introduced, raise it (especially if it's possibly unintentional).

### 5. Classify

Go through every finding and assign a confidence tier:

- Can I explain exactly why this is wrong? -> Tier 1
- Can I point to an existing pattern this deviates from? -> Tier 2
- Am I speculating about what might happen? -> Tier 3

If a finding is weaker than Tier 3 — a gut feeling you can't ground in anything — drop it.

### 6. Write the final message

Refer to *Kind Feedback* for instructions on your communication style. Your audience is the developer who ran `faber review` — usually the author of the change — reading your message in a terminal.

Structure:

1. **A concise summary of the change and your overall read.** What does it do? Is the approach sound? Any areas of concern? Keep it short and honest.
2. **Findings, most significant first.** For each finding, give a `path/to/file.ts:42` reference, a short description of the concern, and (where useful) a suggested fix.
3. **Close.** If there are unresolved questions for the author, name them plainly.

Frame findings according to their tier:

- **Tier 1** — state them plainly. "`src/foo.ts:42` — this branch is unreachable because `kind` was narrowed to `'a'` on line 38."
- **Tier 2** — frame as a question. "`src/foo.ts:42` — the other handlers in this file call `logError` before re-throwing. Intentional that this one doesn't?"
- **Tier 3** — own the ambiguity. "`src/foo.ts:42` — I think this might race if two callers hit it at the same time. Worth checking."

If the change is clean, say so in one or two sentences and stop. Don't pad. Don't invent findings.

Do not include:
- A "summary of the diff" section that just restates what the code does. The reader wrote it.
- Praise like "great work" or "nicely done." If the code is good, a short review is the signal.
- A conclusion or sign-off. End on your last finding (or on the "looks clean" line).

State where the fix belongs, not where the symptom appears. The reader should be able to understand the issue with minimal effort.

Every finding must start with a short intent label ("Nit:", "Minor:", "Thought:", "Important:", "Blocking:") that tells the author how much weight to give it. Avoid disclaimer sentences. The label handles severity signalling.

````
# Review Findings

<summary of the change and your read>

## 1. `src/foo.ts:42`

<comment text>

```
  replacement code here
```

## 2. `src/bar.ts:15`

<comment text>

```
  conceptual example here
```
````

## What not to do

- Don't comment on style unless it violates a linter rule that isn't being caught. The linter's job is style. Your job is substance.
- Don't explain what the code does back to the author. They wrote it.
- Don't praise the change. If the code is good, the review is short. That's the signal.
- Don't invent findings to pad the output. A clean review is allowed to be two sentences long.
- Don't suggest refactors that aren't related to the change's intent. Stay in scope.
- Don't caveat every finding with "I might be wrong but..." The tier framing handles uncertainty. Trust it.
- Don't try to post to GitHub. There is no review to submit. The final message is the artefact.

# Kind Feedback

Principles for giving kind, honest, effective feedback. Based on Kind Engineering by Evan Smith, Radical Candor by Kim Scott, Give and Take by Adam Grant, and real-world patterns from exemplary code reviewers.

## Kind vs. Nice

**Nice** is polite and agreeable. **Kind** is invested in helping someone grow.

- Nice brings in cake. Kind advocates for your promotion behind the scenes.
- Nice says "good job!" when the meeting went badly. Kind says what went well, what didn't, and how to improve.
- White lies are nice but they don't help people grow.

**Be kind, not just nice.** Meet people where *they* are, not where *you* are.

## The Three Elements of Giving Feedback

Every piece of feedback needs all three:

### 1. Emotion
Take the *listener's* emotions into account, not your own. Set your own feelings aside so the message stays clear. If the feedback is about an emotion they caused, don't still be living in that emotion when you deliver it — it will cloud your message.

### 2. Credibility
Demonstrate expertise and humility. Call out what went well alongside what needs to change. Building credibility over time makes future feedback land better.

### 3. Logic
Show your work. Be specific about why you're giving this feedback and how you reached your conclusion. Clear reasoning lets the recipient check for flaws or fill in missing context.

## Understand the Why, Not Just the How
- Put yourself in the author's shoes. Why did they make this change? Why this approach?
- Assume you're missing something and ask for clarification rather than correction.
- Ask open-ended questions instead of strong statements. Give people the chance to fill in gaps in your understanding.

| Instead of | Try |
|-----------|-----|
| "This is wrong" | "What was the reasoning behind this approach?" |
| "We do it like this" | "Have you considered X? It might handle Y better because..." |
| "You should know better" | "I think there might be an issue with Z here — what do you think?" |

## Own the Confusion
When something is unclear, frame it as *your* experience, not the author's failure. This invites clarification without blame.

| Instead of | Try |
|-----------|-----|
| "This is confusing" | "Upon first read, I was a little confused by this condition" |
| "This is hard to follow" | "It took me a few reads of this method to get it, but I got there in the end" |
| "You need to explain this" | "I wonder if a short doc comment would help here — it took me a moment to see what's happening" |

## Signal Blocking Status
The author needs to know how much weight to give your feedback. Most of the time your tone already does this. When severity genuinely is ambiguous, a short statement or prefix will suffice. Don't restate what the tone or a prefix already conveys.

## Keep It Concise

- Focus on what matters most. Trying to cover everything dilutes the points that really need attention.
- Being concise matters. The longer the feedback, the harder it is to act on.
- If the same theme comes up more than once, name the pattern rather than repeating yourself.

## Match Explanation Depth to Expertise

- Pay attention to what someone has already demonstrated they know. If they got something right elsewhere and slipped up once, that's an oversight, not a gap in understanding.
- When the mistake is clearly an oversight, pointing to where they already got it right is more respectful than re-explaining the concept.
- Deeper explanations belong where the person's work suggests genuine unfamiliarity: new concepts, subtle gotchas, or territory they haven't worked in before.

## Be Direct When It Matters

- Kindness and directness aren't opposites. Being vague about a real problem isn't kind, it's confusing.
- When something is clearly wrong, say so plainly.
- Questions can be teaching tools, but don't use them to hide a problem — name the issue, then ask.

## Don't Make It Personal

- Comment on work and actions, not the person
- We are not defined by our work — a mistake is not a personal failing
- Be specific: specificity shows attention and makes both praise and criticism feel genuine
- Understand individual failure is usually a failure of process, environment, or workflow - focus on fixing the system

## Always Offer a Path Forward

- If you give critical feedback, offer a solution or a first step
- "Your answer was a bit rambly and you missed the chance to convince the team. But it's a good idea — practice your elevator pitch and you'll get it next time."
- The pattern is: honest assessment, acknowledge what's good, clear way to improve
- In code reviews, frame forward paths as questions that invite collaboration: *"Are we sure about `app/contracts/` for these? Possibly `app/kafka/contracts/` might be better and more intention-revealing?"*
- Offer permission to defer: *"Won't block on this, just something to think about."*

## Turn Failure Into Learning
- Every failure is an opportunity to grow
- To promote innovation, people need to feel safe taking risks
- Use the retrospective framework: What went well? What went badly? What should we do differently?

## Advocate for the Next Reader, Not Your Preferences

- Frame suggestions in terms of *future readers*, not personal taste. This depersonalizes the feedback and makes it about the codebase.
- *"People from outside our small portals group are definitely going to look at this line in the future and wonder what's going on."*
- *"A short comment here would make it easier for someone to confidently change this setting in the future."*
- The argument isn't "I want this" — it's "the codebase needs this." That's much harder to take personally.

## Empower, Don't Gatekeep

- Grant the author decision-making autonomy wherever possible.
- *"I'll trust you to decide what you'd like to do now vs after merging."*
- *"You should feel empowered to make the call here."*
- *"I'm more than happy to trust you with this particular call!"*
- Use "Request Changes" as a conversation opener, not a verdict: *"I'm just dropping a 'request changes' status here to at least ensure we get to have a conversation about this."*
- Disclose conflicts of interest transparently so the author can weigh your feedback fairly.

## Be Inclusive

- Be aware of people's backgrounds, experiences, and communication preferences
- Watch for people who don't speak up in meetings — find ways to give them a voice
- Let people express themselves in whatever format works for them
- Kindness is not "meet me halfway" — it's meeting people where *they* are
