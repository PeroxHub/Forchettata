/*
 * Motore dell'anteprima: replica in memoria le regole del database, così
 * si può provare il gioco con dati di esempio senza salvare niente.
 */
import { AppError, type Backend } from './backend'
import { addDays, isoWeekday } from './dates'
import { computeResults, isPromoted, isVotingOpen } from './game'
import type { Activity, GameState, ISODate, Member, Penalty, Round, Rules, Scores } from './types'

interface DProposal {
  id: string
  round_id: string
  user_id: string
  place_name: string
  notes: string | null
  created_at: string
  updated_at: string
}
interface DRound extends Round {
  drawn_proposal_id: string | null
}

let seq = 0
const uid = (p: string) => `${p}-${++seq}-${Math.random().toString(36).slice(2, 7)}`
const now = () => new Date().toISOString()
const fail = (msg: string): never => {
  throw new AppError(msg)
}

export class DemoBackend implements Backend {
  kind = 'demo' as const
  me: string
  today: ISODate
  group: { id: string; name: string; settings: Rules; invite: string }
  members: Member[] = []
  rounds: DRound[] = []
  proposals: DProposal[] = []
  availability: { round_id: string; user_id: string; days: ISODate[]; updated_at: string }[] = []
  votes: { round_id: string; user_id: string; scores: Scores; created_at: string; updated_at: string }[] = []
  penalties: (Penalty & { user_id: string })[] = []
  activity: Activity[] = []
  private listeners = new Set<() => void>()
  /** Per gli scenari: forza l'esito del prossimo sorteggio. */
  forceDraw: string | null = null

  constructor(opts: { today: ISODate; name: string; settings: Rules; me: string }) {
    this.today = opts.today
    this.me = opts.me
    this.group = { id: 'demo-group', name: opts.name, settings: structuredClone(opts.settings), invite: 'ANTEPRIMA' }
  }

  /* ---------------- utilità interne ---------------- */

  private notify() {
    for (const l of this.listeners) l()
  }
  private log(kind: string, details: Record<string, unknown> = {}, user: string | null = this.me) {
    this.activity.unshift({ id: this.activity.length + 1, at: now(), user_id: user, kind, details })
  }
  private member(u = this.me) {
    return this.members.find((m) => m.user_id === u && m.active)
  }
  private requireMember() {
    if (!this.member()) fail('Non fai parte di questo gruppo')
  }
  private requireAdmin() {
    this.requireMember()
    if (this.member()!.role !== 'admin') fail('Solo un organizzatore può farlo')
  }
  private round(id: string) {
    return this.rounds.find((r) => r.id === id) ?? fail('Giro inesistente')
  }
  private current() {
    return this.rounds.find((r) => r.status !== 'closed') ?? null
  }
  private hasPenalty(u: string, n: number, kind: Penalty['kind']) {
    return this.penalties.some((p) => p.user_id === u && p.kind === kind && n >= p.from_number && n <= p.to_number)
  }
  private proposerOf(r: DRound) {
    return this.proposals.find((p) => p.id === r.drawn_proposal_id)?.user_id ?? null
  }
  private expectedVoters(r: DRound) {
    const proposer = this.proposerOf(r)
    return this.members.filter(
      (m) => m.active && (r.rules.proposer_votes || m.user_id !== proposer) && !this.hasPenalty(m.user_id, r.number, 'no_vote'),
    ).length
  }
  private activeVotes(r: DRound) {
    return this.votes.filter((v) => v.round_id === r.id && this.member(v.user_id)).length
  }
  private refreshCounts(r: DRound) {
    r.proposals_count = this.proposals.filter((p) => p.round_id === r.id).length
    r.votes_count = this.votes.filter((v) => v.round_id === r.id).length
  }

