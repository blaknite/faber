import { useSpinnerFrame } from "../lib/tick.js"
import { BranchInput } from "./BranchInput.js"
import { RequestChangesInput } from "./RequestChangesInput.js"
import { StatusBar } from "./StatusBar.js"
import type { Task, Mode } from "../types.js"

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
  onRequestChangesSubmit: (prompt: string) => void
  onRequestChangesCancel: () => void
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
  onRequestChangesSubmit,
  onRequestChangesCancel,
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

  if (mode === "request_changes") {
    return <RequestChangesInput onSubmit={onRequestChangesSubmit} onCancel={onRequestChangesCancel} />
  }

  if (mode === "kill" && activeTask) {
    return <ConfirmPrompt message={`Kill ${activeTask.id}?`} />
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
