import { randomBytes } from "node:crypto"

const MAX_PROMPT_CHARS = 40

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, MAX_PROMPT_CHARS)
    .replace(/-+$/, "")
}

export function generateSlug(prompt: string, name?: string): string {
  const id = randomBytes(3).toString("hex") // 6 hex chars

  if (name !== undefined) {
    const suffix = slugify(name)
    if (suffix === "") {
      throw new Error("--name must contain at least one alphanumeric character.")
    }
    return `${id}-${suffix}`
  }

  const slug = slugify(prompt)
  return `${id}-${slug}`
}
