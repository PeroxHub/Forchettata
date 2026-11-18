import { Activity as ActivityIcon, CalendarCheck, Dices, Flag, KeyRound, Settings2, Undo2, UserMinus, UserPlus, Vote } from 'lucide-react'
import type { ReactNode } from 'react'
import { useGame } from '../game/context'
import { formatLong, formatStamp } from '../lib/dates'
import { fmtMean } from '../lib/format'
import { describeChange } from '../lib/rules'
import type { Activity } from '../lib/types'

function describe(a: Activity, name: (id: string | null | undefined) => string): { icon: ReactNode; text: ReactNode; extra?: ReactNode } {
  const who = <b>{a.user_id ? name(a.user_id) : 'L’app'}</b>
  const d = a.details ?? {}
  switch (a.kind) {
    case 'joined':
      return {
        icon: <UserPlus size={15} />,
        text: (
          <>
            {who} {d.rejoined ? 'è rientrato nel gruppo' : d.first ? 'ha creato il gruppo ed è l’organizzatore' : 'è entrato nel gruppo'}
          </>
        ),
      }
    case 'round_opened':
      return { icon: <Flag size={15} />, text: <>Si apre il giro {d.round_number}</> }
    case 'drawn':
      return {
        icon: <Dices size={15} />,
        text: (
          <>
            {who} ha sorteggiato il giro {d.round_number}: <b>{d.place_name}</b>
            {d.envelopes ? <span className="muted"> (tra {d.envelopes} buste)</span> : null}
          </>
        ),
      }
    case 'draw_undone':
      return {
        icon: <Undo2 size={15} />,
        text: (
          <>
            {who} ha annullato il sorteggio del giro {d.round_number} ({d.place_name}, {d.discarded ? 'scartato' : 'rimesso nell’urna'})
          </>
        ),
      }
    case 'date_set':
      return {
        icon: <CalendarCheck size={15} />,
        text: d.date ? (
          <>
            {who} ha fissato la cena del giro {d.round_number}: {formatLong(d.date)}
          </>
        ) : (
          <>
            {who} ha tolto la data della cena del giro {d.round_number}
          </>
        ),
      }
    case 'voting_opened':
      return {
        icon: <Vote size={15} />,
        text: (
          <>
            {who} ha aperto il voto del giro {d.round_number}
          </>
        ),
      }
    case 'round_closed':
      return {
        icon: <Flag size={15} />,
        text: (
          <>
            Giro {d.round_number} chiuso {d.auto ? 'in automatico' : <>da {who}</>}: <b>{d.place_name}</b> {fmtMean(d.mean)},{' '}
            {d.outcome === 'promoted' ? 'promosso' : 'bocciato'}
          </>
        ),
      }
    case 'rules_changed': {
      const changes = Object.entries((d.changes ?? {}) as Record<string, { from: unknown; to: unknown }>)
      return {
        icon: <Settings2 size={15} />,
        text: (
          <>
            {who} ha cambiato le regole{' '}
            <span className="muted">
              {changes.length === 1 && changes[0][0] === 'name'
                ? ''
                : d.applied_to_current
                  ? `(valgono già per il giro ${d.round_number})`
                  : `(valgono dal giro ${(d.round_number ?? 0) + 1})`}
            </span>
          </>
        ),
        extra: (
          <ul className="log-changes small">
            {changes.map(([k, v]) => (
              <li key={k}>{describeChange(k, v.from, v.to)}</li>
            ))}
          </ul>
        ),
      }
    }
    case 'role_changed':
      return {
        icon: <KeyRound size={15} />,
        text:
          d.role === 'admin' ? (
            <>
              {who} ha nominato organizzatore <b>{name(d.member_id)}</b>
            </>
          ) : (
            <>
              {who} ha tolto il ruolo di organizzatore a <b>{name(d.member_id)}</b>
            </>
          ),
      }
    case 'member_removed':
      return {
        icon: <UserMinus size={15} />,
        text: (
          <>
            {who} ha tolto <b>{name(d.member_id)}</b> dal gruppo
          </>
        ),
      }
    case 'invite_regenerated':
      return { icon: <KeyRound size={15} />, text: <>{who} ha creato un nuovo link d’invito (quello vecchio non vale più)</> }
    default:
      return { icon: <ActivityIcon size={15} />, text: <>{a.kind}</> }
  }
}

export function ActivityList({ filter, limit = 40 }: { filter?: (a: Activity) => boolean; limit?: number }) {
  const { state, name } = useGame()
  const items = state.activity.filter(filter ?? (() => true)).slice(0, limit)
  if (!items.length) return <p className="muted small">Ancora niente da mostrare.</p>
  return (
    <div>
      {items.map((a) => {
        const x = describe(a, name)
        return (
          <div key={a.id} className="log-item">
            <div className="log-dot">{x.icon}</div>
            <div className="grow">
              <div>{x.text}</div>
              {x.extra}
              <div className="tiny muted">{formatStamp(a.at)}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
