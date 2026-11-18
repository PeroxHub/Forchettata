import { useCallback, useEffect, useMemo, useState } from 'react'
import { Game } from './game/Game'
import { JoinPage, LoginPage, SetupMissing } from './pages/AuthPages'
import { Spinner, ToastProvider, useToast } from './components/ui'
import { errorMessage, explainAuthError } from './lib/backend'
import { createSupabaseBackend } from './lib/supabaseBackend'
import { buildScenario, DEMO_PLAYERS, SCENARIOS, type ScenarioId } from './lib/demoScenarios'
import { todayInRome } from './lib/dates'
import type { DemoBackend } from './lib/demoBackend'
import type { AuthUser, GroupSummary } from './lib/types'

// tolgo spazi, a capo e la barra finale incollati per sbaglio nelle variabili di GitHub
const clean = (v: string | undefined) => v?.replace(/\s+/g, '').replace(/^["'“”]+|["'“”]+$/g, '') || undefined
const SUPABASE_URL = clean(import.meta.env.VITE_SUPABASE_URL)?.replace(/\/+$/, '')
const SUPABASE_KEY = clean(import.meta.env.VITE_SUPABASE_KEY)

/* piccola memoria locale, che può anche non esserci (navigazione privata) */
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* ignora */
    }
  },
  del: (k: string) => {
    try {
      localStorage.removeItem(k)
    } catch {
      /* ignora */
    }
  },
}

/** Toglie dall'indirizzo i parametri già letti, senza ricaricare la pagina. */
function stripParams(names: string[]) {
  const url = new URL(window.location.href)
  let changed = false
  for (const n of names)
    if (url.searchParams.has(n)) {
      url.searchParams.delete(n)
      changed = true
    }
  if (changed) history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + url.hash)
}

function goDemo(scenario: ScenarioId = 'proposte') {
  window.location.href = `${window.location.pathname}?anteprima=${scenario}`
}

/** Errori di configurazione evidenti, da segnalare prima ancora di provare. */
function configProblem(url: string, key: string): string | null {
  let host = ''
  try {
    host = new URL(url).host
  } catch {
    return `La variabile SUPABASE_URL (“${url}”) non è un indirizzo valido: deve essere tipo https://abcd.supabase.co`
  }
  if (host.endsWith('.supabase.com'))
    return `La variabile SUPABASE_URL finisce con “.supabase.com”: deve finire con “.supabase.co” (senza la m).`
  let role = ''
  try {
    role = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? ''
  } catch {
    /* non è un JWT: chiave nuova */
  }
  if (key.startsWith('sb_secret_') || role === 'service_role')
    return 'In SUPABASE_KEY c’è la chiave SEGRETA di Supabase, che non deve mai stare nel sito. Sostituiscila con la Publishable key e rigenera subito quella segreta in Supabase (Project Settings → API Keys).'
  return null
}

export default function App() {
  const demo = new URLSearchParams(window.location.search).has('anteprima')
  const problem = SUPABASE_URL && SUPABASE_KEY ? configProblem(SUPABASE_URL, SUPABASE_KEY) : null
  return (
    <ToastProvider>
      {demo ? (
        <DemoApp />
      ) : problem ? (
        <SetupMissing onDemo={() => goDemo()} problem={problem} />
      ) : SUPABASE_URL && SUPABASE_KEY ? (
        <LiveApp url={SUPABASE_URL} keyValue={SUPABASE_KEY} />
      ) : (
        <SetupMissing onDemo={() => goDemo()} />
      )}
    </ToastProvider>
  )
}

/* ------------------------------------------------------------------ */
/*  App vera, collegata a Supabase                                      */
/* ------------------------------------------------------------------ */

// un solo client per pagina (React in sviluppo monta i componenti due volte)
let liveBackend: ReturnType<typeof createSupabaseBackend> | null = null

