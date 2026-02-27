export const KEY_BINDINGS = [
  { name: "return", action: "submit" as const },
  { name: "return", shift: true, action: "newline" as const },
  { name: "return", ctrl: true, action: "newline" as const },
  { name: "return", meta: true, action: "newline" as const },
  { name: "j", ctrl: true, action: "newline" as const },
]

export const MIN_LINES = 1
export const MAX_LINES = 6
