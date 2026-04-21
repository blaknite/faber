import { useCallback, useEffect, useState } from "react"
import type { CliRenderer } from "@opentui/core"
import { AgentList } from "./components/AgentList.js"
import { useAppState, sortDescending } from "./lib/useAppState.js"
import { ACTIVE_STATUSES } from "./types.js"
import { AgentLog } from "./components/AgentLog.js"
import { DiffView } from "./components/DiffView.js"
import { BottomBar } from "./components/BottomBar.js"
import { BranchSelector } from "./components/BranchSelector.js"
import { HeaderBar } from "./components/HeaderBar.js"
import { InterstitialView } from "./components/InterstitialView.js"
import { hasUnpushedCommits, gitHeadPath, gitFetchHeadPath, gitRefsHeadsPath, readCurrentBranch } from "./lib/worktree.js"
import { readState, stateFilePath } from "./lib/state.js"
import { useKeyboardRouter } from "./lib/useKeyboardRouter.js"
import { useFileWatch } from "./lib/useFileWatch.js"
import { useAppActions } from "./lib/useAppActions.js"
import { fetchLatestVersion } from "./lib/update.js"
import type { Task, Mode } from "./types.js"
import { TickProvider } from "./lib/tick.js"
import type { AgentConfig } from "./lib/config.js"


interface Props {
  repoRoot: string
  repoName: string
  version: string
  initialTasks: Task[]
  renderer: CliRenderer
  onExit: () => void
  loadedConfig: AgentConfig
}

