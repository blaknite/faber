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

The pipeline is at [blaknite/faber](https://buildkite.com/blaknite/faber) on Buildkite. Every push runs tests. Merges to `main` also build and release platform binaries via GitHub Releases. See `.buildkite/pipeline.yml` for details.
