import type { AuthUser, GameState, GroupSummary, ISODate, Role, Rules, Scores } from './types'

export interface Backend {
  kind: 'live' | 'demo'

  getUser(): Promise<AuthUser | null>
  onAuthChange(cb: (u: AuthUser | null) => void): () => void
  signInWithGoogle(): Promise<void>
  signInWithEmail(email: string): Promise<void>
  verifyEmailCode(email: string, code: string): Promise<void>
  signOut(): Promise<void>
  /** Errore dell'ultimo tentativo di accesso (ritorno da Google o dal link email), se c'è. */
  takeAuthError?(): string | null
  /** Controlla che Supabase risponda e sia configurato; restituisce il problema trovato. */
  diagnose?(): Promise<string | null>

  myGroups(): Promise<GroupSummary[]>
  joinGroup(code: string): Promise<string>
  getState(groupId: string): Promise<GameState>
  /** Avvisa quando cambia qualcosa nel gruppo. Restituisce la funzione per smettere. */
  subscribe(groupId: string, onChange: () => void): () => void
  tick(groupId: string): Promise<boolean>

  saveProposal(roundId: string, place: string, notes: string | null, id?: string): Promise<void>
  deleteProposal(id: string): Promise<void>
  saveAvailability(roundId: string, days: ISODate[]): Promise<ISODate[]>
  draw(roundId: string): Promise<string>
  undoDraw(roundId: string, discard: boolean): Promise<void>
  setDinnerDate(roundId: string, date: ISODate | null): Promise<void>
  openVotingNow(roundId: string): Promise<void>
  castVote(roundId: string, scores: Scores): Promise<{ closed: boolean; outcome?: string; mean?: number }>
  closeRound(roundId: string): Promise<{ outcome: string; mean: number }>
  updateSettings(groupId: string, name: string, rules: Rules): Promise<{ changed: boolean; applied_to_current: boolean }>
  updateProfile(groupId: string, name: string): Promise<void>
  setMemberRole(groupId: string, userId: string, role: Role): Promise<void>
  removeMember(groupId: string, userId: string): Promise<void>
  regenerateInvite(groupId: string): Promise<string>
}

export class AppError extends Error {}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    if (/failed to fetch|networkerror|load failed/i.test(e.message)) return 'Connessione assente o instabile: riprova tra poco.'
    return e.message
  }
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return 'Qualcosa è andato storto.'
}

/** Spiega in italiano gli errori di accesso più comuni. */
export function explainAuthError(msg: string): string {
  if (/api key|apikey|jwt|unauthori[sz]ed|forbidden|secret/i.test(msg))
    return `La chiave SUPABASE_KEY su GitHub non è valida: deve essere la “Publishable key” (sb_publishable_…) o la “anon public”. (${msg})`
  if (/exchange external code|oauth|provider/i.test(msg))
    return `Supabase non riesce a completare l’accesso con Google: controlla ID client e Client secret nella pagina del provider Google di Supabase. (${msg})`
  if (/flow state|code verifier|pkce/i.test(msg))
    return `L’accesso è stato completato in un’altra finestra o app: riprova dallo stesso browser in cui hai premuto il pulsante. (${msg})`
  if (/redirect|url/i.test(msg)) return `Indirizzo di ritorno non autorizzato: controlla Site URL e Redirect URLs in Supabase. (${msg})`
  return msg
}
