import { useSpinnerFrame } from "../lib/tick.js"
import { ContinueInput } from "./ContinueInput.js"
import { StatusBar } from "./StatusBar.js"
import type { Task, Mode, Model } from "../types.js"
import type { FlashType } from "../lib/useAppState.js"

interface Binding {
  key: string
  label: string
  disabled?: boolean
}

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
  bindings: Binding[]
  onContinueSubmit: (prompt?: string, model?: Model) => void
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
    return <ContinueInput repoRoot={repoRoot} onSubmit={onContinueSubmit} onCancel={onContinueCancel} defaultModel={activeTask?.model} />
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
    return <ConfirmPrompt message={`Merge ${activeTask.id} into HEAD?`} />
  }

  if (mode === "push") {
    return <ConfirmPrompt message={`Push ${currentBranch} to origin?`} />
  }

  if (mode === "pushing") {
    return <PushingSpinner branch={currentBranch} />
  }

  return <StatusBar bindings={bindings} />
}
