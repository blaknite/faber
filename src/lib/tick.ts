import { createContext, useContext, useEffect, useState } from "react"

// The global tick interval in milliseconds. All timed behaviour in the app is
// derived from multiples of this value so there is only ever one setInterval
// running regardless of how many components are mounted.
export const TICK_MS = 80

// Number of spinner frames -- kept here so components can compute the current
// frame without importing a separate constant.
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export interface TickContextValue {
  // Monotonically increasing counter, incremented once per TICK_MS.
  tick: number
}

export const TickContext = createContext<TickContextValue>({ tick: 0 })

// Returns the current tick count. Re-renders the component on every tick, so
// use sparingly -- prefer deriving values inside render rather than running
// extra effects.
export function useTick(): number {
  return useContext(TickContext).tick
}

// Convenience: current spinner frame derived from tick.
export function useSpinnerFrame(): string {
  const tick = useTick()
  return SPINNER_FRAMES[tick % SPINNER_FRAMES.length]!
}

// Hook for the provider component. Owns the single setInterval and exposes
// the tick value for the context.
export function useTickProvider(): TickContextValue {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS)
    return () => clearInterval(id)
  }, [])

  return { tick }
}
