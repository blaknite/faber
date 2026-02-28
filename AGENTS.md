# faber

A terminal UI for running multiple autonomous coding agents in parallel. Each task gets its own isolated git worktree at `.worktrees/<task-slug>` with an opencode agent running inside it. State persists to `.faber/state.json`, so you can close and reopen without losing track of what's running.

The codebase is TypeScript/JSX, built and tested with Bun. The UI uses `@opentui/react`, a React 19 renderer that targets terminal output rather than the browser.

## Development

```bash
bun install
bun run dev       # run from source
bun run build     # compile to dist/
bun run build:bin # compile to a standalone binary
```

## Testing

Tests live alongside source files as `*.test.ts` files. Run them with:

```bash
bun test
```

## CI/CD

The pipeline is at [blaknite/faber](https://buildkite.com/blaknite/faber) on Buildkite. All steps run inside `oven/bun:latest`.

Every push runs the **Test** step: `bun install --frozen-lockfile && bun test`. That's the only gate on feature branches.

On `main`, after tests pass, the pipeline continues:

1. **Set version** -- generates a `YYYYMMDD.<build-number>` version string and stores it as Buildkite metadata.
2. **Build** -- compiles four platform binaries in parallel: `faber-darwin-arm64`, `faber-darwin-x64`, `faber-linux-x64`, `faber-linux-arm64`. Each is uploaded as a Buildkite artifact.
3. **Release** -- downloads all four artifacts and publishes a GitHub Release tagged `v<version>` with the binaries attached.
