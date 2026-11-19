import { createClient, type User } from '@supabase/supabase-js'
import { AppError, type Backend } from './backend'
import type { AuthUser, GameState, GroupSummary } from './types'

function toUser(u: User | null | undefined): AuthUser | null {
  if (!u) return null
  const meta = (u.user_metadata ?? {}) as Record<string, string | undefined>
  return { id: u.id, email: u.email ?? null, name: meta.full_name ?? meta.name ?? null }
}

/** L'indirizzo a cui tornare dopo il login: la pagina dell'app, senza parametri. */
function redirectUrl() {
  return `${window.location.origin}${window.location.pathname}`
}

export function createSupabaseBackend(url: string, key: string): Backend {
  const sb = createClient(url, key, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })

  async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error } = await sb.rpc(fn, args)
    if (error) {
      if (/could not find the function|schema cache/i.test(error.message))
        throw new AppError('Il database va aggiornato: in Supabase riesegui il file supabase/schema.sql nello SQL Editor.')
      throw new AppError(error.message || 'Errore del server')
    }
    return data as T
  }

  let authError: string | null = null

  return {
    kind: 'live',

    async getUser() {
      const hadCode = new URLSearchParams(window.location.search).has('code')
      const init = await sb.auth.initialize()
      const { data } = await sb.auth.getSession()
      if (init.error) authError = init.error.message
      else if (hadCode && !data.session)
        authError =
          'Il ritorno da Google non ha prodotto una sessione. Riprova dallo stesso browser (non da un’app o una finestra diversa); se si ripete, controlla in Supabase Site URL e Redirect URLs.'
      if (authError) console.error('[cena] accesso non riuscito:', authError)
      return toUser(data.session?.user)
    },
    takeAuthError() {
      const e = authError
      authError = null
      return e
    },
    async diagnose() {
      try {
        const r = await fetch(`${url.replace(/\/$/, '')}/auth/v1/settings`, { headers: { apikey: key } })
        if (r.status === 401 || r.status === 403) {
          const body = await r.text()
          return `Supabase rifiuta la chiave SUPABASE_KEY impostata su GitHub (${r.status}: ${body.slice(0, 120)}). Deve essere la Publishable key (sb_publishable_…) o la anon public.`
        }
        if (!r.ok) return `Supabase risponde con un errore (${r.status}). Il progetto potrebbe essere in pausa: controlla su supabase.com.`
        const settings = (await r.json()) as { external?: Record<string, boolean> }
        if (settings.external && !settings.external.google)
          return 'In Supabase l’accesso con Google non risulta attivo: Authentication → Sign In / Providers → Google.'
        return null
      } catch {
        return `Non riesco a raggiungere Supabase all’indirizzo ${url}. Controlla la variabile SUPABASE_URL (deve essere tipo https://abcd.supabase.co) o la connessione.`
      }
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_event, session) => cb(toUser(session?.user)))
      return () => data.subscription.unsubscribe()
    },
    async signInWithGoogle() {
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectUrl() } })
      if (error) throw new AppError(error.message)
    },
    async signInWithEmail(email) {
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectUrl() } })
      if (error)
        throw new AppError(
          /rate limit/i.test(error.message) ? 'Troppe email inviate: riprova più tardi o accedi con Google.' : error.message,
        )
    },
    async verifyEmailCode(email, code) {
      const { error } = await sb.auth.verifyOtp({ email, token: code.trim(), type: 'email' })
      if (error) throw new AppError('Codice non valido o scaduto.')
    },
    async signOut() {
      await sb.auth.signOut()
    },

    myGroups: () => rpc<GroupSummary[]>('my_groups'),
    joinGroup: (code) => rpc<string>('join_group', { p_code: code }),
    createGroup: (name) => rpc<{ id: string; code: string }>('create_group', { p_name: name }),
    getState: (gid) => rpc<GameState>('get_state', { p_group: gid }),
    tick: (gid) => rpc<boolean>('tick', { p_group: gid }),

    subscribe(gid, onChange) {
      const ch = sb.channel(`gruppo-${gid}`)
      const tables: [string, string][] = [
        ['rounds', `group_id=eq.${gid}`],
        ['availability', `group_id=eq.${gid}`],
        ['members', `group_id=eq.${gid}`],
        ['activity_log', `group_id=eq.${gid}`],
        ['groups', `id=eq.${gid}`],
      ]
      for (const [table, filter] of tables) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => onChange())
      }
      ch.subscribe()
      return () => {
        void sb.removeChannel(ch)
      }
    },

    async saveProposal(roundId, place, notes, id) {
      await rpc('save_proposal', { p_round: roundId, p_place: place, p_notes: notes, p_id: id ?? null })
    },
    async deleteProposal(id) {
      await rpc('delete_proposal', { p_id: id })
    },
    saveAvailability: (roundId, days) => rpc('save_availability', { p_round: roundId, p_days: days }),
    draw: (roundId) => rpc('draw_round', { p_round: roundId }),
    async undoDraw(roundId, discard) {
      await rpc('undo_draw', { p_round: roundId, p_discard: discard })
    },
    async setDinnerDate(roundId, date) {
      await rpc('set_dinner_date', { p_round: roundId, p_date: date })
    },
    async openVotingNow(roundId) {
      await rpc('open_voting_now', { p_round: roundId })
    },
    castVote: (roundId, scores) => rpc('cast_vote', { p_round: roundId, p_scores: scores }),
    closeRound: (roundId) => rpc('close_round', { p_round: roundId }),
    updateSettings: (gid, name, rules) => rpc('update_settings', { p_group: gid, p_name: name, p_rules: rules }),
    async renameGroup(gid, name) {
      await rpc('rename_group', { p_group: gid, p_name: name })
    },
    async deleteGroup(gid, confirm) {
      await rpc('delete_group', { p_group: gid, p_confirm: confirm })
    },
    async updateProfile(gid, name) {
      await rpc('update_profile', { p_group: gid, p_name: name })
    },
    async setMemberRole(gid, uid, role) {
      await rpc('set_member_role', { p_group: gid, p_user: uid, p_role: role })
    },
    async removeMember(gid, uid) {
      await rpc('remove_member', { p_group: gid, p_user: uid })
    },
    regenerateInvite: (gid) => rpc('regenerate_invite', { p_group: gid }),
  }
}
