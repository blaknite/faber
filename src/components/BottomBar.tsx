import { useSpinnerFrame } from "../lib/tick.js"
import { BranchInput } from "./BranchInput.js"
import { ContinueInput } from "./ContinueInput.js"
import { StatusBar } from "./StatusBar.js"
import type { Task, Mode, Model } from "../types.js"

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
      <text fg="#00aaff">{frame}{` Pushing ${branch} to origin...`}</text>
    </box>
  )
}

interface Props {
  mode: Mode
  flashMessage: string | null
  paneTask: Task | null
  selectedTask: Task | null
  currentBranch: string
  bindings: Binding[]
  onBranchSubmit: (branch: string) => void
  onBranchCancel: () => void
  onContinueSubmit: (prompt?: string, model?: Model) => void
  onContinueCancel: () => void
}

export function BottomBar({
  mode,
  flashMessage,
  paneTask,
  selectedTask,
  currentBranch,
  bindings,
  onBranchSubmit,
  onBranchCancel,
  onContinueSubmit,
  onContinueCancel,
}: Props) {
  const activeTask = paneTask ?? selectedTask

  if (flashMessage) {
    return (
      <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: "#222222" }}>
        <text fg="#ff8800">{flashMessage}</text>
      </box>
    )
  }

  if (mode === "switch_branch") {
    return <BranchInput onSubmit={onBranchSubmit} onCancel={onBranchCancel} />
  }

  if (mode === "continue") {
    return <ContinueInput onSubmit={onContinueSubmit} onCancel={onContinueCancel} defaultModel={activeTask?.model} />
  }

  if (mode === "kill" && activeTask) {
    return <ConfirmPrompt message={`Stop ${activeTask.id}?`} />
  }

  if (mode === "delete" && activeTask) {
    return <ConfirmPrompt message={`Delete ${activeTask.id}?`} />
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
