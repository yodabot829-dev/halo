import { useState } from 'react'
import { Actions } from './Actions'
import { useBoard } from './useBoard'
import type { RunSummary } from './useActions'

function until(iso: string | null): string {
  if (!iso) return ''
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60_000)
  if (mins < 60) return `in ${mins}m`
  if (mins < 1440) return `in ${Math.round(mins / 60)}h`
  return `in ${Math.round(mins / 1440)}d`
}

function ApprovalCard({
  run,
  onApprove,
  onReject,
}: {
  run: RunSummary
  onApprove: () => void
  onReject: (feedback: string) => void
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="approval-card">
      <div className="run-head" onClick={() => setOpen((o) => !o)}>
        <span className="goal-dot status-running" />
        <span className="run-name">{run.action}</span>
        <span className="detail-sub">draft awaiting your approval</span>
        <span className="approval-buttons">
          <button className="approve" onClick={(e) => (e.stopPropagation(), onApprove())}>
            Approve
          </button>
          <button
            className="ghost"
            onClick={(e) => {
              e.stopPropagation()
              const feedback = window.prompt('Why reject? (fed back into the next draft)')
              if (feedback) onReject(feedback)
            }}
          >
            Reject
          </button>
        </span>
      </div>
      {open && <pre className="goal-log">{run.output.slice(0, 4000)}</pre>}
    </div>
  )
}

export function Board() {
  const { board, error, approve, reject } = useBoard()

  return (
    <div className="actions">
      {error && <div className="error">{error}</div>}

      {board && board.awaiting.length > 0 && (
        <>
          <h2>Awaiting your approval</h2>
          {board.awaiting.map((run) => (
            <ApprovalCard
              key={run.id}
              run={run}
              onApprove={() => void approve(run.action, run.id)}
              onReject={(feedback) => void reject(run.action, run.id, feedback)}
            />
          ))}
        </>
      )}

      {board && (board.runningActions.length > 0 || board.runningGoals.length > 0) && (
        <>
          <h2>Running now</h2>
          <div className="running-strip">
            {board.runningActions.map((name) => (
              <span key={name} className="chip live-chip">
                ▶ {name}
              </span>
            ))}
            {board.runningGoals.map((g) => (
              <span key={g.id} className="chip live-chip">
                ◎ {g.title} ({g.project})
              </span>
            ))}
          </div>
        </>
      )}

      <Actions />

      {board && board.routines.length > 0 && (
        <>
          <h2>Routines</h2>
          <div className="routines">
            {board.routines.map((r) => (
              <span key={r.name} className="chip">
                ⏱ {r.name} · {r.schedule} · {until(r.nextRun)}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