function AppInner({ repoRoot, repoName, version, initialTasks, onExit, loadedConfig }: Props) {
  const {
    tasks,
    setTasks,
    filterMode,
    setFilterMode,
    selectedIdx,
    setSelectedIdx,
    flashMessage,
    flashType,
    paneTaskId,
    setPaneTaskId,
    paneView,
    setPaneView,
    currentBranch,
    setCurrentBranch,
    isDirty,
    setIsDirty,
    prevSelectedIdx,
    visibleTasks,
    selectedTask,
    paneTask,
    showFlash,
    mergeMessage,
    showMergeMessage,
    clearMergeMessage,
  } = useAppState(initialTasks)
  const [mode, setMode] = useState<Mode>("normal")

  const refreshTasks = useCallback(() => {
    const state = readState(repoRoot)
    setTasks(sortDescending(state.tasks))
  }, [repoRoot])

  const refreshDirtyState = useCallback(() => {
    hasUnpushedCommits(repoRoot).then(setIsDirty).catch(() => {})
  }, [repoRoot])

  // Bootstrap on mount
  useEffect(() => {
    setCurrentBranch(readCurrentBranch(repoRoot))
    refreshDirtyState()
  }, [repoRoot, refreshDirtyState])

  const [updateAvailable, setUpdateAvailable] = useState(false)
  useEffect(() => {
    // Skip the check in dev so it doesn't fire on every source run.
    if (version === "dev") return
    fetchLatestVersion().then((latest) => {
      if (latest && latest !== version) setUpdateAvailable(true)
    })
  }, [version])

  // Watch state.json for changes and refresh when it's written.
  useFileWatch(stateFilePath(repoRoot), refreshTasks)

  // Watch .git/HEAD for branch changes and read the branch name directly
  // from the file rather than spawning a subprocess.
  //
  // We also use HEAD changes as the trigger to retry attaching the FETCH_HEAD
  // watcher (see below). A branch switch is a reliable signal that git has
  // been active and FETCH_HEAD is likely to exist now.
  const [fetchHeadWatchKey, setFetchHeadWatchKey] = useState(0)
  const refreshBranchState = useCallback(() => {
    setCurrentBranch(readCurrentBranch(repoRoot))
    refreshDirtyState()
    setFetchHeadWatchKey(k => k + 1)
  }, [repoRoot, refreshDirtyState])
  useFileWatch(gitHeadPath(repoRoot), refreshBranchState)

  // Watch .git/refs/heads/ for branch ref changes. A fast-forward merge via
  // `git merge --ff-only` doesn't write to .git/HEAD -- it only advances the
  // branch ref tip, writing to .git/refs/heads/<baseBranch> or packed-refs.
  // So we need to watch this directory to detect when a merge completes.
  useFileWatch(gitRefsHeadsPath(repoRoot), refreshBranchState, { recursive: true })

  // Watch FETCH_HEAD so that pushing outside of Faber clears the dirty
  // indicator. Git rewrites FETCH_HEAD on every push and fetch, which is
  // more reliable than watching the per-branch remote ref (those can be
  // absorbed into packed-refs). FETCH_HEAD won't exist until the first push
  // in a fresh repo, so we retry the watcher each time HEAD changes rather
  // than polling.
  useFileWatch(gitFetchHeadPath(repoRoot), refreshDirtyState, { retryKey: fetchHeadWatchKey })

  const runningCount = tasks.filter(t => t.status === "running").length
  const readyCount = tasks.filter(t => t.status === "ready").length

  const {
    handleDispatch,
    handleKill,
    handleContinue,
    handleOpenLog,
    handleOpenDiff,
    openTaskView,
    handleSwitchBranch,
    handlePush,
    handleMerge,
    handleMarkDone,
    handleDelete,
  } = useAppActions({
    repoRoot,
    selectedTask,
    paneTask,
    currentBranch,
    paneTaskId,
    paneView,
    setMode,
    setSelectedIdx,
    setPaneTaskId,
    setPaneView,
    prevSelectedIdx,
    refreshDirtyState,
    showFlash,
    showMergeMessage,
    loadedConfig,
  })

  const bindings = useKeyboardRouter({
    mode,
    setMode,
    paneTaskId,
    setPaneTaskId,
    paneView,
    setPaneView,
    paneTask,
    selectedTask,
    selectedIdx,
    setSelectedIdx,
    tasks,
    visibleTasks,
    isDirty,
    mergeMessage,
    clearMergeMessage,
    prevSelectedIdx,
    handleKill,
    handleMerge,
    handleMarkDone,
    handleDelete,
    handlePush,
    handleContinue,
    handleOpenLog,
    handleOpenDiff,
    openTaskView,
    onExit,
  })

  return (
    <box style={{ flexDirection: "column", height: "100%", backgroundColor: "#000000" }}>
      <HeaderBar
        repoName={repoName}
        currentBranch={currentBranch}
        isDirty={isDirty}
        runningCount={runningCount}
        readyCount={readyCount}
      />

      <box style={{ flexGrow: 1 }}>
        {mergeMessage ? (
          <InterstitialView message={mergeMessage} />
        ) : paneTaskId && paneView === "diff" ? (() => {
          const diffTask = tasks.find((t) => t.id === paneTaskId) ?? null
          return diffTask ? (
            <DiffView
              repoRoot={repoRoot}
              task={diffTask}
              disabled={mode === "continue" || mode === "switch_branch"}
            />
          ) : null
        })() : paneTaskId && paneView === "log" ? (() => {
          const logTask = tasks.find((t) => t.id === paneTaskId) ?? null
          return logTask ? (
            <AgentLog
              repoRoot={repoRoot}
              task={logTask}
              disabled={mode === "continue" || mode === "switch_branch"}
            />
          ) : null
        })() : (
          <AgentList
            repoRoot={repoRoot}
            tasks={visibleTasks}
            selectedId={selectedTask?.id ?? null}
            filterMode={filterMode}
            onFilterChange={setFilterMode}
            updateAvailable={updateAvailable}
            inputActive={mode === "input"}
            currentBranch={currentBranch}
            onActivate={() => { prevSelectedIdx.current = selectedIdx; setMode("input"); setSelectedIdx(-1) }}
            onSubmit={(prompt, model) => handleDispatch(prompt, model)}
            onCancel={() => { setMode("normal"); setSelectedIdx(prevSelectedIdx.current) }}
            onSelectTask={(id) => {
              const idx = visibleTasks.findIndex((t) => t.id === id)
              if (idx !== -1) setSelectedIdx(idx)
            }}
            onOpenTask={(id) => {
              const task = visibleTasks.find((t) => t.id === id)
              if (task) openTaskView(task)
            }}
          />
        )}
      </box>

      {!mergeMessage && (
        <BottomBar
          repoRoot={repoRoot}
          mode={mode}
          flashMessage={flashMessage}
          flashType={flashType}
          paneTask={paneTask}
          selectedTask={selectedTask}
          currentBranch={currentBranch}
          bindings={bindings}
          onContinueSubmit={(prompt, model) => handleContinue(prompt, model)}
          onContinueCancel={() => setMode("normal")}
        />
      )}

      {mode === "switch_branch" && (
        <BranchSelector
          repoRoot={repoRoot}
          tasks={tasks}
          currentBranch={currentBranch}
          onSwitch={(branch) => handleSwitchBranch(branch)}
          onCancel={() => setMode("normal")}
        />
      )}
    </box>
  )
}

export function App(props: Props) {
  return (
    <TickProvider>
      <AppInner {...props} />
    </TickProvider>
  )
}
