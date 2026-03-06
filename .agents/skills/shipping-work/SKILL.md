---
name: shipping-work
description: Takes working code on a branch and gets it to a green pull request. Use when you want to push, open a PR, and pass CI.
---

# Shipping work

Take working code on a branch and get it in front of reviewers with a green build. This is a one-shot, autonomous process. Push the code, open the PR, make CI pass, and hand back a link.

The input is a branch with committed code. The output is a pull request URL with passing checks.

## Step 1: Prepare the branch

Make sure the branch is ready to push:
- All changes are committed (check `git status`)
- The branch is rebased on the latest base branch to avoid unnecessary conflicts
- No unrelated changes are staged

Push the branch to the remote.

## Step 2: Open the pull request

Load the `submitting-pull-requests` skill and follow its process, with one adjustment: this is autonomous, so make reasonable decisions rather than asking the user at each step.

- Draft the PR description from the available context (PLAN.md, commit messages, conversation history)
- If a PR template exists in the repo, follow its structure
- Open the PR (as draft if the project convention is to use drafts, otherwise as ready for review)

## Step 3: Pass CI

Watch the build using whatever CI tooling is available in the environment. Check the PR's status checks via the GitHub CLI if no CI-specific tools are present:

```bash
gh pr checks <pr-number> --watch
```

If the build passes, jump to step 5.

If the build fails, move to step 4.

## Step 4: Debug and fix

Use whatever CI debugging tools are available in the environment to diagnose the failure. If none are available, use the GitHub CLI to find the failed check and its logs.

For each failure:
1. Determine if it's caused by the changes on this branch or is a pre-existing/flaky issue
2. If caused by this branch: fix it, commit, push, and watch the build again
3. If pre-existing or flaky: note it and retry the build

Repeat until the build is green. If a failure persists after two fix attempts, stop and report the issue to the user with what you've tried and what you've learned.

## Step 5: Done

Share the PR URL with the user. The PR has passing checks and is ready for human review.
