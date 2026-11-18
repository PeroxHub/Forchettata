import { History } from 'lucide-react'
import { useGame } from '../game/context'
import { ResultBars } from '../components/RoundParts'
import { Notice } from '../components/ui'
import { formatLongYear, formatShort } from '../lib/dates'
import { fmtMean, fmtNum, plural } from '../lib/format'

export function HistoryPage() {
  const { state, name, round } = useGame()
  const closed = state.rounds.filter((r) => r.status === 'closed')
  const promoted = closed.filter((r) => r.outcome === 'promoted').length

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 4 }}>
        <h1>Storico</h1>
        <p className="muted">
          {closed.length === 0
            ? 'Ancora nessuna cena giudicata.'
            : `${plural(closed.length, 'cena giudicata', 'cene giudicate')}: ${promoted} promoss${promoted === 1 ? 'a' : 'e'}, ${closed.length - promoted} bocciat${closed.length - promoted === 1 ? 'a' : 'e'}.`}
        </p>
      </div>

      {round && (
        <div className="card history-item">
          <div className="round-num">{round.number}</div>
          <div>
            <b>{round.place_name ?? 'Locale non ancora estratto'}</b>
            <div className="small muted">
              In corso ·{' '}
              {round.status === 'proposals'
                ? 'si raccolgono le proposte'
                : round.dinner_date
                  ? `cena ${formatShort(round.dinner_date)}`
                  : 'data da fissare'}
            </div>
          </div>
          <span className="badge accent">in corso</span>
        </div>
      )}

      {closed.length === 0 && (
        <Notice icon={<History size={18} />}>Qui compariranno tutti i giri chiusi, con le medie e chi li ha proposti.</Notice>
      )}

      {closed.map((r) => {
        const ok = r.outcome === 'promoted'
        return (
          <details key={r.id} className={`card disclosure-card tone-${ok ? 'ok' : 'bad'}`} style={{ background: 'var(--surface)' }}>
            <summary className="history-item" style={{ cursor: 'pointer', listStyle: 'none' }}>
              <div className="round-num">{r.number}</div>
              <div style={{ minWidth: 0 }}>
                <b style={{ wordBreak: 'break-word' }}>{r.place_name}</b>
                <div className="small muted">
                  {r.dinner_date ? formatLongYear(r.dinner_date) : r.closed_at ? formatLongYear(r.closed_at.slice(0, 10)) : ''}
                  {' · '}
                  {r.proposer_id ? `proposto da ${name(r.proposer_id)}` : 'proponente anonimo'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className={`mean ${ok ? 'ok' : 'bad'}`}>{fmtMean(r.final_mean)}</div>
                <span className={`badge ${ok ? 'ok' : 'bad'}`}>{ok ? 'promosso' : 'bocciato'}</span>
              </div>
            </summary>
            <div className="stack" style={{ marginTop: 16 }}>
              <ResultBars round={r} />
              <p className="small muted">
                {plural(r.results?.voters ?? 0, 'voto', 'voti')} · target {r.rules.target_mode === 'gte' ? '≥' : '>'}{' '}
                {fmtNum(r.rules.target)}
                {r.results?.criteria.some((c) => c.trimmed) && ' · scartati il voto più alto e il più basso'}
                {ok && r.rules.prize && ` · premio: ${r.rules.prize}`}
              </p>
            </div>
          </details>
        )
      })}
    </div>
  )
}
