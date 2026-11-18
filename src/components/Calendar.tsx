import type { CSSProperties } from 'react'
import { addDays, formatLong, formatMonth, isoWeekday, parseISO, toISO, WEEKDAYS_LETTER } from '../lib/dates'
import type { ISODate } from '../lib/types'

export interface CalendarProps {
  start: ISODate
  end: ISODate
  today: ISODate
  allowedWeekdays: number[]
  /** classi aggiuntive per un giorno valido */
  dayClass?: (d: ISODate) => string
  dayStyle?: (d: ISODate) => CSSProperties | undefined
  dayLabel?: (d: ISODate) => string
  onDayClick?: (d: ISODate) => void
  /** i giorni passati si possono cliccare? */
  allowPast?: boolean
}

function monthStarts(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = []
  const d = parseISO(start)
  d.setDate(1)
  const last = parseISO(end)
  while (d <= last) {
    out.push(toISO(d))
    d.setMonth(d.getMonth() + 1)
  }
  return out
}

export function Calendar(p: CalendarProps) {
  return (
    <div className="cal-months">
      {monthStarts(p.start, p.end).map((m) => (
        <Month key={m} first={m} {...p} />
      ))}
    </div>
  )
}

function Month({ first, ...p }: CalendarProps & { first: ISODate }) {
  const lead = isoWeekday(first) - 1
  const d0 = parseISO(first)
  const daysInMonth = new Date(d0.getFullYear(), d0.getMonth() + 1, 0).getDate()
  const cells: (ISODate | null)[] = [...Array(lead).fill(null)]
  for (let i = 0; i < daysInMonth; i++) cells.push(addDays(first, i))

  return (
    <div className="cal-month">
      <h4>{formatMonth(first)}</h4>
      <div className="cal-grid" role="grid">
        {WEEKDAYS_LETTER.map((w, i) => (
          <div key={i} className="cal-wd" aria-hidden="true">
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} className="cal-day empty" />
          const num = Number(d.slice(8))
          const inWindow = d >= p.start && d <= p.end
          const past = d < p.today && !p.allowPast
          if (!inWindow || past) {
            return (
              <div key={d} className={`cal-day off ${d === p.today ? 'today' : ''}`} aria-hidden="true">
                {num}
              </div>
            )
          }
          if (!p.allowedWeekdays.includes(isoWeekday(d))) {
            return (
              <div key={d} className="cal-day blocked" title="Giorno non ammesso dalle regole" aria-hidden="true">
                {num}
              </div>
            )
          }
          const cls = `cal-day ${d === p.today ? 'today' : ''} ${p.dayClass?.(d) ?? ''}`
          return (
            <button
              key={d}
              type="button"
              className={cls}
              style={p.dayStyle?.(d)}
              aria-label={p.dayLabel?.(d) ?? formatLong(d)}
              onClick={p.onDayClick ? () => p.onDayClick!(d) : undefined}
              disabled={!p.onDayClick}
            >
              {num}
            </button>
          )
        })}
      </div>
    </div>
  )
}
