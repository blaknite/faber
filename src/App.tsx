import { useCallback, useEffect, useState } from "react"
import type { CliRenderer } from "@opentui/core"
import { AgentList, ACTIVE_STATUSES } from "./components/AgentList.js"
import { useAppState, sortDescending } from "./lib/useAppState.js"
import { AgentLog } from "./components/AgentLog.js"
import { DiffView } from "./components/DiffView.js"
import { BottomBar } from "./components/BottomBar.js"
import { HeaderBar } from "./components/HeaderBar.js"
import { MergeSuccessView } from "./components/MergeSuccessView.js"
import { killAgent } from "./lib/agent.js"
import { removeWorktree, hasUnpushedCommits, gitHeadPath, gitFetchHeadPath, readCurrentBranch } from "./lib/worktree.js"
import { readState, stateFilePath } from "./lib/state.js"
import { useKeyboardRouter } from "./lib/useKeyboardRouter.js"
import { useFileWatch } from "./lib/useFileWatch.js"
import { useAppActions } from "./lib/useAppActions.js"
import type { Task, Mode } from "./types.js"
import { TickProvider } from "./lib/tick.js"


interface Props {
  repoRoot: string
  repoName: string
  initialTasks: Task[]
  renderer: CliRenderer
  onExit: () => void
}

function AppInner({ repoRoot, repoName, initialTasks, onExit }: Props) {
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
    removeTaskFromState,
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
  })

  useKeyboardRouter({
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
    repoRoot,
    mergeMessage,
    prevSelectedIdx,
    handleKill,
    handleMerge,
    handleMarkDone,
    handlePush,
    handleContinue,
    handleOpenLog,
    handleOpenDiff,
    openTaskView,
    removeTaskFromState,
    onExit,
  })

  const activeTaskCount = tasks.filter(t => ACTIVE_STATUSES.includes(t.status)).length
  const normalBindings = paneTaskId && paneView === "diff" ? [
    { key: "q", label: "back to list" },
    { key: "l", label: "back to log", disabled: !paneTask },
    { key: "↑↓", label: "scroll" },
    { key: "</>", label: "prev/next", hidden: activeTaskCount < 2 || !paneTask || !ACTIVE_STATUSES.includes(paneTask.status) },
    { key: "c", label: "continue", disabled: !paneTask?.sessionId || paneTask?.status === "running" },
    { key: "m", label: "merge into HEAD", disabled: !paneTask },
    { key: "x", label: "done", disabled: !paneTask || paneTask.status !== "ready" },
    { key: "d", label: "delete", disabled: !paneTask },
  ] : paneTaskId && paneView === "log" ? [
    { key: "q", label: "back to list" },
    { key: "↑↓", label: "scroll" },
    { key: "</>", label: "prev/next", hidden: activeTaskCount < 2 || !paneTask || !ACTIVE_STATUSES.includes(paneTask.status) },
    { key: "s", label: "stop", disabled: !paneTask || paneTask.status !== "running" || !paneTask.pid },
    { key: "f", label: "diff", disabled: !paneTask || paneTask.status !== "ready" || !paneTask.hasCommits },
    { key: "c", label: "continue", disabled: !paneTask?.sessionId || paneTask?.status === "running" },
    { key: "x", label: "done", disabled: !paneTask || paneTask.status !== "ready" },
    { key: "d", label: "delete", disabled: !paneTask },
  ] : [
    { key: "q", label: "quit" },
    { key: "n", label: "new task" },
    { key: "↑↓", label: "select", disabled: tasks.length === 0 },
    { key: "enter", label: "open", disabled: !selectedTask },
    { key: "s", label: "stop", disabled: !selectedTask || selectedTask.status !== "running" || !selectedTask.pid },
    { key: "c", label: "continue", disabled: !selectedTask?.sessionId || selectedTask?.status === "running" },
    { key: "x", label: "done", disabled: !selectedTask || selectedTask.status !== "ready" },
    { key: "d", label: "delete", disabled: !selectedTask },
    { key: "b", label: "switch branch", disabled: !selectedTask },
    { key: "p", label: "push", disabled: !isDirty },
  ]

  if (mergeMessage) {
    return <MergeSuccessView message={mergeMessage} />
  }

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
        {paneTaskId && paneView === "diff" ? (() => {
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
            tasks={visibleTasks}
            selectedId={selectedTask?.id ?? null}
            filterMode={filterMode}
            onFilterChange={setFilterMode}
            inputActive={mode === "input" || mode === "continue" || mode === "switch_branch"}
            onSubmit={(prompt, model) => handleDispatch(prompt, model)}
            onCancel={() => { setMode("normal"); setSelectedIdx(prevSelectedIdx.current) }}
            onSelectTask={(id) => {
              const idx = visibleTasks.findIndex((t) => t.id === id)
              if (idx !== -1) setSelectedIdx(idx)
            }}
          />
        )}
      </box>

      <BottomBar
        mode={mode}
        flashMessage={flashMessage}
        flashType={flashType}
        paneTask={paneTask}
        selectedTask={selectedTask}
        currentBranch={currentBranch}
        bindings={normalBindings}
        onBranchSubmit={(branch) => handleSwitchBranch(branch)}
        onBranchCancel={() => setMode("normal")}
        onContinueSubmit={(prompt, model) => handleContinue(prompt, model)}
        onContinueCancel={() => setMode("normal")}
      />
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
