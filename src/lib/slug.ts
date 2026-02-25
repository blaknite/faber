import { randomBytes } from "node:crypto"

const MAX_PROMPT_CHARS = 40

export function generateSlug(prompt: string): string {
  const id = randomBytes(3).toString("hex") // 6 hex chars
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, MAX_PROMPT_CHARS)
    .replace(/-+$/, "")
  return `${id}-${slug}`
}
