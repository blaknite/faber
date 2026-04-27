import fs from "node:fs"
import { DEFAULT_MODELS, TIERS, type Tier } from "../types.js"

export type ModelConfig = Partial<Record<Tier, string>>

export interface AgentConfig {
  models?: ModelConfig
  cleanroom?: boolean
}

const KNOWN_AGENT_TYPES = new Set(['fast', 'smart', 'deep'])

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
  const record = parsed as Record<string, unknown>

  if (typeof record.cleanroom === 'boolean') {
    result.cleanroom = record.cleanroom
  }

  const modelsRaw = record.models
  if (typeof modelsRaw === 'object' && modelsRaw !== null && !Array.isArray(modelsRaw)) {
    const models: ModelConfig = {}
    for (const [key, value] of Object.entries(modelsRaw as Record<string, unknown>)) {
      if (!KNOWN_AGENT_TYPES.has(key)) {
        process.stderr.write(`Warning: unknown agent type "${key}" in config file "${filePath}"\n`)
        continue
      }
      if (typeof value === 'string') {
        models[key as Tier] = value
      }
    }
    result.models = models
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

export function modelForTier(tier: Tier, config: AgentConfig): string {
  return config.models?.[tier] ?? DEFAULT_MODELS[tier]
}

// If the user configures two tiers to the same model ID, the first tier in
// iteration order (fast, smart, deep) wins. This is acceptable ambiguity
// in user config.
export function tierForModel(modelId: string, config: AgentConfig): Tier | null {
  for (const tier of ['fast', 'smart', 'deep'] as const) {
    if (config.models?.[tier] === modelId) return tier
  }
  for (const tier of ['fast', 'smart', 'deep'] as const) {
    if (DEFAULT_MODELS[tier] === modelId) return tier
  }
  return null
}

export function getModelContextWindow(modelId: string, config: AgentConfig): number {
  const tier = tierForModel(modelId, config)
  if (tier) return TIERS[tier].contextWindow
  return 200000
}

export function cleanroomEnabled(config: AgentConfig): boolean {
  return config.cleanroom === true
}