function LiveApp({ url, keyValue }: { url: string; keyValue: string }) {
  const backend = useMemo(() => (liveBackend ??= createSupabaseBackend(url, keyValue)), [url, keyValue])
  const toast = useToast()
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined)
  const [groups, setGroups] = useState<GroupSummary[] | null>(null)
  const [groupId, setGroupId] = useState<string | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [authError, setAuthError] = useState<string | null>(() => new URLSearchParams(window.location.search).get('error_description'))
  const [invite] = useState(() => {
    const code = new URLSearchParams(window.location.search).get('invito')
    if (code) store.set('cac_invite', code)
    return code ?? store.get('cac_invite')
  })

  useEffect(() => {
    stripParams(['invito', 'error', 'error_code', 'error_description'])
    let alive = true
    backend.getUser().then((u) => {
      if (!alive) return
      const e = backend.takeAuthError?.()
      if (e && !u) setAuthError(e)
      setUser(u)
      stripParams(['code'])
    })
    const off = backend.onAuthChange((u) => setUser(u))
    return () => {
      alive = false
      off()
    }
  }, [backend, toast])

  const userId = user?.id
  const loadGroups = useCallback(
    async (prefer?: string | null) => {
      const pending = store.get('cac_invite')
      let joined: string | null = null
      if (pending) {
        try {
          joined = await backend.joinGroup(pending)
          setJoinError(null)
        } catch (e) {
          setJoinError(`Il link d’invito non funziona: ${errorMessage(e)}`)
        }
        store.del('cac_invite')
      }
      const gs = await backend.myGroups()
      setGroups(gs)
      const last = prefer ?? joined ?? store.get('cac_group')
      const pick = gs.find((g) => g.id === last)?.id ?? gs[0]?.id ?? null
      setGroupId(pick)
      if (pick) store.set('cac_group', pick)
    },
    [backend],
  )

  useEffect(() => {
    if (!userId) {
      setGroups(null)
      setGroupId(null)
      return
    }
    loadGroups().catch((e) => {
      toast(errorMessage(e), 'error')
      setGroups([])
    })
  }, [userId, loadGroups, toast])

  const signOut = async () => {
    await backend.signOut()
    setUser(null)
  }

  if (user === undefined) return <Spinner />
  if (user === null)
    return <LoginPage backend={backend} invited={!!invite} error={authError ? explainAuthError(authError) : null} onDemo={() => goDemo()} />
  if (groups === null) return <Spinner label="Entro nel gruppo…" />
  if (!groupId)
    return (
      <JoinPage backend={backend} error={joinError} onJoined={(id) => void loadGroups(id)} onSignOut={signOut} onDemo={() => goDemo()} />
    )
  return (
    <Game
      key={groupId}
      backend={backend}
      groupId={groupId}
      groups={groups}
      email={user.email}
      onSwitchGroup={(id) => {
        store.set('cac_group', id)
        setGroupId(id)
      }}
      onGroupAdded={(id) => void loadGroups(id)}
      onSignOut={signOut}
      onLostAccess={() => {
        store.del('cac_group')
        setGroupId(null)
      }}
    />
  )
}

/* ------------------------------------------------------------------ */
/*  Anteprima con dati di esempio                                       */
/* ------------------------------------------------------------------ */

function DemoApp() {
  const initial = new URLSearchParams(window.location.search).get('anteprima') as ScenarioId | null
  const [scenario, setScenario] = useState<ScenarioId>(SCENARIOS.some((s) => s.id === initial) ? initial! : 'proposte')
  const [backend, setBackend] = useState<DemoBackend | null>(null)
  const [viewer, setViewer] = useState(DEMO_PLAYERS[0].id)

  useEffect(() => {
    let alive = true
    setBackend(null)
    buildScenario(scenario, todayInRome()).then((b) => {
      if (!alive) return
      setViewer(b.me)
      setBackend(b)
    })
    const url = new URL(window.location.href)
    url.searchParams.set('anteprima', scenario)
    history.replaceState(null, '', url.pathname + url.search + url.hash)
    return () => {
      alive = false
    }
  }, [scenario])

  if (!backend) return <Spinner label="Preparo l’anteprima…" />

  const banner = (
    <div className="demo-bar">
      <div className="demo-bar-inner">
        <div className="row-between small">
          <b>Anteprima con dati di esempio: niente viene salvato.</b>
          <button className="link" onClick={() => (window.location.href = window.location.pathname)}>
            Esci dall’anteprima
          </button>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {SCENARIOS.map((s) => (
            <button key={s.id} className="chip" aria-pressed={scenario === s.id} title={s.hint} onClick={() => setScenario(s.id)}>
              {s.label}
            </button>
          ))}
          <label className="row small" style={{ gap: 6, marginLeft: 'auto' }}>
            Guarda come
            <select
              value={viewer}
              onChange={(e) => {
                backend.me = e.target.value
                setViewer(e.target.value)
              }}
            >
              {DEMO_PLAYERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.id === DEMO_PLAYERS[0].id ? ' (organizzatore)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </div>
  )

  return <Game key={`${scenario}-${viewer}`} backend={backend} groupId={backend.group.id} banner={banner} />
}
