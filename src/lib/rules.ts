import type { Criterion, Rules } from './types'
import { WEEKDAYS_SHORT } from './dates'
import { fmtNum } from './format'

export const DEFAULT_RULES: Rules = {
  target: 7,
  target_mode: 'gt',
  prize: '',
  reveal: 'always',
  penalty: 'no_propose',
  penalty_rounds: 1,
  criteria: [
    { key: 'menu', label: 'Menu', weight: 1 },
    { key: 'location', label: 'Location', weight: 1 },
    { key: 'conto', label: 'Conto', weight: 1 },
    { key: 'servizio', label: 'Servizio', weight: 1 },
  ],
  scale_min: 1,
  scale_max: 10,
  scale_step: 1,
  proposer_votes: false,
  trim_extremes: false,
  voting_opens: 'dinner_day',
  voting_closes: 'manual',
  close_after_days: 3,
  proposals_per_person: 1,
  availability_days: 90,
  allowed_weekdays: [1, 2, 3, 4, 5, 6, 7],
}

export const TARGET_MODE_LABEL: Record<Rules['target_mode'], string> = {
  gt: 'superiore al target',
  gte: 'almeno uguale al target',
}
export const REVEAL_LABEL: Record<Rules['reveal'], string> = {
  always: 'sempre, al verdetto',
  winner_only: 'solo se il posto è promosso',
}
export const PENALTY_LABEL: Record<Rules['penalty'], string> = {
  no_propose: 'non può proporre',
  no_vote: 'non può votare',
  none: 'nessuna penalità',
}
export const OPENS_LABEL: Record<Rules['voting_opens'], string> = {
  after_draw: 'subito dopo il sorteggio',
  dinner_day: 'dal giorno della cena',
}
export const CLOSES_LABEL: Record<Rules['voting_closes'], string> = {
  manual: 'a mano, dall’organizzatore',
  all_voted: 'da sola, quando hanno votato tutti',
  days_after: 'da sola, qualche giorno dopo la cena',
}

export function weekdaysText(days: number[]): string {
  const s = [...days].sort((a, b) => a - b)
  if (s.length === 7) return 'tutti i giorni'
  if (s.join() === '1,2,3,4,5') return 'dal lunedì al venerdì'
  if (s.join() === '6,7') return 'solo nel weekend'
  return s.map((d) => WEEKDAYS_SHORT[d - 1]).join(', ')
}

export function criteriaText(c: Criterion[]): string {
  const equal = c.every((x) => x.weight === c[0].weight)
  return c.map((x) => (equal ? x.label : `${x.label} ×${fmtNum(x.weight)}`)).join(', ')
}

export function scaleText(r: Rules): string {
  return `da ${r.scale_min} a ${r.scale_max}${r.scale_step === 0.5 ? ', anche mezzi punti' : ''}`
}

export function closesText(r: Rules): string {
  if (r.voting_closes === 'days_after')
    return `da sola, ${r.close_after_days} ${r.close_after_days === 1 ? 'giorno' : 'giorni'} dopo la cena`
  return CLOSES_LABEL[r.voting_closes]
}

export function penaltyText(r: Rules): string {
  if (r.penalty === 'none') return 'Nessuna penalità per chi viene bocciato.'
  const giri = r.penalty_rounds === 1 ? 'al giro successivo' : `per i ${r.penalty_rounds} giri successivi`
  return r.penalty === 'no_propose'
    ? `Chi viene bocciato ${giri} non può proporre, ma vota e segna la disponibilità come tutti.`
    : `Chi viene bocciato ${giri} non può votare, ma propone e segna la disponibilità come tutti.`
}

/** La penalità detta a chi l'ha appena presa. */
export function myPenaltyText(r: Rules): string {
  if (r.penalty === 'none') return 'Nessuna penalità, per stavolta.'
  const giri = r.penalty_rounds === 1 ? 'Al giro successivo' : `Per i prossimi ${r.penalty_rounds} giri`
  return r.penalty === 'no_propose'
    ? `${giri} non puoi proporre, ma voti e segni la disponibilità come tutti.`
    : `${giri} non puoi votare, ma proponi e segni la disponibilità come tutti.`
}

/** Le regole in parole, raggruppate per sezione. */
export function describeRules(r: Rules): { title: string; items: string[] }[] {
  const confronto = r.target_mode === 'gt' ? 'superiore a' : 'almeno'
  return [
    {
      title: 'Verdetto e premio',
      items: [
        `Il posto è promosso se la media è ${confronto} ${fmtNum(r.target)}.`,
        r.prize ? `Premio per chi l’ha proposto: ${r.prize}.` : 'Premio: ancora da decidere.',
        r.reveal === 'always'
          ? 'Il nome di chi ha proposto si scopre sempre al verdetto.'
          : 'Il nome di chi ha proposto si scopre solo se il posto è promosso.',
        penaltyText(r),
      ],
    },
    {
      title: 'Voto',
      items: [
        `Si vota su: ${criteriaText(r.criteria)}, ${scaleText(r)}.`,
        r.criteria.some((c) => c.weight !== r.criteria[0].weight)
          ? 'La media finale è pesata: le voci con il peso più alto contano di più.'
          : 'La media finale è la media semplice di tutte le voci.',
        r.proposer_votes ? 'Anche chi ha proposto il posto vota.' : 'Chi ha proposto il posto non vota: giudicano solo gli altri.',
        r.trim_extremes
          ? 'Se votano almeno 5 persone, per ogni voce si scartano il voto più alto e il più basso.'
          : 'Contano tutti i voti, nessuno viene scartato.',
        `Il voto si apre ${OPENS_LABEL[r.voting_opens]} e si chiude ${closesText(r)}.`,
      ],
    },
    {
      title: 'Proposte e calendario',
      items: [
        r.proposals_per_person === 1
          ? 'Ognuno mette in busta un locale.'
          : `Ognuno può mettere in busta fino a ${r.proposals_per_person} locali.`,
        `La disponibilità si segna sui prossimi ${r.availability_days} giorni, ${weekdaysText(r.allowed_weekdays)}.`,
      ],
    },
  ]
}

