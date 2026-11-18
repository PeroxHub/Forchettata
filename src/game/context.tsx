import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { errorMessage, type Backend } from '../lib/backend'
import type { CurrentRoundState, GameState, Member, Round } from '../lib/types'
import { useConfirm, useToast } from '../components/ui'

export interface GameCtx {
  backend: Backend
  state: GameState
  refresh: () => Promise<void>
  /** Esegue un'azione: mostra l'errore o il messaggio di riuscita e ricarica lo stato. */
  run: <T>(fn: () => Promise<T>, ok?: string | ((r: T) => string | null)) => Promise<T | undefined>
  busy: boolean
  isAdmin: boolean
  round: Round | null
  cur: CurrentRoundState | null
  name: (userId: string | null | undefined) => string
  member: (userId: string | null | undefined) => Member | undefined
  ask: ReturnType<typeof useConfirm>['ask']
}

const Ctx = createContext<GameCtx | null>(null)

export function useGame(): GameCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useGame fuori dal gioco')
  return c
}

/** Carica lo stato del gruppo e lo tiene aggiornato (tempo reale + controllo periodico). */
export function useGameState(backend: Backend, groupId: string) {
  const [state, setState] = useState<GameState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const s = await backend.getState(groupId)
      if (alive.current) {
        setState(s)
        setError(null)
      }
    } catch (e) {
      if (alive.current) setError(errorMessage(e))
    }
  }, [backend, groupId])

  useEffect(() => {
    alive.current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const soon = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void refresh(), 250)
    }
    const tick = () =>
      backend
        .tick(groupId)
        .then((closed) => {
          if (closed) return refresh()
        })
        .catch(() => {})
    void refresh().then(tick)
    const unsub = backend.subscribe(groupId, soon)
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 60_000)
    const tickPoll = setInterval(tick, 5 * 60_000)
    const onVis = () => document.visibilityState === 'visible' && soon()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      alive.current = false
      clearTimeout(timer)
      clearInterval(poll)
      clearInterval(tickPoll)
      document.removeEventListener('visibilitychange', onVis)
      unsub()
    }
  }, [backend, groupId, refresh])

  return { state, error, refresh }
}

export function GameProvider({
  backend,
  state,
  refresh,
  children,
}: {
  backend: Backend
  state: GameState
  refresh: () => Promise<void>
  children: ReactNode
}) {
  const toast = useToast()
  const { ask, dialog } = useConfirm()
  const [busyCount, setBusy] = useState(0)

  const run = useCallback<GameCtx['run']>(
    async (fn, ok) => {
      setBusy((n) => n + 1)
      try {
        const r = await fn()
        const msg = typeof ok === 'function' ? ok(r) : ok
        if (msg) toast(msg)
        await refresh()
        return r
      } catch (e) {
        toast(errorMessage(e), 'error')
        void refresh()
        return undefined
      } finally {
        setBusy((n) => n - 1)
      }
    },
    [refresh, toast],
  )

  const value = useMemo<GameCtx>(() => {
    const byId = new Map(state.members.map((m) => [m.user_id, m]))
    const round = state.current ? (state.rounds.find((r) => r.id === state.current!.round_id) ?? null) : null
    return {
      backend,
      state,
      refresh,
      run,
      busy: busyCount > 0,
      isAdmin: state.me.role === 'admin',
      round,
      cur: state.current,
      member: (id) => (id ? byId.get(id) : undefined),
      name: (id) => (id ? (byId.get(id)?.display_name ?? 'Ex membro') : 'Qualcuno'),
      ask,
    }
  }, [backend, state, refresh, run, busyCount, ask])

  return (
    <Ctx.Provider value={value}>
      {children}
      {dialog}
    </Ctx.Provider>
  )
}
