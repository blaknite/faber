import fs from "node:fs"

export type AgentConfig = Partial<Record<'fast' | 'smart' | 'deep', string>>

const KNOWN_AGENT_TYPES = new Set(['fast', 'smart', 'deep'])

const DEFAULTS: Record<string, string> = {
  fast: 'anthropic/claude-haiku-4-5',
  smart: 'anthropic/claude-sonnet-4-6',
  deep: 'anthropic/claude-opus-4-6',
}

function loadFromPath(filePath: string): AgentConfig | null {
  if (!fs.existsSync(filePath)) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (err) {
    console.error(`Failed to load config from "${filePath}": ${(err as Error).message}`)
    process.exit(1)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {}
  }

  const result: AgentConfig = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!KNOWN_AGENT_TYPES.has(key)) {
      process.stderr.write(`Warning: unknown agent type "${key}" in config file "${filePath}"\n`)
      continue
    }
    if (typeof value === 'string') {
      result[key as 'fast' | 'smart' | 'deep'] = value
    }
  }
  return result
}

export function loadConfig(globalPath: string, projectPath: string): AgentConfig {
  const project = loadFromPath(projectPath)
  if (project !== null) return project

  const global = loadFromPath(globalPath)
  if (global !== null) return global

  return {}
}

export function getEffectiveModel(agentType: string, loadedConfig: AgentConfig): string {
  const configured = loadedConfig[agentType as keyof AgentConfig]
  if (typeof configured === 'string') return configured

  return DEFAULTS[agentType] ?? 'anthropic/claude-sonnet-4-6'
}
