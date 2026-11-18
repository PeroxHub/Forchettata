import { Info } from 'lucide-react'
import { useGame } from '../game/context'
import { GroupAvailabilityCard, MyAvailability } from '../components/Availability'
import { DrawnCard, MyEnvelope, phaseIndex, Stepper, UrnCard, VerdictCard, VoteCard } from '../components/RoundParts'
import { Notice } from '../components/ui'
import { fmtNum } from '../lib/format'
import { formatShort } from '../lib/dates'

export function RoundPage({ goRules }: { goRules: () => void }) {
  const { state, round, cur } = useGame()
  if (!round || !cur) {
    return <Notice icon={<Info size={18} />}>Nessun giro aperto in questo momento.</Notice>
  }
  const lastClosed = state.rounds.find((r) => r.status === 'closed')
  const showVerdict = lastClosed && round.status === 'proposals'
  const phase = phaseIndex(round, cur.voting_open)
  const r = round.rules
  const myPenalty = state.my_penalties.find((p) => round.number >= p.from_number && round.number <= p.to_number)

  return (
    <div className="stack-lg">
      <div className="hero">
        <div className="hero-title">
          <h1>Giro {round.number}</h1>
          <span className="muted">
            {round.status === 'proposals'
              ? `aperto ${formatShort(round.opened_at.slice(0, 10))}`
              : round.dinner_date
                ? `cena ${formatShort(round.dinner_date)}`
                : 'data da fissare'}
          </span>
        </div>
        <Stepper index={phase} />
        <p className="small muted">
          Target: media {r.target_mode === 'gte' ? 'almeno' : 'superiore a'} <b>{fmtNum(r.target)}</b>
          {r.prize && (
            <>
              {' '}
              · premio: <b>{r.prize}</b>
            </>
          )}{' '}
          ·{' '}
          <button className="btn ghost small" style={{ minHeight: 0, padding: '0 4px', color: 'var(--accent)' }} onClick={goRules}>
            tutte le regole
          </button>
        </p>
      </div>

      {showVerdict && (
        <VerdictCard
          round={lastClosed}
          title={lastClosed.outcome === 'promoted' ? 'Ultimo verdetto: promosso!' : 'Ultimo verdetto: bocciato'}
        />
      )}

      {myPenalty?.kind === 'no_vote' && round.status !== 'closed' && (
        <Notice tone="bad">
          Il tuo ultimo posto è stato bocciato: in questo giro non voti, ma proponi e segni la disponibilità come tutti.
        </Notice>
      )}

      {round.status === 'proposals' && (
        <>
          <MyEnvelope round={round} />
          <UrnCard round={round} />
          <MyAvailability round={round} />
          <GroupAvailabilityCard round={round} />
        </>
      )}

      {round.status === 'drawn' && (
        <>
          <DrawnCard round={round} />
          <VoteCard round={round} />
          <GroupAvailabilityCard round={round} />
          <details className="disclosure card">
            <summary>Modifica la tua disponibilità</summary>
            <div style={{ marginTop: 14 }}>
              <MyAvailability round={round} compact />
            </div>
          </details>
        </>
      )}
    </div>
  )
}
