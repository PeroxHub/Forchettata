import type { ISODate } from './types'

export function parseISO(d: ISODate): Date {
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, day)
}

export function toISO(d: Date): ISODate {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(d: ISODate, n: number): ISODate {
  const x = parseISO(d)
  x.setDate(x.getDate() + n)
  return toISO(x)
}

/** 1 = lunedì … 7 = domenica */
export function isoWeekday(d: ISODate): number {
  const w = parseISO(d).getDay()
  return w === 0 ? 7 : w
}

export function daysBetween(a: ISODate, b: ISODate): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d)
  return out
}

/** "oggi" in Italia, indipendentemente dal fuso del dispositivo. */
export function todayInRome(): ISODate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  return parts
}

const fShort = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })
const fLong = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })
const fLongYear = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })
const fMonth = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' })
const fStamp = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** "ven 14 nov" */
export const formatShort = (d: ISODate) => fShort.format(parseISO(d)).replace(',', '')
/** "venerdì 14 novembre" */
export const formatLong = (d: ISODate) => fLong.format(parseISO(d)).replace(',', '')
/** "14 novembre 2026" */
export const formatLongYear = (d: ISODate) => fLongYear.format(parseISO(d))
/** "novembre 2026" */
export const formatMonth = (d: ISODate) => fMonth.format(parseISO(d))
/** "18 nov, 21:05" */
export const formatStamp = (ts: string) => fStamp.format(new Date(ts))

export const WEEKDAYS_LONG = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica']
export const WEEKDAYS_SHORT = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom']
export const WEEKDAYS_LETTER = ['L', 'M', 'M', 'G', 'V', 'S', 'D']

/** "tra 3 giorni", "domani", "oggi", "ieri", "5 giorni fa" */
export function relativeDay(d: ISODate, today: ISODate): string {
  const n = daysBetween(today, d)
  if (n === 0) return 'oggi'
  if (n === 1) return 'domani'
  if (n === -1) return 'ieri'
  if (n > 1) return `tra ${n} giorni`
  return `${-n} giorni fa`
}