  openRound(): DRound {
    const n = this.rounds.reduce((m, r) => Math.max(m, r.number), 0) + 1
    const rules = structuredClone(this.group.settings)
    const r: DRound = {
      id: uid('round'),
      number: n,
      status: 'proposals',
      rules,
      opened_at: now(),
      window_start: this.today,
      window_end: addDays(this.today, rules.availability_days - 1),
      proposals_count: 0,
      votes_count: 0,
      place_name: null,
      place_notes: null,
      drawn_at: null,
      dinner_date: null,
      voting_forced_open: false,
      closed_at: null,
      results: null,
      final_mean: null,
      outcome: null,
      proposer_id: null,
      drawn_proposal_id: null,
    }
    this.rounds.unshift(r)
    this.log('round_opened', { round_number: n }, null)
    return r
  }

  addMember(user_id: string, display_name: string, role: Member['role'] = 'player') {
    this.members.push({ user_id, display_name, avatar_url: null, role, active: true, joined_at: now() })
    this.log('joined', { first: role === 'admin' }, user_id)
  }

  as<T>(user: string, fn: () => T): T {
    const prev = this.me
    this.me = user
    try {
      return fn()
    } finally {
      this.me = prev
    }
  }

  private closeInternal(r: DRound, auto: boolean) {
    if (r.status !== 'drawn') fail('Questo giro non è in votazione')
    const proposer = this.proposerOf(r)
    let res
    try {
      res = computeResults(
        r.rules,
        this.votes.filter((v) => v.round_id === r.id),
        proposer,
      )
    } catch (e) {
      return fail((e as Error).message)
    }
    const promoted = isPromoted(res.final_mean, r.rules)
    r.status = 'closed'
    r.closed_at = now()
    r.results = { criteria: res.criteria, voters: res.voters }
    r.final_mean = res.final_mean
    r.outcome = promoted ? 'promoted' : 'failed'
    r.proposer_id = promoted || r.rules.reveal === 'always' ? proposer : null
    if (!promoted && r.rules.penalty !== 'none' && proposer) {
      this.penalties.push({
        user_id: proposer,
        kind: r.rules.penalty,
        from_number: r.number + 1,
        to_number: r.number + r.rules.penalty_rounds,
      })
    }
    this.log(
      'round_closed',
      { round_number: r.number, place_name: r.place_name, outcome: r.outcome, mean: r.final_mean, auto },
      auto ? null : this.me,
    )
    this.openRound()
    return { outcome: r.outcome, mean: res.final_mean }
  }

  /* ---------------- Backend ---------------- */

  async getUser() {
    const m = this.members.find((x) => x.user_id === this.me)
    return { id: this.me, email: null, name: m?.display_name ?? null }
  }
  onAuthChange() {
    return () => {}
  }
  async signInWithGoogle() {}
  async signInWithEmail() {}
  async verifyEmailCode() {}
  async signOut() {}

  async myGroups() {
    const m = this.member()
    return m ? [{ id: this.group.id, name: this.group.name, role: m.role }] : []
  }
  async joinGroup() {
    return this.group.id
  }
  async createGroup(): Promise<{ id: string; code: string }> {
    throw new AppError('Nell’anteprima non si possono creare gruppi.')
  }
  subscribe(_gid: string, onChange: () => void) {
    this.listeners.add(onChange)
    return () => {
      this.listeners.delete(onChange)
    }
  }
  async tick() {
    const r = this.current()
    if (!r || r.status !== 'drawn' || r.votes_count === 0) return false
    let due = false
    if (r.rules.voting_closes === 'days_after')
      due = r.dinner_date != null && this.today >= addDays(r.dinner_date, r.rules.close_after_days)
    else if (r.rules.voting_closes === 'all_voted') due = isVotingOpen(r, this.today) && this.activeVotes(r) >= this.expectedVoters(r)
    if (due) this.closeInternal(r, true)
    return due
  }

