import { useEffect, useState } from 'react'
import { Award, CalendarClock, Dices, EyeOff, Lock, Mail, MapPin, Pencil, Trash2, Undo2, Vote as VoteIcon, XCircle } from 'lucide-react'
import { Card, Linkify, Modal, Notice } from './ui'
import { useGame } from '../game/context'
import { addDays, formatLong, formatShort, relativeDay } from '../lib/dates'
import { scaleValues, voteMean } from '../lib/game'
import { fmtMean, fmtNum, listIt, plural } from '../lib/format'
import { myPenaltyText } from '../lib/rules'
import type { Proposal, Round, Rules, Scores } from '../lib/types'

/* ------------------------------------------------------------------ */
/*  Fasi                                                                */
/* ------------------------------------------------------------------ */

export function phaseIndex(round: Round, votingOpen: boolean) {
  if (round.status === 'proposals') return 0
  if (round.status === 'drawn') return votingOpen ? 2 : 1
  return 3
}

export function Stepper({ index }: { index: number }) {
  const steps = ['Proposte', 'Sorteggio e data', 'Cena e voto', 'Verdetto']
  return (
    <div className="stepper" aria-label={`Fase: ${steps[index]}`}>
      {steps.map((s, i) => (
        <div key={s} className={`step ${i < index ? 'done' : ''} ${i === index ? 'now' : ''}`}>
          {s}
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  La mia busta                                                        */
/* ------------------------------------------------------------------ */

function ProposalForm({
  initial,
  onSave,
  onCancel,
  submitLabel,
}: {
  initial?: Proposal
  onSave: (place: string, notes: string) => Promise<boolean | undefined>
  onCancel?: () => void
  submitLabel: string
}) {
  const { busy } = useGame()
  const [place, setPlace] = useState(initial?.place_name ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!place.trim()) return
        const ok = await onSave(place, notes)
        if (ok && !initial) {
          setPlace('')
          setNotes('')
        }
      }}
    >
      <label className="field">
        <span>Nome del locale</span>
        <input
          className="input"
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          maxLength={120}
          placeholder="Es. Trattoria da Mario"
          required
        />
      </label>
      <label className="field">
        <span>
          Note{' '}
          <span className="muted" style={{ fontWeight: 400 }}>
            (facoltative)
          </span>
        </span>
        <textarea
          className="input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          placeholder="Indirizzo, link, cosa ordinare…"
          rows={2}
        />
        <small>Le note diventano visibili a tutti solo se il tuo locale viene estratto.</small>
      </label>
      <div className="row">
        <button className="btn primary" type="submit" disabled={busy || !place.trim()}>
          <Mail size={18} />
          {submitLabel}
        </button>
        {onCancel && (
          <button className="btn ghost" type="button" onClick={onCancel}>
            Annulla
          </button>
        )}
      </div>
    </form>
  )
}

export function MyEnvelope({ round }: { round: Round }) {
  const { cur, backend, run, ask } = useGame()
  const [editing, setEditing] = useState<string | null>(null)
  if (!cur) return null
  const mine = cur.my_proposals
  const max = round.rules.proposals_per_person

  if (cur.propose_block_reason === 'penalty') {
    return (
      <Card icon={<Lock size={20} />} title="In questo giro non proponi">
        <Notice tone="bad">
          Il tuo ultimo posto è stato bocciato: per questo giro niente busta. Puoi comunque segnare la disponibilità e votare come tutti.
        </Notice>
      </Card>
    )
  }

  return (
    <Card
      icon={<Mail size={20} />}
      title={max === 1 ? 'La tua busta' : 'Le tue buste'}
      sub="Solo tu vedi cosa hai scritto. Puoi cambiarla fino al sorteggio."
    >
      <div className="stack">
        {mine.map((p) =>
          editing === p.id ? (
            <ProposalForm
              key={p.id}
              initial={p}
              submitLabel="Salva"
              onCancel={() => setEditing(null)}
              onSave={(place, notes) =>
                run(async () => {
                  await backend.saveProposal(round.id, place, notes || null, p.id)
                  return true
                }, 'Busta aggiornata').then((r) => {
                  if (r) setEditing(null)
                  return r
                })
              }
            />
          ) : (
            <div key={p.id} className="notice tone-accent">
              <EyeOff size={18} />
              <div className="grow">
                <b>{p.place_name}</b>
                {p.notes && (
                  <div className="small muted">
                    <Linkify text={p.notes} />
                  </div>
                )}
              </div>
              <div className="row" style={{ gap: 4 }}>
                <button className="btn ghost small" onClick={() => setEditing(p.id)} aria-label="Modifica">
                  <Pencil size={16} />
                </button>
                <button
                  className="btn ghost small danger"
                  aria-label="Ritira"
                  onClick={async () => {
                    if (await ask('Ritirare la busta?', `“${p.place_name}” esce dall’urna.`, 'Ritira', true))
                      await run(() => backend.deleteProposal(p.id), 'Busta ritirata')
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ),
        )}
        {cur.can_propose && (
          <>
            {mine.length > 0 && <div className="small muted">Puoi metterne ancora {max - mine.length}.</div>}
            <ProposalForm
              submitLabel="Metti in busta"
              onSave={(place, notes) =>
                run(async () => {
                  await backend.saveProposal(round.id, place, notes || null)
                  return true
                }, 'Busta chiusa e nell’urna')
              }
            />
          </>
        )}
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  L'urna e il sorteggio                                               */
/* ------------------------------------------------------------------ */

export function UrnCard({ round }: { round: Round }) {
  const { state, isAdmin, backend, run, ask } = useGame()
  const n = round.proposals_count
  const admins = state.members.filter((m) => m.active && m.role === 'admin').map((m) => m.display_name)
  return (
    <Card
      icon={<Dices size={20} />}
      title="L’urna"
      sub={n === 0 ? 'Ancora nessuna busta.' : `${plural(n, 'busta chiusa', 'buste chiuse')} in attesa del sorteggio.`}
    >
      <div className="stack">
        {n > 0 && (
          <div className="envelopes" aria-hidden="true">
            {Array.from({ length: Math.min(n, 14) }, (_, i) => (
              <Mail key={i} size={26} strokeWidth={1.6} />
            ))}
            {n > 14 && <span className="badge accent">+{n - 14}</span>}
          </div>
        )}
        {isAdmin ? (
          <button
            className="btn primary big block"
            disabled={n === 0}
            onClick={async () => {
              const ok = await ask(
                'Sorteggiare adesso?',
                <>
                  Si estrae un locale tra {plural(n, 'busta', 'buste')}: dopo nessuno potrà più proporre.
                  {n === 1 && <b> C’è una sola busta: chi l’ha messa sarà facile da indovinare.</b>}
                </>,
                'Sorteggia',
              )
              if (ok)
                await run(
                  () => backend.draw(round.id),
                  (place) => `Estratto: ${place}`,
                )
            }}
          >
            <Dices size={20} /> Sorteggia
          </button>
        ) : (
          <p className="small muted">
            Il sorteggio lo fa {admins.length > 1 ? 'un organizzatore' : 'l’organizzatore'} ({listIt(admins)}).
          </p>
        )}
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  Il posto estratto                                                   */
/* ------------------------------------------------------------------ */

export function DrawnCard({ round }: { round: Round }) {
  const { state, cur, isAdmin, backend, run } = useGame()
  const [date, setDate] = useState(round.dinner_date ?? '')
  const [undo, setUndo] = useState(false)
  useEffect(() => setDate(round.dinner_date ?? ''), [round.dinner_date])
  const today = state.today

  return (
    <Card icon={<MapPin size={20} />} title="Il posto estratto">
      <div className="stack">
        <div className="place-name">{round.place_name}</div>
        {round.place_notes && (
          <p className="muted">
            <Linkify text={round.place_notes} />
          </p>
        )}
        {cur?.is_proposer && (
          <Notice tone="accent" icon={<EyeOff size={18} />}>
            <b>È il tuo posto.</b>{' '}
            {round.rules.reveal === 'always'
              ? 'Nessuno lo sa fino al verdetto.'
              : 'Nessuno lo sa: se non viene promosso, non lo saprà mai.'}
            {!round.rules.proposer_votes && ' Stavolta non voti: giudicano gli altri.'}
          </Notice>
        )}
        <div className="notice">
          <CalendarClock size={18} />
          <div className="grow">
            {round.dinner_date ? (
              <>
                Cena <b>{formatLong(round.dinner_date)}</b> <span className="muted">({relativeDay(round.dinner_date, today)})</span>
              </>
            ) : (
              <>Data della cena ancora da fissare.</>
            )}
          </div>
        </div>
        {isAdmin && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 6 }}>
              <input
                className="input"
                style={{ width: 'auto' }}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-label="Data della cena"
              />
              <button
                className="btn small"
                disabled={!date || date === round.dinner_date}
                onClick={() => run(() => backend.setDinnerDate(round.id, date), 'Data della cena fissata')}
              >
                {round.dinner_date ? 'Cambia data' : 'Fissa la data'}
              </button>
              {round.votes_count === 0 && (
                <button className="btn small ghost" onClick={() => setUndo(true)}>
                  <Undo2 size={16} /> Annulla sorteggio
                </button>
              )}
            </div>
            {!round.dinner_date && (
              <p className="small muted">Puoi anche toccare un giorno nel calendario della disponibilità qui sotto.</p>
            )}
          </div>
        )}
      </div>
      {undo && (
        <Modal title="Annullare il sorteggio?" onClose={() => setUndo(false)}>
          <p className="muted">
            Si torna alla fase delle proposte. Resterà scritto nel registro che il sorteggio è stato annullato. Cosa fare con “
            {round.place_name}”?
          </p>
          <div className="stack" style={{ gap: 8 }}>
            <button
              className="btn block"
              onClick={() =>
                run(() => backend.undoDraw(round.id, false), 'Sorteggio annullato: la busta è tornata nell’urna').then(() => setUndo(false))
              }
            >
              Rimetti la busta nell’urna
            </button>
            <button
              className="btn block danger"
              onClick={() => run(() => backend.undoDraw(round.id, true), 'Sorteggio annullato: locale scartato').then(() => setUndo(false))}
            >
              Scarta il locale (es. è chiuso)
            </button>
          </div>
        </Modal>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  Il voto                                                             */
/* ------------------------------------------------------------------ */

function ScoreInput({
  rules,
  value,
  onChange,
  label,
}: {
  rules: Rules
  value: number | undefined
  onChange: (v: number) => void
  label: string
}) {
  const values = scaleValues(rules)
  if (values) {
    return (
      <div className="score-grid" style={{ ['--n' as string]: values.length }} role="radiogroup" aria-label={label}>
        {values.map((v) => (
          <button
            key={v}
            type="button"
            className="score-btn"
            role="radio"
            aria-checked={value === v}
            aria-pressed={value === v}
            onClick={() => onChange(v)}
          >
            {fmtNum(v)}
          </button>
        ))}
      </div>
    )
  }
  const mid = rules.scale_min + Math.round((rules.scale_max - rules.scale_min) / 2 / rules.scale_step) * rules.scale_step
  return (
    <input
      className="range"
      type="range"
      min={rules.scale_min}
      max={rules.scale_max}
      step={rules.scale_step}
      value={value ?? mid}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  )
}

function VoteForm({ round }: { round: Round }) {
  const { cur, backend, run, busy } = useGame()
  const rules = round.rules
  const saved = cur?.my_vote?.scores
  const [scores, setScores] = useState<Partial<Scores>>(saved ?? {})
  useEffect(() => {
    if (saved) setScores(saved)
  }, [saved])
  const weighted = rules.criteria.some((c) => c.weight !== rules.criteria[0].weight)
  const mean = voteMean(rules, scores)
  const complete = mean != null
  const changed = JSON.stringify(scores) !== JSON.stringify(saved ?? {})

  return (
    <form
      className="stack-lg"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!complete) return
        await run(
          () => backend.castVote(round.id, scores as Scores),
          (r) => (r.closed ? 'Voto salvato: hanno votato tutti, ecco il verdetto!' : saved ? 'Voto aggiornato' : 'Voto salvato'),
        )
      }}
    >
      {rules.criteria.map((c) => (
        <div key={c.key} className="criterion">
          <div className="row-between">
            <span style={{ fontWeight: 650 }}>
              {c.label} {weighted && <span className="badge">×{fmtNum(c.weight)}</span>}
            </span>
            <span className="score-value">{scores[c.key] != null ? fmtNum(scores[c.key]) : '–'}</span>
          </div>
          <ScoreInput rules={rules} label={c.label} value={scores[c.key]} onChange={(v) => setScores((s) => ({ ...s, [c.key]: v }))} />
        </div>
      ))}
      <div className="row-between">
        <span className="muted small">
          {complete ? (
            <>
              La tua media: <b>{fmtMean(mean)}</b>
            </>
          ) : (
            'Dai un voto a ogni voce.'
          )}
        </span>
        <button className="btn primary" type="submit" disabled={!complete || busy || !changed}>
          <VoteIcon size={18} /> {saved ? (changed ? 'Aggiorna il voto' : 'Voto salvato') : 'Vota'}
        </button>
      </div>
      {saved && <p className="small muted">Puoi cambiare il voto fino alla chiusura. Nessuno vede i voti degli altri.</p>}
    </form>
  )
}

export function VoteCard({ round }: { round: Round }) {
  const { cur, isAdmin, backend, run, ask } = useGame()
  if (!cur) return null
  const rules = round.rules
  const expected = cur.expected_voters ?? 0
  const pct = expected ? Math.min(100, Math.round((round.votes_count / expected) * 100)) : 0

  let body
  if (cur.can_vote) body = <VoteForm round={round} />
  else if (cur.vote_block_reason === 'proposer')
    body = (
      <Notice tone="accent" icon={<EyeOff size={18} />}>
        È il tuo posto: stavolta non voti, giudicano gli altri.
      </Notice>
    )
  else if (cur.vote_block_reason === 'penalty')
    body = (
      <Notice tone="bad" icon={<Lock size={18} />}>
        In questo giro non puoi votare: è la penalità per il tuo ultimo posto bocciato.
      </Notice>
    )
  else
    body = (
      <Notice icon={<Lock size={18} />}>
        {round.dinner_date
          ? `Il voto si apre ${formatLong(round.dinner_date)}, il giorno della cena.`
          : 'Il voto si apre il giorno della cena, appena viene fissata la data.'}
      </Notice>
    )

  const autoClose =
    rules.voting_closes === 'all_voted'
      ? 'Si chiude da sola quando hanno votato tutti.'
      : rules.voting_closes === 'days_after' && round.dinner_date
        ? `Si chiude da sola ${formatShort(addDays(round.dinner_date, rules.close_after_days))}.`
        : rules.voting_closes === 'days_after'
          ? `Si chiude da sola ${plural(rules.close_after_days, 'giorno', 'giorni')} dopo la cena.`
          : null

  const close = async () => {
    const missing = expected - round.votes_count
    const ok = await ask(
      'Chiudere la votazione?',
      <>
        Hanno votato {round.votes_count} su {expected}.
        {missing > 0 && <b> Mancano {plural(missing, 'voto', 'voti')}: non si potranno più aggiungere.</b>} L’app calcola il verdetto e apre
        il giro successivo.
      </>,
      'Chiudi e calcola',
    )
    if (ok)
      await run(
        () => backend.closeRound(round.id),
        (r) => (r.outcome === 'promoted' ? `Promosso con ${fmtMean(r.mean)}!` : `Bocciato con ${fmtMean(r.mean)}`),
      )
  }

  return (
    <Card
      icon={<VoteIcon size={20} />}
      title="Il voto"
      sub={`Si vota su ${listIt(rules.criteria.map((c) => c.label.toLowerCase()))}, da ${rules.scale_min} a ${rules.scale_max}.`}
    >
      <div className="stack-lg">
        {cur.voting_open && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="row-between small">
              <span>
                Hanno votato <b>{round.votes_count}</b> su {expected}
              </span>
              <span className="muted">Le medie si vedono solo al verdetto</span>
            </div>
            <div className="progress" aria-hidden="true">
              <div style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
        {body}
        {(isAdmin || autoClose) && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="divider" />
            {autoClose && <p className="small muted">{autoClose}</p>}
            {isAdmin && (
              <div className="row">
                {!cur.voting_open && (
                  <button className="btn" onClick={() => run(() => backend.openVotingNow(round.id), 'Voto aperto')}>
                    Apri il voto adesso
                  </button>
                )}
                {cur.voting_open && (
                  <button className="btn" disabled={round.votes_count === 0} onClick={close}>
                    Chiudi la votazione e calcola il verdetto
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  Verdetto                                                            */
/* ------------------------------------------------------------------ */

export function ResultBars({ round }: { round: Round }) {
  const r = round.rules
  const span = r.scale_max - r.scale_min
  return (
    <div className="bars">
      {round.results?.criteria.map((c) => (
        <div key={c.key} className="bar-row">
          <span>
            {c.label}
            {c.weight !== round.results!.criteria[0].weight && <span className="muted tiny"> ×{fmtNum(c.weight)}</span>}
          </span>
          <div className="bar">
            <div style={{ width: `${Math.max(2, ((c.avg - r.scale_min) / span) * 100)}%` }} />
          </div>
          <b>{fmtMean(c.avg)}</b>
        </div>
      ))}
    </div>
  )
}

export function VerdictCard({ round, title }: { round: Round; title?: string }) {
  const { state, name } = useGame()
  const promoted = round.outcome === 'promoted'
  const mine = state.my_drawn_round_ids.includes(round.id)
  const r = round.rules
  const trimmed = round.results?.criteria.some((c) => c.trimmed)
  return (
    <Card
      tone={promoted ? 'ok' : 'bad'}
      icon={promoted ? <Award size={20} /> : <XCircle size={20} />}
      title={title ?? (promoted ? 'Promosso!' : 'Bocciato')}
      sub={`Giro ${round.number} · ${round.place_name}${round.dinner_date ? ` · ${formatShort(round.dinner_date)}` : ''}`}
      action={
        <div className={`mean ${promoted ? 'ok' : 'bad'}`}>
          {fmtMean(round.final_mean)}
          <div className="tiny muted" style={{ fontFamily: 'var(--font)', fontWeight: 500 }}>
            target {r.target_mode === 'gte' ? '≥' : '>'} {fmtNum(r.target)}
          </div>
        </div>
      }
    >
      <div className="stack">
        <ResultBars round={round} />
        <p className="small">
          {round.proposer_id ? (
            <>
              Proposto da <b>{name(round.proposer_id)}</b>
            </>
          ) : (
            <span className="muted">Chi l’ha proposto resta anonimo.</span>
          )}
          <span className="muted">
            {' '}
            · {plural(round.results?.voters ?? 0, 'voto', 'voti')}
            {trimmed && ', esclusi il più alto e il più basso'}
          </span>
        </p>
        {mine && promoted && (
          <Notice tone="ok" icon={<Award size={18} />}>
            <b>Era il tuo posto: hai vinto!</b> {r.prize ? `Il premio: ${r.prize}.` : ''}
          </Notice>
        )}
        {!mine && promoted && r.prize && round.proposer_id && (
          <p className="small">
            Premio per {name(round.proposer_id)}: {r.prize}.
          </p>
        )}
        {mine && !promoted && (
          <Notice tone="bad">
            <b>Era il tuo posto.</b> {myPenaltyText(r)}
          </Notice>
        )}
      </div>
    </Card>
  )
}
