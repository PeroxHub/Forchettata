import { DemoBackend } from './demoBackend'
import { addDays, eachDay, isoWeekday } from './dates'
import { DEFAULT_RULES } from './rules'
import type { ISODate } from './types'

export type ScenarioId = 'proposte' | 'voto' | 'tuo' | 'promosso' | 'bocciato'

export const SCENARIOS: { id: ScenarioId; label: string; hint: string }[] = [
  { id: 'proposte', label: 'Proposte', hint: 'Si raccolgono le buste e la disponibilità' },
  { id: 'voto', label: 'Cena e voto', hint: 'Posto estratto, data fissata, si vota' },
  { id: 'tuo', label: 'È il tuo posto', hint: 'Il posto estratto è il tuo: giudicano gli altri' },
  { id: 'promosso', label: 'Promosso', hint: 'Il tuo posto ha superato il target' },
  { id: 'bocciato', label: 'Bocciato', hint: 'Il tuo posto non ce l’ha fatta' },
]

export const DEMO_PLAYERS = [
  { id: 'demo-tu', name: 'Alex' },
  { id: 'demo-giulia', name: 'Giulia' },
  { id: 'demo-marco', name: 'Marco' },
  { id: 'demo-sara', name: 'Sara' },
  { id: 'demo-luca', name: 'Luca' },
  { id: 'demo-elena', name: 'Elena' },
]

const P: Record<string, string> = {
  tu: 'demo-tu',
  giulia: 'demo-giulia',
  marco: 'demo-marco',
  sara: 'demo-sara',
  luca: 'demo-luca',
  elena: 'demo-elena',
}
type V = [number, number, number, number]
const S = ([menu, location, conto, servizio]: V) => ({ menu, location, conto, servizio })

/** Esegue un'azione come un certo giocatore. */
async function as<T>(b: DemoBackend, who: string, fn: () => Promise<T>): Promise<T> {
  const prev = b.me
  b.me = P[who]
  try {
    return await fn()
  } finally {
    b.me = prev
  }
}

/** Data e ora fittizie per gli eventi registrati da `mark` in poi. */
function backdate(b: DemoBackend, mark: number, day: ISODate) {
  const n = b.activity.length - mark
  for (let i = 0; i < n; i++) b.activity[i].at = `${day}T21:${String(30 - i).padStart(2, '0')}:00`
}

async function pastRound(
  b: DemoBackend,
  dinner: ISODate,
  proposals: [string, string, string | null][],
  winner: string,
  votes: Record<string, V>,
) {
  const mark = b.activity.length
  const r = b.rounds[0]
  r.window_start = addDays(dinner, -40)
  r.window_end = addDays(dinner, 49)
  for (const [who, place, notes] of proposals) await as(b, who, () => b.saveProposal(r.id, place, notes))
  b.forceDraw = b.proposals.find((p) => p.round_id === r.id && p.user_id === P[winner])!.id
  await as(b, 'tu', () => b.draw(r.id))
  await as(b, 'tu', () => b.setDinnerDate(r.id, dinner))
  for (const [who, v] of Object.entries(votes)) await as(b, who, () => b.castVote(r.id, S(v)))
  await as(b, 'tu', () => b.closeRound(r.id))
  r.opened_at = `${addDays(dinner, -40)}T10:00:00`
  r.drawn_at = `${addDays(dinner, -12)}T21:00:00`
  r.closed_at = `${addDays(dinner, 2)}T22:00:00`
  backdate(b, mark, dinner)
}

/** Giorni liberi: certi giorni della settimana, saltando alcune settimane. */
function freeDays(b: DemoBackend, weekdays: number[], skip: (i: number) => boolean = () => false) {
  const r = b.rounds[0]
  return eachDay(r.window_start, r.window_end).filter((d, i) => weekdays.includes(isoWeekday(d)) && !skip(Math.floor(i / 7)))
}

