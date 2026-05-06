---
name: shipping-work
description: Takes working code on a branch and gets it to a green pull request. Use when you want to push, open a PR, and pass CI.
---

# Shipping work

Take working code on a branch and get it in front of reviewers with a green build. This is a one-shot, autonomous process. Push the code, open the PR, make CI pass, and hand back a link.

The input is a branch with committed code. The output is a pull request URL with required checks passing. The agent is not finished until the CI gate command exits 0, or it has exhausted its fix attempts and reported a stuck state.

## Step 1: Prepare the branch

Make sure the branch is ready to push:
- All changes are committed (check `git status`)
- The branch is rebased on the latest base branch to avoid unnecessary conflicts
- No unrelated changes are staged

Push the branch to the remote.

## Step 2: Open the pull request

### Gather context

```bash
# Current branch
git branch --show-current

# Commit summary for the PR title
git log main..HEAD --oneline

# Full commit messages for the PR body
git log main..HEAD --format="%B---"

# Changed files overview
git diff main...HEAD --stat
```

Check for a PR template at `.github/pull_request_template.md`. If one exists, structure the PR body to match its sections.

### Draft the PR description

Use all available context: PLAN.md, commit messages, code changes, conversation history, linked issues.

If there's no PR template, use this layout as a guide (skip sections that aren't relevant):

```markdown
## Description

What problem is being solved and how. Mention alternatives considered if the approach wasn't obvious.

## Context

Links to issues, docs, or other references.

## Changes

- Bulleted list of what changed
- Include screenshots for UI changes

## Verification

Acceptance testing steps a human can follow. Describe the expected behaviour, not just "it works."

## Deployment

Risk level, migration notes, deployment considerations.

## Rollback

Never leave blank. Be specific: can this be reverted cleanly? Are there feature flags? Migration concerns?
```

### Submit the PR

Verify `gh` is authenticated before spending time on the description:

```bash
gh auth status
```

Use a heredoc for the body to handle newlines and special characters:

```bash
gh pr create --title "<title>" --body "$(cat <<'EOF'
<body>
EOF
)"
```

Open as draft if the project convention is to use drafts, otherwise as ready for review. Do not request reviewers unless the conversation specifies who should review.

## Step 3: Wait for CI

Done is defined by a single command's exit code. The PR is not shipped until that command returns 0.

### Determine the gate

First check whether the repo has required checks configured:

```bash
required_count=$(gh pr checks <pr> --required --json bucket --jq 'length' 2>/dev/null || echo 0)
```

If `required_count` is greater than 0, the gate is:

```bash
gh pr checks <pr> --required --watch --fail-fast
```

Otherwise there are no required checks configured. Fall back to:

```bash
gh pr checks <pr> --watch --fail-fast
```

Note which mode you used — it goes in the final report.

### Run the gate

Run the gate command. It blocks until checks finish.

- If it exits 0, jump to Step 5.
- If it exits non-zero, go to Step 4.

## Step 4: Diagnose and fix

The fix loop runs at most 3 times. Each push intended to fix CI counts as one attempt. Re-running the gate without a new commit does not count.

For each iteration:

**1. Identify which checks failed:**

```bash
gh pr checks <pr> --required --json name,bucket,link --jq '.[] | select(.bucket=="fail")'
```

Drop `--required` if you are running in fallback mode.

**2. Fetch the logs for each failed check:**

```bash
gh run view --log-failed <run-id>
```

**3. Decide: real failure or flake?**

Treat every failure as real unless you have direct evidence it is a flake. The only way to establish flake evidence is to re-run the same job without code changes and have it pass:

```bash
gh run rerun --failed <run-id>
```

Then re-run the gate. If it passes, you have flake evidence and this does not count as a fix attempt. If the retry fails too, treat it as a real failure and fix it.

**4. For real failures:** fix the code, commit, push. This counts as one fix attempt. Then re-run the gate from Step 3.

**After 3 fix attempts with the gate still non-zero**, stop. Do not make a fourth attempt. Go to Step 6.

## Step 5: Done report

The gate exited 0. CI is green. The agent's final message must contain:

- The PR URL on its own line.
- A line stating "CI is green" and which gate mode ran (`--required` or fallback).
- A bulleted list of the checks that passed:

```bash
gh pr checks <pr> --json name,bucket --jq '.[] | select(.bucket=="pass") | .name'
```

## Step 6: Stuck report

The gate is still non-zero after 3 fix attempts. The agent must not claim done. The agent's final message must contain:

- The PR URL on its own line.
- An explicit "CI is not green; human intervention needed" line.
- A bulleted list of still-failing required checks, each with a one-line failure summary and the run link:

```bash
gh pr checks <pr> --required --json name,bucket,link --jq '.[] | select(.bucket=="fail")'
```

- A short "What I tried" section, one line per fix attempt.
