import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, DATABASE_URL, sc, TestDb } from './helpers'

let db: TestDb
let drop: () => Promise<void>

beforeAll(async () => {
  if (!DATABASE_URL) return
  const t = await createTestDb()
  db = t.db
  drop = t.drop
}, 60_000)

afterAll(async () => {
  if (drop) await drop()
})

const NAMES = ['Anna', 'Bruno', 'Carla', 'Dario', 'Elena']

/** Porta il gruppo al voto: propone solo `proposer`, l'organizzatore sorteggia e fissa la data a oggi. */
async function toVoting(g: { gid: string; users: Record<string, string> }, proposer: string, admin = 'Anna') {
  const r = await db.currentRound(g.gid)
  await db.rpc(g.users[proposer], 'save_proposal', { p_round: r.id, p_place: `Da ${proposer}` })
  await db.rpc(g.users[admin], 'draw_round', { p_round: r.id })
  await db.rpc(g.users[admin], 'set_dinner_date', { p_round: r.id, p_date: await db.today() })
  return r.id as string
}

describe.skipIf(!DATABASE_URL)('database: regole del gioco', () => {
  it('ingresso nel gruppo: il primo è organizzatore e si apre il giro 1', async () => {
    const g = await db.groupWith(['Anna', 'Bruno'])
    const s = await db.state(g.users.Anna, g.gid)
    expect(s.me.role).toBe('admin')
    expect(s.members.map((m: any) => m.display_name)).toEqual(['Anna', 'Bruno'])
    expect(s.members[1].role).toBe('player')
    expect(s.rounds).toHaveLength(1)
    expect(s.rounds[0]).toMatchObject({ number: 1, status: 'proposals' })
    expect(s.current.can_propose).toBe(true)
    expect(s.invite_code).toBe(g.code)
    // il giocatore non vede il codice d'invito
    expect((await db.state(g.users.Bruno, g.gid)).invite_code).toBeNull()
    // rientrare è innocuo
    await db.rpc(g.users.Bruno, 'join_group', { p_code: g.code.toLowerCase() })
    expect(await db.rpc(g.users.Bruno, 'my_groups')).toEqual([{ id: g.gid, name: 'Test', role: 'player' }])
  })

  it('codice sbagliato, estranei e anonimi vengono respinti', async () => {
    const g = await db.groupWith(['Anna'])
    const stranger = await db.createUser('Zeno')
    await expect(db.rpc(stranger, 'join_group', { p_code: 'NOPE' })).rejects.toThrow(/Codice d'invito non valido/)
    await expect(db.state(stranger, g.gid)).rejects.toThrow(/Non fai parte/)
    await expect(db.rpc(null, 'get_state', { p_group: g.gid }, 'anon')).rejects.toThrow(/permission denied/)
    await expect(db.asUser(stranger, 'select * from public.rounds')).resolves.toHaveLength(0)
  })

  it('le proposte restano segrete: ognuno vede solo la sua', async () => {
    const g = await db.groupWith(['Anna', 'Bruno', 'Carla'])
    const r = await db.currentRound(g.gid)
    const pid = await db.rpc(g.users.Bruno, 'save_proposal', { p_round: r.id, p_place: 'Osteria Segreta', p_notes: 'via Roma 1' })
    await db.rpc(g.users.Carla, 'save_proposal', { p_round: r.id, p_place: 'Pizzeria' })
    // limite di 1 proposta a testa
    await expect(db.rpc(g.users.Bruno, 'save_proposal', { p_round: r.id, p_place: 'Altra' })).rejects.toThrow(/numero massimo/)
    // modifica della propria
    await db.rpc(g.users.Bruno, 'save_proposal', { p_round: r.id, p_place: 'Osteria Segretissima', p_id: pid })

    const sa = await db.state(g.users.Anna, g.gid)
    expect(sa.rounds[0].proposals_count).toBe(2)
    expect(sa.current.my_proposals).toEqual([])
    expect(JSON.stringify(sa)).not.toContain('Osteria')
    const sb = await db.state(g.users.Bruno, g.gid)
    expect(sb.current.my_proposals).toHaveLength(1)
    expect(sb.current.my_proposals[0].place_name).toBe('Osteria Segretissima')

    // accesso diretto alle tabelle
    expect(await db.asUser(g.users.Anna, 'select * from public.proposals')).toHaveLength(0)
    expect(await db.asUser(g.users.Bruno, 'select * from public.proposals')).toHaveLength(1)
    await expect(
      db.asUser(g.users.Anna, `insert into public.proposals (round_id, group_id, user_id, place_name) values ($1, $2, $3, 'x')`, [
        r.id,
        g.gid,
        g.users.Anna,
      ]),
    ).rejects.toThrow(/permission denied/)
    await expect(db.asUser(g.users.Anna, `update public.rounds set status = 'closed'`)).rejects.toThrow(/permission denied/)
    // non si può modificare la busta di un altro
    await expect(db.rpc(g.users.Anna, 'save_proposal', { p_round: r.id, p_place: 'hack', p_id: pid })).rejects.toThrow(/non trovata/)
  })

  it('disponibilità: tiene solo giorni nella finestra e nei giorni ammessi', async () => {
    const g = await db.groupWith(['Anna', 'Bruno'], { allowed_weekdays: [5, 6], availability_days: 30 })
    const r = await db.currentRound(g.gid)
    const days: string[] = (await db.sql(`select (private.today() + i)::text as d from generate_series(-3, 40) i`)).map((x) => x.d)
    const saved: string[] = await db.rpc(g.users.Bruno, 'save_availability', { p_round: r.id, p_days: days })
    const [{ ok }] = await db.sql(
      `select bool_and(d between $1::date and $2::date and extract(isodow from d) in (5, 6)) as ok from unnest($3::date[]) d`,
      [r.window_start, r.window_end, saved],
    )
    expect(ok).toBe(true)
    expect(saved.length).toBeGreaterThanOrEqual(8)
    expect(saved.length).toBeLessThanOrEqual(10)
    const sa = await db.state(g.users.Anna, g.gid)
    expect(sa.current.availability).toHaveLength(1)
    expect(sa.current.availability[0].user_id).toBe(g.users.Bruno)
  })

  it('sorteggio: solo l’organizzatore, e il proponente lo sa solo lui', async () => {
    const g = await db.groupWith(['Anna', 'Bruno', 'Carla'])
    const r = await db.currentRound(g.gid)
    await expect(db.rpc(g.users.Anna, 'draw_round', { p_round: r.id })).rejects.toThrow(/Non ci sono buste/)
    await db.rpc(g.users.Carla, 'save_proposal', { p_round: r.id, p_place: 'Trattoria Carla' })
    await expect(db.rpc(g.users.Bruno, 'draw_round', { p_round: r.id })).rejects.toThrow(/organizzatore/)
    expect(await db.rpc(g.users.Anna, 'draw_round', { p_round: r.id })).toBe('Trattoria Carla')

    const sc_ = await db.state(g.users.Carla, g.gid)
    const sb = await db.state(g.users.Bruno, g.gid)
    expect(sc_.current.is_proposer).toBe(true)
    expect(sc_.my_drawn_round_ids).toEqual([r.id])
    expect(sb.current.is_proposer).toBe(false)
    expect(sb.my_drawn_round_ids).toEqual([])
    expect(sb.rounds[0].place_name).toBe('Trattoria Carla')
    expect(sb.rounds[0].proposer_id).toBeNull()
    // dopo il sorteggio non si propone più
    await expect(db.rpc(g.users.Bruno, 'save_proposal', { p_round: r.id, p_place: 'Tardi' })).rejects.toThrow(/chiuse/)
    expect(sb.current.propose_block_reason).toBe('phase')
    // il registro attribuisce il sorteggio all'organizzatore, non al proponente
    const drawn = sb.activity.find((a: any) => a.kind === 'drawn')
    expect(drawn.user_id).toBe(g.users.Anna)
    expect(JSON.stringify(drawn.details)).not.toContain(g.users.Carla)
  })

  it('voto: si apre il giorno della cena, il proponente non vota, i voti restano privati', async () => {
    const g = await db.groupWith(['Anna', 'Bruno', 'Carla'])
    const r = await db.currentRound(g.gid)
    await db.rpc(g.users.Carla, 'save_proposal', { p_round: r.id, p_place: 'Da Carla' })
    await db.rpc(g.users.Anna, 'draw_round', { p_round: r.id })
    // data nel futuro: voto chiuso
    const [{ d }] = await db.sql(`select (private.today() + 5)::text as d`)
    await db.rpc(g.users.Anna, 'set_dinner_date', { p_round: r.id, p_date: d })
    let sb = await db.state(g.users.Bruno, g.gid)
    expect(sb.current.voting_open).toBe(false)
    expect(sb.current.vote_block_reason).toBe('not_open')
    await expect(db.rpc(g.users.Bruno, 'cast_vote', { p_round: r.id, p_scores: sc(8, 8, 8, 8) })).rejects.toThrow(/non è ancora aperto/)
    // l'organizzatore lo apre prima
    await db.rpc(g.users.Anna, 'open_voting_now', { p_round: r.id })
    sb = await db.state(g.users.Bruno, g.gid)
    expect(sb.current.can_vote).toBe(true)
    expect(sb.current.expected_voters).toBe(2)

    const scC = await db.state(g.users.Carla, g.gid)
    expect(scC.current.vote_block_reason).toBe('proposer')
    await expect(db.rpc(g.users.Carla, 'cast_vote', { p_round: r.id, p_scores: sc(10, 10, 10, 10) })).rejects.toThrow(/tuo posto/)

    // voti non validi
    await expect(db.rpc(g.users.Bruno, 'cast_vote', { p_round: r.id, p_scores: { menu: 8 } })).rejects.toThrow(/Manca il voto/)
    await expect(db.rpc(g.users.Bruno, 'cast_vote', { p_round: r.id, p_scores: sc(11, 8, 8, 8) })).rejects.toThrow(/non valido/)
    await expect(db.rpc(g.users.Bruno, 'cast_vote', { p_round: r.id, p_scores: sc(7.5, 8, 8, 8) })).rejects.toThrow(/non valido/)

    expect(await db.rpc(g.users.Bruno, 'cast_vote', { p_round: r.id, p_scores: { ...sc(8, 7, 6, 9), extra: 3 } })).toEqual({
      closed: false,
    })
    await db.rpc(g.users.Bruno, 'cast_vote', { p_round: r.id, p_scores: sc(9, 7, 6, 9) }) // cambia idea
    const sa = await db.state(g.users.Anna, g.gid)
    expect(sa.rounds[0].votes_count).toBe(1)
    expect(sa.current.my_vote).toBeNull()
    expect(sa.rounds[0].final_mean).toBeNull()
    expect(await db.asUser(g.users.Anna, 'select * from public.votes')).toHaveLength(0)
    const mine = await db.asUser(g.users.Bruno, 'select scores from public.votes')
    expect(mine[0].scores).toEqual(sc(9, 7, 6, 9))
    // il sorteggio non si annulla dopo un voto
    await expect(db.rpc(g.users.Anna, 'undo_draw', { p_round: r.id })).rejects.toThrow(/già votato/)
  })

  it('verdetto bocciato: si rivela il proponente, che al giro dopo non propone ma vota', async () => {
    const g = await db.groupWith(['Anna', 'Bruno', 'Carla'])
    const rid = await toVoting(g, 'Carla')
    await db.rpc(g.users.Anna, 'cast_vote', { p_round: rid, p_scores: sc(6, 7, 5, 6) })
    await db.rpc(g.users.Bruno, 'cast_vote', { p_round: rid, p_scores: sc(7, 6, 6, 7) })
    await expect(db.rpc(g.users.Bruno, 'close_round', { p_round: rid })).rejects.toThrow(/organizzatore/)
    const res = await db.rpc(g.users.Anna, 'close_round', { p_round: rid })
    expect(res).toEqual({ outcome: 'failed', mean: 6.25 })

    const sb = await db.state(g.users.Bruno, g.gid)
    const closed = sb.rounds.find((x: any) => x.id === rid)
    expect(closed).toMatchObject({ status: 'closed', outcome: 'failed', proposer_id: g.users.Carla })
    expect(Number(closed.final_mean)).toBe(6.25)
    expect(closed.results.criteria.map((c: any) => [c.key, Number(c.avg)])).toEqual([
      ['menu', 6.5],
      ['location', 6.5],
      ['conto', 5.5],
      ['servizio', 6.5],
    ])
    expect(closed.results.voters).toBe(2)
    // nuovo giro aperto
    expect(sb.rounds[0]).toMatchObject({ number: 2, status: 'proposals' })

    // Carla è penalizzata nel giro 2
    const sCarla = await db.state(g.users.Carla, g.gid)
    expect(sCarla.my_penalties).toEqual([{ kind: 'no_propose', from_number: 2, to_number: 2 }])
    expect(sCarla.current.can_propose).toBe(false)
    expect(sCarla.current.propose_block_reason).toBe('penalty')
    const r2 = sb.rounds[0].id
    await expect(db.rpc(g.users.Carla, 'save_proposal', { p_round: r2, p_place: 'Ancora io' })).rejects.toThrow(/non puoi proporre/)
    await db.rpc(g.users.Carla, 'save_availability', { p_round: r2, p_days: [await db.today()] })
    // gli altri non vedono le penalità altrui
    expect(sb.my_penalties).toEqual([])
    expect(await db.asUser(g.users.Bruno, 'select * from public.penalties')).toHaveLength(0)

    // giro 2: propone Bruno, Carla vota
    await toVoting(g, 'Bruno')
    const sCarla2 = await db.state(g.users.Carla, g.gid)
    expect(sCarla2.current.can_vote).toBe(true)
    await db.rpc(g.users.Carla, 'cast_vote', { p_round: r2, p_scores: sc(9, 9, 9, 9) })
    await db.rpc(g.users.Anna, 'cast_vote', { p_round: r2, p_scores: sc(8, 8, 8, 8) })
    expect(await db.rpc(g.users.Anna, 'close_round', { p_round: r2 })).toEqual({ outcome: 'promoted', mean: 8.5 })
    // al giro 3 Carla può di nuovo proporre
    const sCarla3 = await db.state(g.users.Carla, g.gid)
    expect(sCarla3.rounds[0].number).toBe(3)
    expect(sCarla3.current.can_propose).toBe(true)
  })

  it('target: "superiore" e "almeno uguale" con media esattamente uguale', async () => {
    for (const [mode, outcome] of [
      ['gt', 'failed'],
      ['gte', 'promoted'],
    ] as const) {
      const g = await db.groupWith(['Anna', 'Bruno'], { target: 7, target_mode: mode })
      const rid = await toVoting(g, 'Bruno')
      await db.rpc(g.users.Anna, 'cast_vote', { p_round: rid, p_scores: sc(7, 7, 6, 8) })
      expect((await db.rpc(g.users.Anna, 'close_round', { p_round: rid })).outcome).toBe(outcome)
    }
  })

  it('pesi, mezzi punti e scarto degli estremi', async () => {
    const g = await db.groupWith(NAMES.concat('Fabio'), {
      criteria: [
        { key: 'cibo', label: 'Cibo', weight: 2 },
        { key: 'prezzo', label: 'Prezzo', weight: 1 },
      ],
      scale_step: 0.5,
      trim_extremes: true,
    })
    const rid = await toVoting(g, 'Fabio')
    const votes: Array<[string, number, number]> = [
      ['Anna', 10, 4],
      ['Bruno', 7.5, 6],
      ['Carla', 7, 6.5],
      ['Dario', 6.5, 7],
      ['Elena', 2, 9],
    ]
    for (const [n, cibo, prezzo] of votes) {
      await db.rpc(g.users[n], 'cast_vote', { p_round: rid, p_scores: { cibo, prezzo } })
    }
    const res = await db.rpc(g.users.Anna, 'close_round', { p_round: rid })
    // cibo: scarta 2 e 10 -> media(6.5, 7, 7.5) = 7 ; prezzo: scarta 4 e 9 -> media(6, 6.5, 7) = 6.5
    // finale pesata: (2*7 + 1*6.5) / 3 = 6.83
    expect(res).toEqual({ outcome: 'failed', mean: 6.83 })
    const [r] = await db.sql('select results from public.rounds where id = $1', [rid])
    expect(r.results.criteria.every((c: any) => c.trimmed && c.n === 5)).toBe(true)
  })

  it('con meno di 5 votanti non si scarta niente', async () => {
    const g = await db.groupWith(['Anna', 'Bruno', 'Carla', 'Dario'], { trim_extremes: true })
    const rid = await toVoting(g, 'Dario')
    await db.rpc(g.users.Anna, 'cast_vote', { p_round: rid, p_scores: sc(10, 10, 10, 10) })
    await db.rpc(g.users.Bruno, 'cast_vote', { p_round: rid, p_scores: sc(2, 2, 2, 2) })
    await db.rpc(g.users.Carla, 'cast_vote', { p_round: rid, p_scores: sc(6, 6, 6, 6) })
    expect((await db.rpc(g.users.Anna, 'close_round', { p_round: rid })).mean).toBe(6)
  })

  it('rivelazione "solo se promosso": il bocciato resta anonimo', async () => {
    const g = await db.groupWith(['Anna', 'Bruno'], { reveal: 'winner_only' })
    const rid = await toVoting(g, 'Bruno')
    await db.rpc(g.users.Anna, 'cast_vote', { p_round: rid, p_scores: sc(3, 3, 3, 3) })
    await db.rpc(g.users.Anna, 'close_round', { p_round: rid })
    const sa = await db.state(g.users.Anna, g.gid)
    expect(sa.rounds[1]).toMatchObject({ outcome: 'failed', proposer_id: null })
    // ma lui lo sa, e la penalità gli si applica
    const sb = await db.state(g.users.Bruno, g.gid)
    expect(sb.my_drawn_round_ids).toEqual([rid])
    expect(sb.current.propose_block_reason).toBe('penalty')

    // promosso: si rivela comunque
    const rid2 = await toVoting(g, 'Anna')
    await db.rpc(g.users.Bruno, 'cast_vote', { p_round: rid2, p_scores: sc(9, 9, 9, 9) })
    await db.rpc(g.users.Anna, 'close_round', { p_round: rid2 })
    const sa2 = await db.state(g.users.Anna, g.gid)
    expect(sa2.rounds[1]).toMatchObject({ outcome: 'promoted', proposer_id: g.users.Anna })
  })

  it('penalità "non vota" per due giri e proponente che vota', async () => {
    const g = await db.groupWith(['Anna', 'Bruno', 'Carla'], { penalty: 'no_vote', penalty_rounds: 2 })
    const rid = await toVoting(g, 'Carla')
    await db.rpc(g.users.Anna, 'cast_vote', { p_round: rid, p_scores: sc(4, 4, 4, 4) })
    await db.rpc(g.users.Anna, 'close_round', { p_round: rid })
    for (const n of [2, 3]) {
      const r = await db.currentRound(g.gid)
      expect(r.number).toBe(n)
      await toVoting(g, 'Bruno')
      const s = await db.state(g.users.Carla, g.gid)
      expect(s.current.vote_block_reason).toBe('penalty')
      expect(s.current.expected_voters).toBe(1) // solo Anna: Bruno propone, Carla penalizzata
      await expect(db.rpc(g.users.Carla, 'cast_vote', { p_round: r.id, p_scores: sc(9, 9, 9, 9) })).rejects.toThrow(/non puoi votare/)
      await db.rpc(g.users.Anna, 'cast_vote', { p_round: r.id, p_scores: sc(9, 9, 9, 9) })
      await db.rpc(g.users.Anna, 'close_round', { p_round: r.id })
    }
    // giro 4: Carla vota di nuovo; e ora il proponente vota
    const s4 = await db.currentRound(g.gid)
    await db.rpc(g.users.Anna, 'update_settings', {
      p_group: g.gid,
      p_name: 'Test',
      p_rules: { ...(await db.state(g.users.Anna, g.gid)).settings, proposer_votes: true },
    })
    await toVoting(g, 'Bruno')
    expect((await db.state(g.users.Carla, g.gid)).current.can_vote).toBe(true)
    expect((await db.state(g.users.Bruno, g.gid)).current.can_vote).toBe(true)
    await db.rpc(g.users.Bruno, 'cast_vote', { p_round: s4.id, p_scores: sc(10, 10, 10, 10) })
    await db.rpc(g.users.Carla, 'cast_vote', { p_round: s4.id, p_scores: sc(6, 6, 6, 6) })
    const res = await db.rpc(g.users.Anna, 'close_round', { p_round: s4.id })
    expect(res).toEqual({ outcome: 'promoted', mean: 8 })
  })

  it('chiusura automatica quando hanno votato tutti', async () => {
    const g = await db.groupWith(['Anna', 'Bruno', 'Carla'], { voting_closes: 'all_voted', voting_opens: 'after_draw' })
    const r = await db.currentRound(g.gid)
    await db.rpc(g.users.Bruno, 'save_proposal', { p_round: r.id, p_place: 'Da Bruno' })
    await db.rpc(g.users.Anna, 'draw_round', { p_round: r.id })
    // si vota subito dopo il sorteggio, anche senza data
    expect(await db.rpc(g.users.Anna, 'cast_vote', { p_round: r.id, p_scores: sc(8, 8, 8, 8) })).toEqual({ closed: false })
    expect(await db.rpc(g.users.Carla, 'cast_vote', { p_round: r.id, p_scores: sc(9, 9, 9, 9) })).toEqual({
      closed: true,
      outcome: 'promoted',
      mean: 8.5,
    })
    const s = await db.state(g.users.Anna, g.gid)
    expect(s.activity[1]).toMatchObject({ kind: 'round_closed', user_id: null })
    expect(s.activity[1].details.auto).toBe(true)
  })

  it('chiusura automatica N giorni dopo la cena', async () => {
    const g = await db.groupWith(['Anna', 'Bruno'], { voting_closes: 'days_after', close_after_days: 2 })
    const rid = await toVoting(g, 'Bruno')
    await db.rpc(g.users.Anna, 'cast_vote', { p_round: rid, p_scores: sc(8, 8, 8, 8) })
    expect(await db.rpc(g.users.Bruno, 'tick', { p_group: g.gid })).toBe(false)
    const [{ d }] = await db.sql(`select (private.today() - 2)::text as d`)
    await db.rpc(g.users.Anna, 'set_dinner_date', { p_round: rid, p_date: d })
    expect(await db.rpc(g.users.Bruno, 'tick', { p_group: g.gid })).toBe(true)
    expect((await db.currentRound(g.gid)).number).toBe(2)
  })

  it('regole: validazione, effetto sul giro in corso solo senza voti, registro visibile a tutti', async () => {
    const g = await db.groupWith(['Anna', 'Bruno'])
    const base = (await db.state(g.users.Anna, g.gid)).settings
    const upd = (rules: any, user = g.users.Anna) => db.rpc(user, 'update_settings', { p_group: g.gid, p_name: 'Test', p_rules: rules })

    await expect(upd({ ...base, target: 12 })).rejects.toThrow(/target deve essere compreso/)
    await expect(upd({ ...base, criteria: [] })).rejects.toThrow(/da 1 a 8 voci/)
    await expect(
      upd({
        ...base,
        criteria: [
          { key: 'a', label: 'A', weight: 1 },
          { key: 'a', label: 'B', weight: 1 },
        ],
      }),
    ).rejects.toThrow(/stesso codice/)
    await expect(upd({ ...base, allowed_weekdays: [] })).rejects.toThrow(/almeno un giorno/)
    await expect(upd({ ...base, target_mode: null })).rejects.toThrow(/Confronto/)
    await expect(upd({ ...base, scale_step: 'x' })).rejects.toThrow(/Regole non valide|passo/)
    await expect(upd({ ...base, prize: 'Cena pagata' }, g.users.Bruno)).rejects.toThrow(/organizzatore/)

    expect(await upd({ ...base })).toEqual({ changed: false, applied_to_current: false })
    expect(await upd({ ...base, prize: 'Cena pagata', availability_days: 30 })).toEqual({ changed: true, applied_to_current: true })
    const r1 = await db.currentRound(g.gid)
    expect(r1.rules.prize).toBe('Cena pagata')
    const [{ diff }] = await db.sql('select (window_end - window_start) as diff from public.rounds where id = $1', [r1.id])
    expect(diff).toBe(29)

    // dopo il primo voto il giro in corso non cambia più
    await toVoting(g, 'Bruno')
    await db.rpc(g.users.Anna, 'cast_vote', { p_round: r1.id, p_scores: sc(8, 8, 8, 8) })
    expect(await upd({ ...base, prize: 'Cena pagata', availability_days: 30, target: 9 })).toEqual({
      changed: true,
      applied_to_current: false,
    })
    expect((await db.currentRound(g.gid)).rules.target).toBe(7)
    await db.rpc(g.users.Anna, 'close_round', { p_round: r1.id })
    expect((await db.currentRound(g.gid)).rules.target).toBe(9)

    const sb = await db.state(g.users.Bruno, g.gid)
    const log = sb.activity.filter((a: any) => a.kind === 'rules_changed')
    expect(log).toHaveLength(2)
    expect(log[0].details.changes.target).toEqual({ from: 7, to: 9 })
    expect(log[0].details.applied_to_current).toBe(false)
  })

  it('annullare il sorteggio, anche scartando il locale', async () => {
    const g = await db.groupWith(['Anna', 'Bruno'])
    const r = await db.currentRound(g.gid)
    await db.rpc(g.users.Bruno, 'save_proposal', { p_round: r.id, p_place: 'Chiuso per ferie' })
    await db.rpc(g.users.Anna, 'draw_round', { p_round: r.id })
    await db.rpc(g.users.Anna, 'undo_draw', { p_round: r.id, p_discard: true })
    const s = await db.state(g.users.Bruno, g.gid)
    expect(s.rounds[0]).toMatchObject({ status: 'proposals', place_name: null, proposals_count: 0 })
    expect(s.current.my_proposals).toEqual([])
    expect(s.current.can_propose).toBe(true)
  })

  it('membri: ruoli, rimozione e rientro', async () => {
    const g = await db.groupWith(['Anna', 'Bruno', 'Carla'])
    await expect(db.rpc(g.users.Anna, 'set_member_role', { p_group: g.gid, p_user: g.users.Anna, p_role: 'player' })).rejects.toThrow(
      /almeno un organizzatore/,
    )
    await db.rpc(g.users.Anna, 'set_member_role', { p_group: g.gid, p_user: g.users.Bruno, p_role: 'admin' })
    await db.rpc(g.users.Bruno, 'set_member_role', { p_group: g.gid, p_user: g.users.Anna, p_role: 'player' })
    expect((await db.state(g.users.Anna, g.gid)).me.role).toBe('player')

    await db.rpc(g.users.Bruno, 'remove_member', { p_group: g.gid, p_user: g.users.Carla })
    await expect(db.state(g.users.Carla, g.gid)).rejects.toThrow(/Non fai parte/)
    expect(await db.asUser(g.users.Carla, 'select * from public.members')).toHaveLength(0)
    const s = await db.state(g.users.Bruno, g.gid)
    expect(s.members.find((m: any) => m.user_id === g.users.Carla).active).toBe(false)

    // nuovo codice: il vecchio non vale più
    const code = await db.rpc(g.users.Bruno, 'regenerate_invite', { p_group: g.gid })
    await expect(db.rpc(g.users.Carla, 'join_group', { p_code: g.code })).rejects.toThrow(/non valido/)
    await db.rpc(g.users.Carla, 'join_group', { p_code: code })
    expect((await db.state(g.users.Carla, g.gid)).me.role).toBe('player')

    await db.rpc(g.users.Carla, 'update_profile', { p_group: g.gid, p_name: '  Carlotta ' })
    expect((await db.state(g.users.Carla, g.gid)).me.display_name).toBe('Carlotta')
  })

  it('creare un gruppo nuovo: chi lo crea è organizzatore, gli altri entrano col codice', async () => {
    const zoe = await db.createUser('Zoe')
    const res = await db.rpc(zoe, 'create_group', { p_name: '  Cene del giovedì ' })
    expect(res.code).toMatch(/^[A-Z2-9]{8}$/)
    const s = await db.state(zoe, res.id)
    expect(s.group.name).toBe('Cene del giovedì')
    expect(s.me.role).toBe('admin')
    expect(s.rounds).toHaveLength(1)
    expect(s.invite_code).toBe(res.code)
    const ugo = await db.createUser('Ugo')
    await db.rpc(ugo, 'join_group', { p_code: res.code })
    expect((await db.state(ugo, res.id)).me.role).toBe('player')
    // i gruppi sono separati
    const g = await db.groupWith(['Anna'])
    await expect(db.state(zoe, g.gid)).rejects.toThrow(/Non fai parte/)
    expect((await db.rpc(zoe, 'my_groups')).map((x: any) => x.name)).toEqual(['Cene del giovedì'])
    await expect(db.rpc(zoe, 'create_group', { p_name: '' })).rejects.toThrow(/da 1 a 60/)
    await expect(db.rpc(null, 'create_group', { p_name: 'x' }, 'anon')).rejects.toThrow(/permission denied/)
    for (let i = 0; i < 9; i++) await db.rpc(zoe, 'create_group', { p_name: `G${i}` })
    await expect(db.rpc(zoe, 'create_group', { p_name: 'Troppi' })).rejects.toThrow(/massimo/)
  })

  it('le funzioni interne non sono chiamabili dagli utenti', async () => {
    const g = await db.groupWith(['Anna'])
    const r = await db.currentRound(g.gid)
    await expect(db.asUser(g.users.Anna, 'select private.close_round_internal($1, false)', [r.id])).rejects.toThrow(/permission denied/)
    await expect(db.asUser(g.users.Anna, 'select private.round_proposer($1)', [r.id])).rejects.toThrow(/permission denied/)
  })
})
