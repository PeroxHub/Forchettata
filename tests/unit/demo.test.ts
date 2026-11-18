import { describe, expect, it } from 'vitest'
import { buildScenario } from '../../src/lib/demoScenarios'

const today = '2026-11-18'

describe('scenari dell’anteprima', () => {
  it('proposte: giro 3 aperto, Sara penalizzata, storico con un promosso e un bocciato', async () => {
    const b = await buildScenario('proposte', today)
    const s = await b.getState()
    expect(s.rounds.map((r) => [r.number, r.status, r.outcome])).toEqual([
      [3, 'proposals', null],
      [2, 'closed', 'failed'],
      [1, 'closed', 'promoted'],
    ])
    expect(s.rounds[0].proposals_count).toBe(4)
    expect(s.current?.my_proposals).toHaveLength(1)
    b.me = 'demo-sara'
    expect((await b.getState()).current?.propose_block_reason).toBe('penalty')
  })

  it('voto: Alex può votare, Giulia è la proponente', async () => {
    const b = await buildScenario('voto', today)
    const s = await b.getState()
    expect(s.rounds[0]).toMatchObject({ status: 'drawn', place_name: 'Ramen Kodama', votes_count: 2, dinner_date: today })
    expect(s.current).toMatchObject({ can_vote: true, voting_open: true, expected_voters: 5 })
    b.me = 'demo-giulia'
    expect((await b.getState()).current).toMatchObject({ is_proposer: true, vote_block_reason: 'proposer' })
    // un voto in più dall'anteprima
    b.me = 'demo-tu'
    await b.castVote(s.current!.round_id, { menu: 8, location: 8, conto: 7, servizio: 9 })
    expect((await b.getState()).rounds[0].votes_count).toBe(3)
  })

  it('promosso e bocciato: si apre il giro 4 con l’esito giusto', async () => {
    const p = await (await buildScenario('promosso', today)).getState()
    expect(p.rounds[1]).toMatchObject({ number: 3, outcome: 'promoted', proposer_id: 'demo-tu' })
    expect(p.my_penalties).toEqual([])
    const f = await (await buildScenario('bocciato', today)).getState()
    expect(f.rounds[1]).toMatchObject({ number: 3, outcome: 'failed', proposer_id: 'demo-tu' })
    expect(f.current?.propose_block_reason).toBe('penalty')
    expect(f.rounds[0].number).toBe(4)
  })
})