export async function buildScenario(id: ScenarioId, today: ISODate): Promise<DemoBackend> {
  const b = new DemoBackend({
    today,
    name: 'Cena alla cieca',
    settings: { ...DEFAULT_RULES, prize: 'una cena offerta da tutti gli altri' },
    me: P.tu,
  })
  DEMO_PLAYERS.forEach((p, i) => b.addMember(p.id, p.name, i === 0 ? 'admin' : 'player'))
  b.openRound()

  // Giro 1: promosso (Marco)
  await pastRound(
    b,
    addDays(today, -61),
    [
      ['marco', 'Osteria del Ponte', 'Trippa e bollito misto. Prenotare il giorno prima.'],
      ['giulia', 'Pizzeria Il Forno', null],
      ['luca', 'Braceria Fumo', null],
    ],
    'marco',
    { tu: [8, 9, 7, 8], giulia: [9, 8, 7, 9], sara: [8, 8, 8, 8], luca: [7, 9, 6, 8], elena: [9, 9, 8, 9] },
  )
  // Giro 2: bocciato (Sara)
  await pastRound(
    b,
    addDays(today, -26),
    [
      ['sara', 'Sushi Zen', 'All you can eat, zona stazione'],
      ['elena', 'Trattoria La Pergola', null],
    ],
    'sara',
    { tu: [6, 7, 4, 6], giulia: [7, 6, 5, 7], marco: [6, 8, 5, 6], luca: [7, 7, 6, 6], elena: [6, 7, 5, 7] },
  )

  // Giro 3: in corso
  const r3 = b.rounds[0]
  const mark = b.activity.length
  await as(b, 'tu', () => b.saveProposal(r3.id, 'Trattoria da Nonna Rina', 'Via dei Mille 12 · tagliatelle al ragù e tiramisù'))
  await as(b, 'giulia', () => b.saveProposal(r3.id, 'Ramen Kodama', 'https://maps.google.com/?q=Ramen+Kodama'))
  await as(b, 'marco', () => b.saveProposal(r3.id, 'Il Gabbiano', 'Pesce, sul lungomare'))
  await as(b, 'luca', () => b.saveProposal(r3.id, 'Osteria Vecchia Bologna', null))
  await as(b, 'tu', () =>
    b.saveAvailability(
      r3.id,
      freeDays(b, [5, 6], (w) => w === 2),
    ),
  )
  await as(b, 'giulia', () =>
    b.saveAvailability(
      r3.id,
      freeDays(b, [4, 5, 6], (w) => w > 7),
    ),
  )
  await as(b, 'marco', () =>
    b.saveAvailability(
      r3.id,
      freeDays(b, [5, 6, 7], (w) => w === 4),
    ),
  )
  await as(b, 'sara', () => b.saveAvailability(r3.id, freeDays(b, [6, 7])))
  await as(b, 'luca', () =>
    b.saveAvailability(
      r3.id,
      freeDays(b, [3, 6], (w) => w < 1 || w === 6),
    ),
  )
  backdate(b, mark, addDays(today, -1))
  if (id === 'proposte') return b

  await as(b, 'elena', () =>
    b.saveAvailability(
      r3.id,
      freeDays(b, [5, 6], (w) => w === 9),
    ),
  )
  const winner = id === 'voto' ? 'giulia' : 'tu'
  b.forceDraw = b.proposals.find((p) => p.round_id === r3.id && p.user_id === P[winner])!.id
  await as(b, 'tu', () => b.draw(r3.id))
  await as(b, 'tu', () => b.setDinnerDate(r3.id, today))

  if (id === 'voto') {
    await as(b, 'marco', () => b.castVote(r3.id, S([8, 7, 7, 8])))
    await as(b, 'sara', () => b.castVote(r3.id, S([7, 8, 6, 7])))
    return b
  }
  await as(b, 'giulia', () => b.castVote(r3.id, S(id === 'bocciato' ? [6, 7, 5, 6] : [8, 9, 7, 8])))
  await as(b, 'marco', () => b.castVote(r3.id, S(id === 'bocciato' ? [7, 6, 5, 6] : [9, 8, 8, 8])))
  await as(b, 'luca', () => b.castVote(r3.id, S(id === 'bocciato' ? [6, 6, 6, 7] : [8, 8, 7, 9])))
  if (id === 'tuo') return b

  await as(b, 'sara', () => b.castVote(r3.id, S(id === 'bocciato' ? [6, 7, 6, 6] : [8, 8, 7, 8])))
  await as(b, 'elena', () => b.castVote(r3.id, S(id === 'bocciato' ? [7, 6, 5, 7] : [9, 8, 8, 8])))
  await as(b, 'tu', () => b.closeRound(r3.id))

  // Giro 4 appena aperto
  const r4 = b.rounds[0]
  await as(b, 'giulia', () => b.saveProposal(r4.id, 'Bistrot Lanterna', null))
  await as(b, 'sara', () => b.saveProposal(r4.id, 'Taverna dei Mercanti', null))
  await as(b, 'marco', () => b.saveAvailability(r4.id, freeDays(b, [5, 6])))
  return b
}
