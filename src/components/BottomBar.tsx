import { useSpinnerFrame } from "../lib/tick.js"
import { ContinueInput } from "./ContinueInput.js"
import { StatusBar } from "./StatusBar.js"
import type { Task, Mode, Tier } from "../types.js"
import { DEFAULT_TIER } from "../types.js"
import type { AgentConfig } from "../lib/config.js"
import { tierForModel } from "../lib/config.js"
import type { FlashType } from "../lib/useAppState.js"
import type { KeyBinding } from "../lib/useKeyboardRouter.js"

interface ConfirmPromptProps {
  message: string
}

function ConfirmPrompt({ message }: ConfirmPromptProps) {
  return (
    <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222" }}>
      <text><strong>{message}</strong>{` [y/n]`}</text>
    </box>
  )
}

function PushingSpinner({ branch }: { branch: string }) {
  const frame = useSpinnerFrame()
  return (
    <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222" }}>
      <text fg="white">{frame}{` Pushing ${branch} to origin...`}</text>
    </box>
  )
}

interface Props {
  repoRoot: string
  mode: Mode
  flashMessage: string | null
  flashType: FlashType | null
  paneTask: Task | null
  selectedTask: Task | null
  currentBranch: string
  bindings: KeyBinding[]
  loadedConfig: AgentConfig
  onContinueSubmit: (prompt?: string, tier?: Tier) => void
  onContinueCancel: () => void
}

export function BottomBar({
  repoRoot,
  mode,
  flashMessage,
  flashType,
  paneTask,
  selectedTask,
  currentBranch,
  bindings,
  loadedConfig,
  onContinueSubmit,
  onContinueCancel,
}: Props) {
  const activeTask = paneTask ?? selectedTask

  if (flashMessage) {
    const flashColor = flashType === "error" ? "#ff4444" : "#ffffff"
    return (
      <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222" }}>
        <text fg={flashColor}>{flashMessage}</text>
      </box>
    )
  }

  if (mode === "continue") {
    const defaultTier = activeTask?.model
      ? (tierForModel(activeTask.model, loadedConfig) ?? DEFAULT_TIER)
      : DEFAULT_TIER
    return <ContinueInput repoRoot={repoRoot} onSubmit={onContinueSubmit} onCancel={onContinueCancel} defaultTier={defaultTier} />
  }

  if (mode === "kill" && activeTask) {
    return <ConfirmPrompt message={`Stop ${activeTask.id}?`} />
  }

  if (mode === "delete" && activeTask) {
    return <ConfirmPrompt message={`Delete ${activeTask.id}?`} />
  }

  if (mode === "done" && activeTask) {
    return <ConfirmPrompt message={`Mark ${activeTask.id} as done?`} />
  }

  if (mode === "merge" && activeTask) {
    return <ConfirmPrompt message={`Merge ${activeTask.id} into ${activeTask.baseBranch || currentBranch}?`} />
  }

  if (mode === "push") {
    return <ConfirmPrompt message={`Push ${currentBranch} to origin?`} />
  }

  if (mode === "pushing") {
    return <PushingSpinner branch={currentBranch} />
  }

  return <StatusBar bindings={bindings} />
}
