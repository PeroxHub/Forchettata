import { useEffect, useMemo, useState } from 'react'
import { CalendarCheck, CalendarDays, Users } from 'lucide-react'
import { Calendar } from './Calendar'
import { Card, Notice } from './ui'
import { useGame } from '../game/context'
import { eachDay, formatLong, formatShort, formatStamp, isoWeekday, WEEKDAYS_LONG, WEEKDAYS_SHORT } from '../lib/dates'
import { dayAllowed, groupAvailability } from '../lib/game'
import { listIt, plural } from '../lib/format'
import type { ISODate, Round } from '../lib/types'

/* ------------------------------------------------------------------ */
/*  La mia disponibilità                                                */
/* ------------------------------------------------------------------ */

export function MyAvailability({ round, compact = false }: { round: Round; compact?: boolean }) {
  const { state, cur, backend, run, busy } = useGame()
  const today = state.today
  const rules = round.rules
  const mine = cur?.availability.find((a) => a.user_id === state.me.user_id)
  const serverDays = useMemo(() => new Set(mine?.days ?? []), [mine])
  const [sel, setSel] = useState<Set<ISODate>>(serverDays)
  const [dirty, setDirty] = useState(false)
  const [from, setFrom] = useState(today > round.window_start ? today : round.window_start)
  const [to, setTo] = useState(round.window_end)

  useEffect(() => {
    if (!dirty) setSel(new Set(serverDays))
  }, [serverDays, dirty])

  const minDay = today > round.window_start ? today : round.window_start
  const selectable = (d: ISODate) => d >= minDay && dayAllowed(d, rules, round.window_start, round.window_end)
  const future = eachDay(minDay, round.window_end).filter(selectable)
  const selCount = [...sel].filter(selectable).length

  const update = (fn: (s: Set<ISODate>) => void) => {
    const s = new Set(sel)
    fn(s)
    setSel(s)
    setDirty(true)
  }
  const toggle = (d: ISODate) => update((s) => (s.has(d) ? s.delete(d) : s.add(d)))
  const toggleWeekday = (w: number) => {
    const days = future.filter((d) => isoWeekday(d) === w)
    const all = days.every((d) => sel.has(d))
    update((s) => days.forEach((d) => (all ? s.delete(d) : s.add(d))))
  }
  const range = (add: boolean) => {
    if (!from || !to || from > to) return
    update((s) =>
      eachDay(from, to)
        .filter(selectable)
        .forEach((d) => (add ? s.add(d) : s.delete(d))),
    )
  }
  const save = () =>
    run(
      () => backend.saveAvailability(round.id, [...sel].filter((d) => dayAllowed(d, rules, round.window_start, round.window_end)).sort()),
      'Disponibilità salvata',
    ).then((r) => r && setDirty(false))

  return (
    <Card
      icon={<CalendarDays size={20} />}
      title="La tua disponibilità"
      sub={`Tocca i giorni in cui sei libero, fino al ${formatShort(round.window_end)}.`}
    >
      <div className="stack">
        {!mine && !compact && <Notice tone="warn">Non hai ancora segnato la tua disponibilità: senza, l’app non sa quando ci sei.</Notice>}
        <div className="stack" style={{ gap: 8 }}>
          <div className="seg" style={{ alignItems: 'center' }}>
            <span className="small muted">Tutti i</span>
            {rules.allowed_weekdays.map((w) => {
              const days = future.filter((d) => isoWeekday(d) === w)
              const on = days.length > 0 && days.every((d) => sel.has(d))
              return (
                <button
                  key={w}
                  type="button"
                  className="chip"
                  aria-pressed={on}
                  aria-label={`Tutti i ${WEEKDAYS_LONG[w - 1]}`}
                  onClick={() => toggleWeekday(w)}
                  disabled={!days.length}
                >
                  {WEEKDAYS_SHORT[w - 1]}
                </button>
              )
            })}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <span className="small muted">dal</span>
            <input
              className="input"
              style={{ width: 'auto' }}
              type="date"
              value={from}
              min={minDay}
              max={round.window_end}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="Dal giorno"
            />
            <span className="small muted">al</span>
            <input
              className="input"
              style={{ width: 'auto' }}
              type="date"
              value={to}
              min={minDay}
              max={round.window_end}
              onChange={(e) => setTo(e.target.value)}
              aria-label="Al giorno"
            />
            <button type="button" className="btn small" onClick={() => range(true)}>
              Aggiungi
            </button>
            <button type="button" className="btn small ghost" onClick={() => range(false)}>
              Togli
            </button>
          </div>
        </div>

        <Calendar
          start={round.window_start}
          end={round.window_end}
          today={today}
          allowedWeekdays={rules.allowed_weekdays}
          dayClass={(d) => (sel.has(d) ? 'mine' : '')}
          dayLabel={(d) => `${formatLong(d)}${sel.has(d) ? ': libero' : ''}`}
          onDayClick={toggle}
        />
        <div className="legend">
          <span>
            <i style={{ background: 'var(--mine)' }} />
            libero
          </span>
          <span>
            <i style={{ background: 'var(--surface-2)' }} />
            non libero
          </span>
          {rules.allowed_weekdays.length < 7 && (
            <span>
              <i className="cal-day blocked" style={{ minHeight: 0, aspectRatio: 'auto' }} />
              giorno escluso dalle regole
            </span>
          )}
        </div>

        <div className="row-between">
          <span className="small muted">
            {plural(selCount, 'giorno selezionato', 'giorni selezionati')}
            {mine && !dirty && ` · salvata ${formatStamp(mine.updated_at)}`}
            {dirty && ' · modifiche non salvate'}
          </span>
          <div className="row" style={{ gap: 6 }}>
            {dirty && (
              <button type="button" className="btn ghost small" onClick={() => (setSel(new Set(serverDays)), setDirty(false))}>
                Annulla
              </button>
            )}
            <button type="button" className="btn primary" disabled={busy || (!dirty && !!mine)} onClick={save}>
              {selCount === 0 ? 'Salva: nessun giorno libero' : 'Salva disponibilità'}
            </button>
          </div>
        </div>
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  Disponibilità di tutti                                              */
/* ------------------------------------------------------------------ */

export function GroupAvailabilityCard({ round }: { round: Round }) {
  const { state, cur, isAdmin, backend, run, name, ask } = useGame()
  const today = state.today
  const g = useMemo(
    () =>
      groupAvailability({
        rows: cur?.availability ?? [],
        members: state.members,
        rules: round.rules,
        windowStart: round.window_start,
        windowEnd: round.window_end,
        today,
      }),
    [cur, state.members, round, today],
  )
  const [picked, setPicked] = useState<ISODate | null>(null)
  const canPick = isAdmin && round.status === 'drawn'
  const activeCount = state.members.filter((m) => m.active).length

  const setDate = async (d: ISODate) => {
    const free = g.perDay.get(d)?.length ?? 0
    const ok = await ask(
      'Fissare la cena?',
      <>
        La cena del giro {round.number} sarà <b>{formatLong(d)}</b>. Liberi {free} su {g.total} che hanno risposto.
      </>,
      'Fissa la data',
    )
    if (ok) await run(() => backend.setDinnerDate(round.id, d), 'Data della cena fissata')
  }

  const pickedUsers = picked ? (g.perDay.get(picked) ?? []) : []
  const pickedBusy = picked ? g.responders.filter((u) => !pickedUsers.includes(u)) : []

  return (
    <Card
      icon={<Users size={20} />}
      title="La disponibilità di tutti"
      sub={
        g.total === 0
          ? 'Nessuno ha ancora risposto.'
          : `Hanno risposto ${g.total} su ${activeCount}${g.missing.length ? ` · mancano ${listIt(g.missing.map((m) => m.display_name))}` : ' · ci sono tutti'}`
      }
    >
      <div className="stack">
        {g.total > 0 && (
          <div className="stack" style={{ gap: 8 }}>
            {g.goodDays.length > 0 ? (
              <p className="small">
                <CalendarCheck size={16} style={{ verticalAlign: -3, color: 'var(--ok)' }} />{' '}
                <b>{plural(g.goodDays.length, 'giorno va', 'giorni vanno')} bene a tutti</b>
                {g.missing.length ? ' quelli che hanno risposto' : ''}:
              </p>
            ) : g.bestDays.length > 0 ? (
              <p className="small">Nessun giorno va bene a tutti. I migliori:</p>
            ) : (
              <p className="small muted">Nessun giorno libero in comune per ora.</p>
            )}
            <div className="seg">
              {g.bestDays.slice(0, 12).map((x) => (
                <button
                  key={x.day}
                  type="button"
                  className={`chip ${x.users.length === g.total ? 'ok' : ''}`}
                  aria-pressed={picked === x.day}
                  onClick={() => setPicked(picked === x.day ? null : x.day)}
                >
                  {formatShort(x.day)}
                  {x.users.length < g.total && (
                    <span className="tiny">
                      {' '}
                      · {x.users.length} su {g.total}
                    </span>
                  )}
                </button>
              ))}
              {g.goodDays.length > 12 && <span className="chip static">+{g.goodDays.length - 12}</span>}
            </div>
          </div>
        )}

        {g.total === 0 ? (
          <p className="small muted">Appena qualcuno segna i suoi giorni liberi, qui compare il calendario di tutti.</p>
        ) : (
          <>
            <Calendar
              start={round.window_start}
              end={round.window_end}
              today={today}
              allowedWeekdays={round.rules.allowed_weekdays}
              dayClass={(d) => {
                const n = g.perDay.get(d)?.length ?? 0
                return [n > 0 && n === g.total ? 'all' : '', d === round.dinner_date ? 'dinner' : '', d === picked ? 'picked' : ''].join(
                  ' ',
                )
              }}
              dayStyle={(d) => {
                if (d === round.dinner_date) return undefined
                const n = g.perDay.get(d)?.length ?? 0
                if (!n || !g.total) return undefined
                const ratio = n / g.total
                return {
                  background: `rgba(var(--heat), ${0.14 + 0.66 * ratio})`,
                  color: ratio > 0.6 ? 'var(--surface)' : undefined,
                }
              }}
              dayLabel={(d) => `${formatLong(d)}: liberi ${g.perDay.get(d)?.length ?? 0} su ${g.total}`}
              onDayClick={(d) => setPicked(picked === d ? null : d)}
            />
            <div className="legend">
              <span>
                <i style={{ background: 'rgba(var(--heat), .3)' }} />
                liberi in pochi
              </span>
              <span>
                <i style={{ background: 'rgba(var(--heat), .8)' }} />
                liberi in tanti
              </span>
              <span>
                <i style={{ boxShadow: 'inset 0 0 0 2px var(--ok)', background: 'var(--surface-2)' }} />
                vanno bene a tutti
              </span>
              {round.dinner_date && (
                <span>
                  <i style={{ background: 'var(--accent)' }} />
                  cena
                </span>
              )}
            </div>
          </>
        )}

        {picked && (
          <div className="notice">
            <div className="grow stack" style={{ gap: 6 }}>
              <b>{formatLong(picked)}</b>
              <span className="small">
                {pickedUsers.length ? `Liberi: ${listIt(pickedUsers.map(name))}` : 'Nessuno è libero.'}
                {pickedBusy.length > 0 && <span className="muted"> · non liberi: {listIt(pickedBusy.map(name))}</span>}
              </span>
              {canPick && picked >= today && (
                <div>
                  <button
                    type="button"
                    className="btn primary small"
                    onClick={() => setDate(picked)}
                    disabled={picked === round.dinner_date}
                  >
                    {picked === round.dinner_date ? 'È già la data della cena' : 'Fissa la cena in questo giorno'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {canPick && !picked && g.total > 0 && (
          <p className="small muted">Tocca un giorno del calendario per vedere chi è libero e fissare la cena.</p>
        )}
      </div>
    </Card>
  )
}