  async getState(): Promise<GameState> {
    this.requireMember()
    const me = this.member()!
    const cur = this.current()
    let current: GameState['current'] = null
    if (cur) {
      const proposer = this.proposerOf(cur)
      const isProp = cur.status !== 'proposals' && proposer === this.me
      const mine = this.proposals.filter((p) => p.round_id === cur.id && p.user_id === this.me)
      let propReason: NonNullable<GameState['current']>['propose_block_reason'] = null
      if (cur.status !== 'proposals') propReason = 'phase'
      else if (this.hasPenalty(this.me, cur.number, 'no_propose')) propReason = 'penalty'
      else if (mine.length >= cur.rules.proposals_per_person) propReason = 'limit'
      let voteReason: NonNullable<GameState['current']>['vote_block_reason'] = null
      if (cur.status !== 'drawn') voteReason = 'not_drawn'
      else if (isProp && !cur.rules.proposer_votes) voteReason = 'proposer'
      else if (this.hasPenalty(this.me, cur.number, 'no_vote')) voteReason = 'penalty'
      else if (!isVotingOpen(cur, this.today)) voteReason = 'not_open'
      const myVote = this.votes.find((v) => v.round_id === cur.id && v.user_id === this.me)
      current = {
        round_id: cur.id,
        is_proposer: isProp,
        can_propose: propReason == null,
        propose_block_reason: propReason,
        can_vote: voteReason == null,
        vote_block_reason: voteReason,
        voting_open: isVotingOpen(cur, this.today),
        expected_voters: cur.status === 'drawn' ? this.expectedVoters(cur) : null,
        rules_locked: cur.votes_count > 0,
        my_proposals: mine.map(({ id, place_name, notes, updated_at }) => ({ id, place_name, notes, updated_at })),
        my_vote: myVote ? { scores: { ...myVote.scores }, updated_at: myVote.updated_at } : null,
        availability: this.availability
          .filter((a) => a.round_id === cur.id)
          .map(({ user_id, days, updated_at }) => ({ user_id, days: [...days], updated_at })),
      }
    }
    return structuredClone({
      today: this.today,
      group: { id: this.group.id, name: this.group.name },
      settings: this.group.settings,
      me: { user_id: me.user_id, display_name: me.display_name, avatar_url: me.avatar_url, role: me.role },
      members: this.members,
      rounds: [...this.rounds].sort((a, b) => b.number - a.number).map(({ drawn_proposal_id: _hidden, ...r }) => r),
      current,
      my_drawn_round_ids: this.rounds.filter((r) => r.status !== 'proposals' && this.proposerOf(r) === this.me).map((r) => r.id),
      my_penalties: this.penalties
        .filter((p) => p.user_id === this.me)
        .map(({ kind, from_number, to_number }) => ({ kind, from_number, to_number })),
      activity: this.activity.slice(0, 150),
      invite_code: me.role === 'admin' ? this.group.invite : null,
    })
  }

  async saveProposal(roundId: string, place: string, notes: string | null, id?: string) {
    const r = this.round(roundId)
    this.requireMember()
    if (r.status !== 'proposals') fail('Le proposte sono chiuse: il sorteggio è già stato fatto')
    if (this.hasPenalty(this.me, r.number, 'no_propose')) fail('In questo giro non puoi proporre')
    const name = place.trim()
    if (!name) fail('Scrivi il nome del locale')
    const n = notes?.trim() || null
    if (!id) {
      const mine = this.proposals.filter((p) => p.round_id === roundId && p.user_id === this.me)
      if (mine.length >= r.rules.proposals_per_person) fail('Hai già messo in busta il numero massimo di proposte')
      const t = now()
      this.proposals.push({
        id: uid('prop'),
        round_id: roundId,
        user_id: this.me,
        place_name: name,
        notes: n,
        created_at: t,
        updated_at: t,
      })
    } else {
      const p = this.proposals.find((x) => x.id === id && x.round_id === roundId && x.user_id === this.me) ?? fail('Proposta non trovata')
      p.place_name = name
      p.notes = n
      p.updated_at = now()
    }
    this.refreshCounts(r)
    this.notify()
  }

