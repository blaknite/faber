import { useEffect } from "react"
import { existsSync, statSync, watch } from "node:fs"
import type { FSWatcher } from "node:fs"

interface UseFileWatchOptions {
  // When true, polls at 500ms until the file appears before switching to
  // fs.watch. Use this when the file may not exist when the hook first mounts.
  pollUntilExists?: boolean
}

// Watches a file for changes and calls callback whenever it is written.
//
// Combines fs.watch with a 1-second watchdog interval. FSEvents on macOS can
// silently stop delivering notifications under high I/O, so the watchdog
// compares the file's current mtime against the mtime recorded at the last
// refresh. If they differ, it triggers the callback and recreates the watcher.
//
// When pollUntilExists is true the hook polls every 500ms until the file
// appears, then hands off to fs.watch + the watchdog. This covers cases where
// the file is created after the component mounts.
export function useFileWatch(
  path: string,
  callback: () => void,
  options?: UseFileWatchOptions,
): void {
  useEffect(() => {
    let watcher: FSWatcher | null = null
    let pollInterval: ReturnType<typeof setInterval> | null = null
    let lastRefreshedMtime = 0

    const doRefresh = () => {
      try {
        lastRefreshedMtime = existsSync(path) ? statSync(path).mtimeMs : 0
      } catch {
        lastRefreshedMtime = 0
      }
      callback()
    }

    const startWatching = () => {
      if (watcher) return
      try {
        watcher = watch(path, doRefresh)
        watcher.on("error", () => {
          watcher?.close()
          watcher = null
        })
      } catch {
        // watch() failed; the watchdog will retry
      }
    }

    if (options?.pollUntilExists && !existsSync(path)) {
      // File doesn't exist yet -- poll until it appears, then switch to watch
      pollInterval = setInterval(() => {
        doRefresh()
        if (existsSync(path)) {
          if (pollInterval) clearInterval(pollInterval)
          pollInterval = null
          startWatching()
        }
      }, 500)
    } else {
      startWatching()
    }

    const watchdog = setInterval(() => {
      if (!existsSync(path)) return

      let currentMtime = 0
      try {
        currentMtime = statSync(path).mtimeMs
      } catch {
        return
      }

      if (currentMtime > lastRefreshedMtime) {
        doRefresh()
        watcher?.close()
        watcher = null
        startWatching()
      }

      if (!watcher) startWatching()
    }, 1000)

    return () => {
      watcher?.close()
      if (pollInterval) clearInterval(pollInterval)
      clearInterval(watchdog)
    }
  }, [path, callback, options?.pollUntilExists])
}
