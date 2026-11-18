import type { AvailabilityRow, CriterionResult, ISODate, Member, Round, Rules, Scores } from './types'
import { isoWeekday } from './dates'

/* ------------------------------------------------------------------ */
/*  Disponibilità                                                       */
/* ------------------------------------------------------------------ */

export interface DayInfo {
  day: ISODate
  users: string[]
}

export interface GroupAvailability {
  responders: string[]
  missing: Member[]
  total: number
  perDay: Map<ISODate, string[]>
  /** giorni futuri buoni per tutti quelli che hanno risposto */
  goodDays: DayInfo[]
  /** se nessun giorno va bene a tutti: i migliori, altrimenti uguale a goodDays */
  bestDays: DayInfo[]
}

export function dayAllowed(day: ISODate, rules: Pick<Rules, 'allowed_weekdays'>, start: ISODate, end: ISODate) {
  return day >= start && day <= end && rules.allowed_weekdays.includes(isoWeekday(day))
}

export function groupAvailability(opts: {
  rows: AvailabilityRow[]
  members: Member[]
  rules: Pick<Rules, 'allowed_weekdays'>
  windowStart: ISODate
  windowEnd: ISODate
  today: ISODate
}): GroupAvailability {
  const active = opts.members.filter((m) => m.active)
  const activeIds = new Set(active.map((m) => m.user_id))
  const rows = opts.rows.filter((r) => activeIds.has(r.user_id))
  const responders = rows.map((r) => r.user_id)
  const missing = active.filter((m) => !responders.includes(m.user_id))
  const perDay = new Map<ISODate, string[]>()
  for (const r of rows) {
    for (const d of new Set(r.days)) {
      if (!dayAllowed(d, opts.rules, opts.windowStart, opts.windowEnd)) continue
      const list = perDay.get(d) ?? []
      list.push(r.user_id)
      perDay.set(d, list)
    }
  }
  const total = responders.length
  const future: DayInfo[] = [...perDay.entries()].filter(([d]) => d >= opts.today).map(([day, users]) => ({ day, users }))
  const goodDays = total > 0 ? future.filter((x) => x.users.length === total).sort((a, b) => a.day.localeCompare(b.day)) : []
  const bestDays = goodDays.length
    ? goodDays
    : future.sort((a, b) => b.users.length - a.users.length || a.day.localeCompare(b.day)).slice(0, 6)
  return { responders, missing, total, perDay, goodDays, bestDays }
}

/* ------------------------------------------------------------------ */
/*  Voto e verdetto (stesso calcolo del database)                       */
/* ------------------------------------------------------------------ */

export const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100

export function computeResults(
  rules: Rules,
  votes: { user_id: string; scores: Scores }[],
  proposerId: string | null,
): { criteria: CriterionResult[]; voters: number; final_mean: number } {
  const valid = votes.filter((v) => rules.proposer_votes || v.user_id !== proposerId)
  if (valid.length === 0) throw new Error('Non ha ancora votato nessuno')
  let total = 0
  let wsum = 0
  const criteria: CriterionResult[] = rules.criteria.map((c) => {
    let vals = valid
      .map((v) => v.scores[c.key])
      .filter((x): x is number => typeof x === 'number')
      .sort((a, b) => a - b)
    const n = vals.length
    if (n === 0) throw new Error(`Nessun voto per la voce ${c.label}`)
    const trimmed = rules.trim_extremes && n >= 5
    if (trimmed) vals = vals.slice(1, -1)
    const avg = vals.reduce((s, x) => s + x, 0) / vals.length
    total += c.weight * avg
    wsum += c.weight
    return { ...c, avg: round2(avg), n, trimmed }
  })
  return { criteria, voters: valid.length, final_mean: round2(total / wsum) }
}

export function isPromoted(mean: number, rules: Pick<Rules, 'target' | 'target_mode'>) {
  return rules.target_mode === 'gte' ? mean >= rules.target : mean > rules.target
}

export function isVotingOpen(round: Pick<Round, 'status' | 'voting_forced_open' | 'rules' | 'dinner_date'>, today: ISODate) {
  return (
    round.status === 'drawn' &&
    (round.voting_forced_open || round.rules.voting_opens === 'after_draw' || (round.dinner_date != null && today >= round.dinner_date))
  )
}

/** Media del singolo voto (pesata come quella finale). */
export function voteMean(rules: Rules, scores: Partial<Scores>): number | null {
  let t = 0
  let w = 0
  for (const c of rules.criteria) {
    const v = scores[c.key]
    if (typeof v !== 'number') return null
    t += c.weight * v
    w += c.weight
  }
  return round2(t / w)
}

/** Valori possibili della scala, se sono pochi (per i bottoni). */
export function scaleValues(rules: Pick<Rules, 'scale_min' | 'scale_max' | 'scale_step'>): number[] | null {
  const n = Math.round((rules.scale_max - rules.scale_min) / rules.scale_step) + 1
  if (n > 11) return null
  return Array.from({ length: n }, (_, i) => rules.scale_min + i * rules.scale_step)
}

/* ------------------------------------------------------------------ */
/*  Classifica                                                          */
/* ------------------------------------------------------------------ */

export interface LeaderRow {
  member: Member
  drawn: number
  promoted: number
  failed: number
  avg: number | null
  best: number | null
}

export function leaderboard(rounds: Round[], members: Member[]) {
  const closed = rounds.filter((r) => r.status === 'closed' && r.final_mean != null)
  const rows: LeaderRow[] = members.map((m) => {
    const mine = closed.filter((r) => r.proposer_id === m.user_id)
    const means = mine.map((r) => Number(r.final_mean))
    return {
      member: m,
      drawn: mine.length,
      promoted: mine.filter((r) => r.outcome === 'promoted').length,
      failed: mine.filter((r) => r.outcome === 'failed').length,
      avg: means.length ? round2(means.reduce((a, b) => a + b, 0) / means.length) : null,
      best: means.length ? Math.max(...means) : null,
    }
  })
  rows.sort(
    (a, b) =>
      b.promoted - a.promoted ||
      (b.avg ?? -1) - (a.avg ?? -1) ||
      b.drawn - a.drawn ||
      a.member.display_name.localeCompare(b.member.display_name),
  )
  const topPlaces = [...closed].sort((a, b) => Number(b.final_mean) - Number(a.final_mean)).slice(0, 3)
  const anonymous = closed.filter((r) => r.proposer_id == null).length
  return { rows: rows.filter((r) => r.member.active || r.drawn > 0), topPlaces, anonymous, closedCount: closed.length }
}