  async deleteProposal(id: string) {
    const p = this.proposals.find((x) => x.id === id && x.user_id === this.me) ?? fail('Proposta non trovata')
    const r = this.round(p.round_id)
    if (r.status !== 'proposals') fail('Il sorteggio è già stato fatto: la busta non si può più ritirare')
    this.proposals = this.proposals.filter((x) => x.id !== id)
    this.refreshCounts(r)
    this.notify()
  }

  async saveAvailability(roundId: string, days: ISODate[]) {
    const r = this.round(roundId)
    this.requireMember()
    if (r.status === 'closed') fail('Questo giro è chiuso')
    const clean = [...new Set(days)]
      .filter((d) => d >= r.window_start && d <= r.window_end && r.rules.allowed_weekdays.includes(isoWeekday(d)))
      .sort()
    const row = this.availability.find((a) => a.round_id === roundId && a.user_id === this.me)
    if (row) {
      row.days = clean
      row.updated_at = now()
    } else this.availability.push({ round_id: roundId, user_id: this.me, days: clean, updated_at: now() })
    this.notify()
    return clean
  }

  async draw(roundId: string) {
    const r = this.round(roundId)
    this.requireAdmin()
    if (r.status !== 'proposals') fail('Il sorteggio di questo giro è già stato fatto')
    const pool = this.proposals.filter(
      (p) => p.round_id === roundId && this.member(p.user_id) && !this.hasPenalty(p.user_id, r.number, 'no_propose'),
    )
    if (pool.length === 0) fail('Non ci sono buste da sorteggiare')
    const p = pool.find((x) => x.id === this.forceDraw) ?? pool[Math.floor(Math.random() * pool.length)]
    this.forceDraw = null
    Object.assign(r, {
      status: 'drawn',
      drawn_proposal_id: p.id,
      place_name: p.place_name,
      place_notes: p.notes,
      drawn_at: now(),
    })
    this.log('drawn', { round_number: r.number, place_name: p.place_name, envelopes: r.proposals_count })
    this.notify()
    return p.place_name
  }

  async undoDraw(roundId: string, discard: boolean) {
    const r = this.round(roundId)
    this.requireAdmin()
    if (r.status !== 'drawn') fail('Non c’è un sorteggio da annullare')
    if (r.votes_count > 0) fail('Non si può annullare: qualcuno ha già votato')
    const drawn = r.drawn_proposal_id
    const place = r.place_name
    Object.assign(r, {
      status: 'proposals',
      drawn_proposal_id: null,
      place_name: null,
      place_notes: null,
      drawn_at: null,
      dinner_date: null,
      voting_forced_open: false,
    })
    if (discard) this.proposals = this.proposals.filter((p) => p.id !== drawn)
    this.refreshCounts(r)
    this.log('draw_undone', { round_number: r.number, place_name: place, discarded: discard })
    this.notify()
  }

  async setDinnerDate(roundId: string, date: ISODate | null) {
    const r = this.round(roundId)
    this.requireAdmin()
    if (r.status !== 'drawn') fail('La data si fissa dopo il sorteggio')
    r.dinner_date = date
    this.log('date_set', { round_number: r.number, date })
    this.notify()
  }

  async openVotingNow(roundId: string) {
    const r = this.round(roundId)
    this.requireAdmin()
    if (r.status !== 'drawn') fail('Il voto si apre dopo il sorteggio')
    r.voting_forced_open = true
    this.log('voting_opened', { round_number: r.number })
    this.notify()
  }

