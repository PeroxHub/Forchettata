export type ISODate = string // 'YYYY-MM-DD'

export interface Criterion {
  key: string
  label: string
  weight: number
}

export interface Rules {
  target: number
  target_mode: 'gt' | 'gte'
  prize: string
  reveal: 'always' | 'winner_only'
  penalty: 'no_propose' | 'no_vote' | 'none'
  penalty_rounds: number
  criteria: Criterion[]
  scale_min: number
  scale_max: number
  scale_step: number
  proposer_votes: boolean
  trim_extremes: boolean
  voting_opens: 'after_draw' | 'dinner_day'
  voting_closes: 'manual' | 'all_voted' | 'days_after'
  close_after_days: number
  proposals_per_person: number
  availability_days: number
  allowed_weekdays: number[] // 1 = lunedì … 7 = domenica
}

export type RoundStatus = 'proposals' | 'drawn' | 'closed'
export type Outcome = 'promoted' | 'failed'

export interface CriterionResult extends Criterion {
  avg: number
  n: number
  trimmed: boolean
}

export interface Results {
  criteria: CriterionResult[]
  voters: number
}

export interface Round {
  id: string
  number: number
  status: RoundStatus
  rules: Rules
  opened_at: string
  window_start: ISODate
  window_end: ISODate
  proposals_count: number
  votes_count: number
  place_name: string | null
  place_notes: string | null
  drawn_at: string | null
  dinner_date: ISODate | null
  voting_forced_open: boolean
  closed_at: string | null
  results: Results | null
  final_mean: number | null
  outcome: Outcome | null
  proposer_id: string | null
}

export type Role = 'admin' | 'player'

export interface Member {
  user_id: string
  display_name: string
  avatar_url: string | null
  role: Role
  active: boolean
  joined_at: string
}

export interface AvailabilityRow {
  user_id: string
  days: ISODate[]
  updated_at: string
}

export interface Proposal {
  id: string
  place_name: string
  notes: string | null
  updated_at: string
}

export type Scores = Record<string, number>

export interface Vote {
  scores: Scores
  updated_at: string
}

export interface CurrentRoundState {
  round_id: string
  is_proposer: boolean
  can_propose: boolean
  propose_block_reason: 'phase' | 'penalty' | 'limit' | null
  can_vote: boolean
  vote_block_reason: 'not_drawn' | 'proposer' | 'penalty' | 'not_open' | null
  voting_open: boolean
  expected_voters: number | null
  rules_locked: boolean
  my_proposals: Proposal[]
  my_vote: Vote | null
  availability: AvailabilityRow[]
}

export interface Penalty {
  kind: 'no_propose' | 'no_vote'
  from_number: number
  to_number: number
}

export interface Activity {
  id: number
  at: string
  user_id: string | null
  kind: string
  details: Record<string, any>
}

export interface GameState {
  today: ISODate
  group: { id: string; name: string }
  settings: Rules
  me: { user_id: string; display_name: string; avatar_url: string | null; role: Role }
  members: Member[]
  rounds: Round[] // dal più recente
  current: CurrentRoundState | null
  my_drawn_round_ids: string[]
  my_penalties: Penalty[]
  activity: Activity[]
  invite_code: string | null
}

export interface GroupSummary {
  id: string
  name: string
  role: Role
}

export interface AuthUser {
  id: string
  email: string | null
  name: string | null
}
