import { ProgressBar } from '../../ide/ui/Feedback'
import { useTasks } from '../../ide/workbench/tasks'

/** The running update's progress in its balloon. */
export function UpdateBalloonBody({ task }: { task: string }) {
  const current = useTasks((s) => s.tasks.find((t) => t.id === task))
  if (!current || current.done) return null
  return (
    <>
      {current.message && <div>{current.message}</div>}
      <ProgressBar value={current.fraction} aria-label={current.title} />
    </>
  )
}
