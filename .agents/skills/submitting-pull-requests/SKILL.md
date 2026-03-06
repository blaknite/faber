---
name: submitting-pull-requests
description: Creates and submits pull requests with well-structured descriptions following project guidelines. Use when asked to open a PR, submit a PR, or create a pull request.
---

# Submitting pull requests

Creates pull requests using the GitHub CLI with descriptions that follow project conventions.

## Prerequisites

- GitHub CLI (`gh`) must be installed and authenticated
- Run `gh auth status` to verify authentication
- Changes must be committed and pushed to a remote branch

## Workflow

1. **Gather context** -- determine the branch, read commits, check for linked issues
2. **Check for PR template** -- look for `.github/pull_request_template.md` in the repo
3. **Draft the PR description** -- generate a description following the template structure
4. **Present draft to user** -- show the proposed title and body, ask for feedback
5. **Iterate** -- revise based on user feedback until approved
6. **Ask for reviewers** -- prompt the user for who should review the PR
7. **Submit PR** -- use `gh pr create` to open the pull request
8. **Share the link** -- display the PR URL to the user

## Gathering context

```bash
# Current branch
git branch --show-current

# Recent commits on branch vs main
git log main..HEAD --oneline

# Full commit messages for context
git log main..HEAD --format="%B---"

# Changed files
git diff main...HEAD --stat
```

## Checking for PR template

```bash
cat .github/pull_request_template.md 2>/dev/null
```

If a template exists, structure the PR body to match its sections.

## Drafting the description

Use all available context to draft the PR:
- Issue details (title, description, acceptance criteria)
- Commit messages and code changes
- Any other context from the current conversation (Slack threads, docs, specs)

### Common PR sections

**Description**
- What problem is being solved and how
- Alternatives considered (if applicable)

**Context**
- Links to issues, docs, or other references

**Changes**
- Bulleted list of what changed
- Screenshots for UI changes

**Verification**
- Acceptance testing steps: how a human can verify the feature works
- Expected user-facing behaviour

**Deployment**
- Risk level and deployment considerations
- Migration notes if applicable

**Rollback**
- **Never leave blank**
- How to safely revert if something breaks
- Feature flag toggles, revert safety, migration concerns

## Presenting the draft

Show the user:
1. Proposed PR title
2. Full PR body in a code block
3. Ask: "Does this look good, or would you like me to revise anything?"

Iterate until the user approves.

## Requesting reviewers

Before submitting, ask the user: "Who would you like to review this PR?"

The user may provide:
- GitHub usernames
- Team names (e.g., "platform team" -> `org/platform`)
- People's real names (look up their GitHub username)

If the user provides names you don't recognize, ask for clarification or search the repo's contributors/team members.

## Submitting the PR

```bash
# With reviewers
gh pr create --title "<title>" --body "<body>" --reviewer <users>

# As draft with reviewers
gh pr create --title "<title>" --body "<body>" --draft --reviewer <users>
```

After successful creation, `gh pr create` outputs the PR URL. Display this link to the user.

### Useful options

- `--draft`: Create as draft PR
- `--base <branch>`: Target branch (default: main/master)
- `--reviewer <users>`: Request reviewers (users or org/team)
- `--assignee <users>`: Assign users
- `--label <labels>`: Add labels
