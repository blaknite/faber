import { execa } from "execa"
import { parseDiff } from "./lib/diff/parser.js"
import type { DiffLine } from "./lib/diff/parser.js"

function exit(code: number): never {
  process.exit(code)
}

const COMMENT_TARGETS_HELP = `Usage:
  faber agent comment-targets <number> <path> <line> [--window <n>]
  faber agent comment-targets <number> <path> --all

Arguments:
  <number>     PR number (positive integer)
  <path>       File path as it appears on the right side of the diff
  <line>       Approximate line number on the right side of the diff
  --window <n> Lines of context around <line> (default: 5)
  --all        Emit every right-side targetable line in <path>`

const AGENT_HELP = `Usage: faber agent <verb> [args]

Verbs:
  comment-targets   Print targetable line numbers from a PR diff

Run "faber agent <verb> --help" for help on a specific verb.`

export async function runAgentCommand(args: string[]): Promise<void> {
  const verb = args[0]

  if (!verb || verb === "--help" || verb === "-h") {
    if (!verb) {
      process.stderr.write("faber agent: verb required\n\n")
      process.stderr.write(AGENT_HELP + "\n")
      exit(1)
    }
    process.stdout.write(AGENT_HELP + "\n")
    exit(0)
  }

  if (verb === "comment-targets") {
    if (args.includes("--help") || args.includes("-h")) {
      process.stdout.write(COMMENT_TARGETS_HELP + "\n")
      exit(0)
    }
    await runCommentTargets(args.slice(1))
    return
  }

  process.stderr.write(`faber agent: unknown verb "${verb}"\n\n`)
  process.stderr.write(AGENT_HELP + "\n")
  exit(1)
}

async function runCommentTargets(args: string[]): Promise<void> {
  const positional: string[] = []
  let windowValue: string | null = null
  let allFlag = false

  let i = 0
  while (i < args.length) {
    const arg = args[i]!
    if (arg === "--window") {
      windowValue = args[i + 1] ?? null
      i += 2
    } else if (arg === "--all") {
      allFlag = true
      i++
    } else if (arg.startsWith("-")) {
      i++
    } else {
      positional.push(arg)
      i++
    }
  }

  const numberArg = positional[0]
  const pathArg = positional[1]
  const lineArg = positional[2]

  if (!numberArg) {
    process.stderr.write("faber agent comment-targets: <number> is required\n\n")
    process.stderr.write(COMMENT_TARGETS_HELP + "\n")
    exit(1)
  }

  const prNumber = parseInt(numberArg, 10)
  if (isNaN(prNumber) || String(prNumber) !== numberArg || prNumber <= 0) {
    process.stderr.write(`faber agent comment-targets: <number> must be a positive integer, got "${numberArg}"\n\n`)
    process.stderr.write(COMMENT_TARGETS_HELP + "\n")
    exit(1)
  }

  if (!pathArg) {
    process.stderr.write("faber agent comment-targets: <path> is required\n\n")
    process.stderr.write(COMMENT_TARGETS_HELP + "\n")
    exit(1)
  }

  if (lineArg && allFlag) {
    process.stderr.write("faber agent comment-targets: <line> and --all are mutually exclusive\n\n")
    process.stderr.write(COMMENT_TARGETS_HELP + "\n")
    exit(1)
  }

  if (!lineArg && !allFlag) {
    process.stderr.write("faber agent comment-targets: one of <line> or --all is required\n\n")
    process.stderr.write(COMMENT_TARGETS_HELP + "\n")
    exit(1)
  }

  let lineNum: number | null = null
  if (lineArg) {
    lineNum = parseInt(lineArg, 10)
    if (isNaN(lineNum) || String(lineNum) !== lineArg || lineNum <= 0) {
      process.stderr.write(`faber agent comment-targets: <line> must be a positive integer, got "${lineArg}"\n\n`)
      process.stderr.write(COMMENT_TARGETS_HELP + "\n")
      exit(1)
    }
  }

  let window = 5
  if (windowValue !== null) {
    if (lineArg === undefined) {
      process.stderr.write("faber agent comment-targets: --window is only valid with <line>\n\n")
      process.stderr.write(COMMENT_TARGETS_HELP + "\n")
      exit(1)
    }
    window = parseInt(windowValue, 10)
    if (isNaN(window) || String(window) !== windowValue || window <= 0) {
      process.stderr.write(`faber agent comment-targets: --window must be a positive integer, got "${windowValue}"\n\n`)
      process.stderr.write(COMMENT_TARGETS_HELP + "\n")
      exit(1)
    }
  }

  let repoSlug: string
  try {
    const { stdout } = await execa("gh", ["pr", "view", String(prNumber), "--json", "headRepository,headRepositoryOwner"])
    const meta = JSON.parse(stdout) as { headRepository: { name: string }; headRepositoryOwner: { login: string } }
    repoSlug = `${meta.headRepositoryOwner.login}/${meta.headRepository.name}`
  } catch (err: any) {
    process.stderr.write(`faber agent comment-targets: gh pr view failed: ${err.message ?? String(err)}\n`)
    exit(1)
  }

  let diffText: string
  try {
    const { stdout } = await execa("gh", ["pr", "diff", String(prNumber), "--repo", repoSlug])
    diffText = stdout
  } catch (err: any) {
    process.stderr.write(`faber agent comment-targets: gh pr diff failed: ${err.message ?? String(err)}\n`)
    exit(1)
  }

  const parsed = parseDiff(diffText)
  const file = parsed.files.find((f) => f.newPath === pathArg)

  if (!file) {
    exit(0)
  }

  const allLines: DiffLine[] = file.hunks.flatMap((h) => h.lines)

  let targetLines: DiffLine[]

  if (allFlag) {
    targetLines = allLines.filter((l) => l.type !== "remove" && l.newLineNum !== undefined)
  } else {
    const lo = lineNum! - window
    const hi = lineNum! + window
    targetLines = allLines.filter(
      (l) => l.type !== "remove" && l.newLineNum !== undefined && l.newLineNum >= lo && l.newLineNum <= hi,
    )
  }

  targetLines.sort((a, b) => a.newLineNum! - b.newLineNum!)

  for (const line of targetLines) {
    process.stdout.write(`${line.newLineNum}: ${line.content}\n`)
  }
}