const yesNo = (v: unknown) => (v ? 'sì' : 'no')

/** Una modifica delle regole, in parole (per il registro). */
export function describeChange(key: string, from: any, to: any): string {
  switch (key) {
    case 'name':
      return `Nome del gruppo: “${from}” → “${to}”`
    case 'target':
      return `Target: ${fmtNum(from)} → ${fmtNum(to)}`
    case 'target_mode':
      return `Confronto: ${TARGET_MODE_LABEL[from as Rules['target_mode']] ?? from} → ${TARGET_MODE_LABEL[to as Rules['target_mode']] ?? to}`
    case 'prize':
      return `Premio: ${from ? `“${from}”` : 'nessuno'} → ${to ? `“${to}”` : 'nessuno'}`
    case 'reveal':
      return `Rivelazione del proponente: ${REVEAL_LABEL[from as Rules['reveal']] ?? from} → ${REVEAL_LABEL[to as Rules['reveal']] ?? to}`
    case 'penalty':
      return `Penalità: ${PENALTY_LABEL[from as Rules['penalty']] ?? from} → ${PENALTY_LABEL[to as Rules['penalty']] ?? to}`
    case 'penalty_rounds':
      return `Durata della penalità: ${from} → ${to} giri`
    case 'criteria':
      return `Voci di giudizio: ${criteriaText(from ?? [])} → ${criteriaText(to ?? [])}`
    case 'scale_min':
      return `Voto minimo: ${from} → ${to}`
    case 'scale_max':
      return `Voto massimo: ${from} → ${to}`
    case 'scale_step':
      return `Mezzi punti: ${yesNo(Number(from) === 0.5)} → ${yesNo(Number(to) === 0.5)}`
    case 'proposer_votes':
      return `Il proponente vota: ${yesNo(from)} → ${yesNo(to)}`
    case 'trim_extremes':
      return `Scarto del voto più alto e più basso: ${yesNo(from)} → ${yesNo(to)}`
    case 'voting_opens':
      return `Apertura del voto: ${OPENS_LABEL[from as Rules['voting_opens']] ?? from} → ${OPENS_LABEL[to as Rules['voting_opens']] ?? to}`
    case 'voting_closes':
      return `Chiusura del voto: ${CLOSES_LABEL[from as Rules['voting_closes']] ?? from} → ${CLOSES_LABEL[to as Rules['voting_closes']] ?? to}`
    case 'close_after_days':
      return `Giorni prima della chiusura automatica: ${from} → ${to}`
    case 'proposals_per_person':
      return `Proposte a testa: ${from} → ${to}`
    case 'availability_days':
      return `Finestra di disponibilità: ${from} → ${to} giorni`
    case 'allowed_weekdays':
      return `Giorni ammessi: ${weekdaysText(from ?? [])} → ${weekdaysText(to ?? [])}`
    default:
      return `${key}: ${JSON.stringify(from)} → ${JSON.stringify(to)}`
  }
}

/** Controllo veloce lato app (il database ricontrolla comunque tutto). */
export function checkRules(r: Rules): string | null {
  const nums = [r.target, r.scale_min, r.scale_max, r.penalty_rounds, r.close_after_days, r.proposals_per_person, r.availability_days]
  if (nums.some((n) => !Number.isFinite(n))) return 'Controlla i numeri: c’è un campo vuoto o non valido.'
  if (!Number.isInteger(r.scale_min) || !Number.isInteger(r.scale_max)) return 'Voto minimo e massimo devono essere numeri interi.'
  if (!(r.scale_min < r.scale_max)) return 'Il voto massimo deve essere più alto del minimo.'
  if (r.target < r.scale_min || r.target > r.scale_max) return `Il target deve stare tra ${r.scale_min} e ${r.scale_max}.`
  if (r.criteria.length < 1 || r.criteria.length > 8) return 'Servono da 1 a 8 voci di giudizio.'
  if (r.criteria.some((c) => !c.label.trim())) return 'Ogni voce di giudizio deve avere un nome.'
  if (r.criteria.some((c) => !(c.weight > 0 && c.weight <= 10))) return 'Ogni peso deve essere tra 0,1 e 10.'
  if (r.allowed_weekdays.length === 0) return 'Scegli almeno un giorno della settimana.'
  return null
}

export function newCriterionKey(existing: string[]): string {
  let k = ''
  do k = 'v_' + Math.random().toString(36).slice(2, 8)
  while (existing.includes(k))
  return k
}