  async castVote(roundId: string, scores: Scores) {
    const r = this.round(roundId)
    this.requireMember()
    if (r.status !== 'drawn') fail('Questo giro non è in votazione')
    if (!isVotingOpen(r, this.today)) fail('Il voto non è ancora aperto')
    if (!r.rules.proposer_votes && this.proposerOf(r) === this.me) fail('È il tuo posto: stavolta giudicano gli altri')
    if (this.hasPenalty(this.me, r.number, 'no_vote')) fail('In questo giro non puoi votare')
    const clean: Scores = {}
    for (const c of r.rules.criteria) {
      const v = scores[c.key]
      if (typeof v !== 'number') fail(`Manca il voto per ${c.label}`)
      if (v < r.rules.scale_min || v > r.rules.scale_max || (v - r.rules.scale_min) % r.rules.scale_step !== 0)
        fail(`Voto non valido per ${c.label}: deve andare da ${r.rules.scale_min} a ${r.rules.scale_max}`)
      clean[c.key] = v
    }
    const row = this.votes.find((v) => v.round_id === roundId && v.user_id === this.me)
    if (row) {
      row.scores = clean
      row.updated_at = now()
    } else this.votes.push({ round_id: roundId, user_id: this.me, scores: clean, created_at: now(), updated_at: now() })
    this.refreshCounts(r)
    let result: { closed: boolean; outcome?: string; mean?: number } = { closed: false }
    if (r.rules.voting_closes === 'all_voted' && this.activeVotes(r) >= this.expectedVoters(r)) {
      result = { closed: true, ...this.closeInternal(r, true) }
    }
    this.notify()
    return result
  }

  async closeRound(roundId: string) {
    const r = this.round(roundId)
    this.requireAdmin()
    const res = this.closeInternal(r, false)
    this.notify()
    return res
  }

  async updateSettings(_gid: string, name: string, rules: Rules) {
    this.requireAdmin()
    const nm = name.trim()
    if (!nm || nm.length > 60) fail('Il nome del gruppo deve avere da 1 a 60 caratteri')
    const before = this.group.settings as unknown as Record<string, unknown>
    const after = structuredClone(rules) as unknown as Record<string, unknown>
    const changes: Record<string, { from: unknown; to: unknown }> = {}
    for (const k of Object.keys(after)) {
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changes[k] = { from: before[k], to: after[k] }
    }
    if (nm !== this.group.name) changes.name = { from: this.group.name, to: nm }
    if (Object.keys(changes).length === 0) return { changed: false, applied_to_current: false }
    this.group.settings = structuredClone(rules)
    this.group.name = nm
    const cur = this.current()
    let applied = false
    if (cur && cur.votes_count === 0 && Object.keys(changes).some((k) => k !== 'name')) {
      cur.rules = structuredClone(rules)
      cur.window_end = addDays(cur.window_start, rules.availability_days - 1)
      applied = true
    }
    this.log('rules_changed', { changes, applied_to_current: applied, round_number: cur?.number })
    this.notify()
    return { changed: true, applied_to_current: applied }
  }

  async updateProfile(_gid: string, name: string) {
    this.requireMember()
    const nm = name.trim()
    if (!nm || nm.length > 40) fail('Il nome deve avere da 1 a 40 caratteri')
    this.member()!.display_name = nm
    this.notify()
  }

  async setMemberRole(_gid: string, userId: string, role: Member['role']) {
    this.requireAdmin()
    const m = this.member(userId) ?? fail('Membro non trovato')
    if (m.role === role) return
    if (role === 'player' && this.members.filter((x) => x.active && x.role === 'admin').length <= 1) fail('Serve almeno un organizzatore')
    m.role = role
    this.log('role_changed', { member_id: userId, role })
    this.notify()
  }

  async removeMember(_gid: string, userId: string) {
    this.requireAdmin()
    const m = this.member(userId) ?? fail('Membro non trovato')
    if (m.role === 'admin' && this.members.filter((x) => x.active && x.role === 'admin').length <= 1)
      fail('Serve almeno un organizzatore: nominane un altro prima')
    m.active = false
    m.role = 'player'
    this.log('member_removed', { member_id: userId })
    this.notify()
  }

  async regenerateInvite() {
    this.requireAdmin()
    this.group.invite = Math.random().toString(36).slice(2, 10).toUpperCase()
    this.log('invite_regenerated')
    this.notify()
    return this.group.invite
  }
}
