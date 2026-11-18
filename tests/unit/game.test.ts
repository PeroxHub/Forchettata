import { describe, expect, it } from 'vitest'
import { computeResults, groupAvailability, isPromoted, isVotingOpen, leaderboard, scaleValues, voteMean } from '../../src/lib/game'
import { addDays, daysBetween, eachDay, isoWeekday } from '../../src/lib/dates'
import { DEFAULT_RULES, describeChange, describeRules, checkRules } from '../../src/lib/rules'
import type { Member, Round, Rules } from '../../src/lib/types'

const member = (id: string, active = true): Member => ({
  user_id: id,
  display_name: id.toUpperCase(),
  avatar_url: null,
  role: 'player',
  active,
  joined_at: '2026-01-01T00:00:00Z',
})

describe('date', () => {
  it('somma giorni e giorno della settimana', () => {
    expect(addDays('2026-11-28', 5)).toBe('2026-12-03')
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30') // cambio dell'ora
    expect(isoWeekday('2026-11-22')).toBe(7) // domenica
    expect(isoWeekday('2026-11-23')).toBe(1)
    expect(daysBetween('2026-11-18', '2027-02-15')).toBe(89)
    expect(eachDay('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
  })
})

describe('disponibilità del gruppo', () => {
  const base = {
    members: [member('a'), member('b'), member('c'), member('x', false)],
    rules: { allowed_weekdays: [1, 2, 3, 4, 5, 6, 7] },
    windowStart: '2026-11-18',
    windowEnd: '2027-02-15',
    today: '2026-11-20',
  }

  it('trova i giorni buoni per tutti quelli che hanno risposto', () => {
    const g = groupAvailability({
      ...base,
      rows: [
        { user_id: 'a', days: ['2026-11-19', '2026-11-21', '2026-11-22', '2026-11-28'], updated_at: '' },
        { user_id: 'b', days: ['2026-11-19', '2026-11-22', '2026-11-28'], updated_at: '' },
        { user_id: 'x', days: ['2026-11-21'], updated_at: '' }, // non più nel gruppo: ignorato
      ],
    })
    expect(g.responders).toEqual(['a', 'b'])
    expect(g.missing.map((m) => m.user_id)).toEqual(['c'])
    // il 19 è passato
    expect(g.goodDays.map((d) => d.day)).toEqual(['2026-11-22', '2026-11-28'])
    expect(g.bestDays).toBe(g.goodDays)
  })

  it('se nessun giorno va bene a tutti propone i migliori', () => {
    const g = groupAvailability({
      ...base,
      rows: [
        { user_id: 'a', days: ['2026-11-21', '2026-11-22'], updated_at: '' },
        { user_id: 'b', days: ['2026-11-22', '2026-11-23'], updated_at: '' },
        { user_id: 'c', days: ['2026-11-23', '2026-11-30'], updated_at: '' },
      ],
    })
    expect(g.goodDays).toEqual([])
    expect(g.bestDays.slice(0, 2).map((d) => [d.day, d.users.length])).toEqual([
      ['2026-11-22', 2],
      ['2026-11-23', 2],
    ])
  })

  it('ignora i giorni della settimana non ammessi e fuori finestra', () => {
    const g = groupAvailability({
      ...base,
      rules: { allowed_weekdays: [6] },
      rows: [{ user_id: 'a', days: ['2026-11-21', '2026-11-22', '2027-03-06'], updated_at: '' }],
    })
    expect([...g.perDay.keys()]).toEqual(['2026-11-21'])
  })
})

describe('verdetto', () => {
  const rules: Rules = { ...DEFAULT_RULES }
  const v = (user_id: string, m: number, l: number, c: number, s: number) => ({
    user_id,
    scores: { menu: m, location: l, conto: c, servizio: s },
  })

  it('media semplice, escluso il proponente', () => {
    const r = computeResults(rules, [v('a', 6, 7, 5, 6), v('b', 7, 6, 6, 7), v('p', 10, 10, 10, 10)], 'p')
    expect(r.final_mean).toBe(6.25)
    expect(r.voters).toBe(2)
    expect(r.criteria.map((c) => c.avg)).toEqual([6.5, 6.5, 5.5, 6.5])
  })

  it('pesi e scarto degli estremi come nel database', () => {
    const r = computeResults(
      {
        ...rules,
        trim_extremes: true,
        criteria: [
          { key: 'cibo', label: 'Cibo', weight: 2 },
          { key: 'prezzo', label: 'Prezzo', weight: 1 },
        ],
      },
      [
        { user_id: 'a', scores: { cibo: 10, prezzo: 4 } },
        { user_id: 'b', scores: { cibo: 7.5, prezzo: 6 } },
        { user_id: 'c', scores: { cibo: 7, prezzo: 6.5 } },
        { user_id: 'd', scores: { cibo: 6.5, prezzo: 7 } },
        { user_id: 'e', scores: { cibo: 2, prezzo: 9 } },
      ],
      null,
    )
    expect(r.final_mean).toBe(6.83)
    expect(r.criteria.every((c) => c.trimmed)).toBe(true)
  })

  it('target superiore o almeno uguale', () => {
    expect(isPromoted(7, { target: 7, target_mode: 'gt' })).toBe(false)
    expect(isPromoted(7, { target: 7, target_mode: 'gte' })).toBe(true)
    expect(isPromoted(7.01, { target: 7, target_mode: 'gt' })).toBe(true)
  })

  it('apertura del voto', () => {
    const r = { status: 'drawn' as const, voting_forced_open: false, rules, dinner_date: '2026-11-25' }
    expect(isVotingOpen(r, '2026-11-24')).toBe(false)
    expect(isVotingOpen(r, '2026-11-25')).toBe(true)
    expect(isVotingOpen({ ...r, dinner_date: null }, '2026-11-25')).toBe(false)
    expect(isVotingOpen({ ...r, voting_forced_open: true }, '2026-11-01')).toBe(true)
    expect(isVotingOpen({ ...r, rules: { ...rules, voting_opens: 'after_draw' } }, '2026-11-01')).toBe(true)
  })

  it('media del singolo voto e valori della scala', () => {
    expect(voteMean(rules, { menu: 8, location: 7, conto: 6, servizio: 9 })).toBe(7.5)
    expect(voteMean(rules, { menu: 8 })).toBeNull()
    expect(scaleValues(rules)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(scaleValues({ scale_min: 0, scale_max: 100, scale_step: 1 })).toBeNull()
    expect(scaleValues({ scale_min: 1, scale_max: 5, scale_step: 0.5 })).toHaveLength(9)
  })
})

describe('classifica', () => {
  it('ordina per promozioni e media', () => {
    const r = (n: number, pid: string | null, mean: number, outcome: 'promoted' | 'failed') =>
      ({ id: String(n), number: n, status: 'closed', final_mean: mean, outcome, proposer_id: pid }) as Round
    const lb = leaderboard(
      [r(1, 'a', 8, 'promoted'), r(2, 'b', 6, 'failed'), r(3, 'b', 9, 'promoted'), r(4, null, 5, 'failed'), r(5, 'a', 7.5, 'promoted')],
      [member('a'), member('b'), member('c')],
    )
    expect(lb.rows.map((x) => [x.member.user_id, x.promoted, x.avg])).toEqual([
      ['a', 2, 7.75],
      ['b', 1, 7.5],
      ['c', 0, null],
    ])
    expect(lb.anonymous).toBe(1)
    expect(lb.topPlaces.map((x) => x.number)).toEqual([3, 1, 5])
  })
})

describe('regole', () => {
  it('descrive le regole e le modifiche', () => {
    const d = describeRules(DEFAULT_RULES)
    expect(d[0].items[0]).toBe('Il posto è promosso se la media è superiore a 7.')
    expect(describeChange('target', 7, 7.5)).toBe('Target: 7 → 7,5')
    expect(describeChange('allowed_weekdays', [1, 2, 3, 4, 5, 6, 7], [5, 6])).toBe('Giorni ammessi: tutti i giorni → ven, sab')
    expect(checkRules({ ...DEFAULT_RULES, target: 11 })).toMatch(/target/)
    expect(checkRules(DEFAULT_RULES)).toBeNull()
  })
})
