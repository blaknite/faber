import { useEffect } from "react"
import { existsSync, statSync, watch } from "node:fs"
import type { FSWatcher } from "node:fs"

interface UseFileWatchOptions {
  // When true, polls at 500ms until the file appears before switching to
  // fs.watch. Use this when the file may not exist when the hook first mounts.
  pollUntilExists?: boolean
  // Incrementing this number tears down and restarts the watcher. Use it to
  // retry attaching to a file that may not have existed on the previous attempt.
  retryKey?: number
  // When true, watches the path recursively so changes to files anywhere within
  // the directory tree trigger the callback. Only meaningful when path is a
  // directory. The mtime-based watchdog is disabled in this mode because a
  // directory's mtime only reflects direct-child changes, not nested ones.
  recursive?: boolean
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
//
// When retryKey increments the effect restarts, attempting to attach the
// watcher again. Use this instead of pollUntilExists when an external event
// (e.g. HEAD changing) is a reliable signal that the file may now exist.
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

    const recursive = options?.recursive ?? false

    const startWatching = () => {
      if (watcher) return
      try {
        watcher = watch(path, { recursive }, doRefresh)
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

      // When watching recursively, directory mtime only reflects direct-child
      // changes, not nested file creation/deletion, so we skip the mtime check
      // and only use the watchdog to restart a dead watcher.
      if (!recursive) {
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
      }

      if (!watcher) startWatching()
    }, 1000)

    return () => {
      watcher?.close()
      if (pollInterval) clearInterval(pollInterval)
      clearInterval(watchdog)
    }
  }, [path, callback, options?.pollUntilExists, options?.retryKey, options?.recursive])
}
