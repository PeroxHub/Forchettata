import type { AuthUser, GameState, GroupSummary, ISODate, Role, Rules, Scores } from './types'

export interface Backend {
  kind: 'live' | 'demo'

  getUser(): Promise<AuthUser | null>
  onAuthChange(cb: (u: AuthUser | null) => void): () => void
  signInWithGoogle(): Promise<void>
  signInWithEmail(email: string): Promise<void>
  verifyEmailCode(email: string, code: string): Promise<void>
  signOut(): Promise<void>

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
