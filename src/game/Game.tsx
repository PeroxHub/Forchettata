import { useEffect, useRef, useState, type ReactNode } from 'react'
import { History, RefreshCw, ScrollText, Trophy, Users, UtensilsCrossed, WifiOff } from 'lucide-react'
import { GameProvider, useGameState } from './context'
import { BrandMark, Notice, Spinner } from '../components/ui'
import { RoundPage } from '../pages/RoundPage'
import { HistoryPage } from '../pages/HistoryPage'
import { LeaderboardPage } from '../pages/LeaderboardPage'
import { RulesPage } from '../pages/RulesPage'
import { GroupPage } from '../pages/GroupPage'
import type { Backend } from '../lib/backend'
import type { GroupSummary } from '../lib/types'

const TABS = [
  { id: 'giro', label: 'Giro', icon: UtensilsCrossed },
  { id: 'storico', label: 'Storico', icon: History },
  { id: 'classifica', label: 'Classifica', icon: Trophy },
  { id: 'regole', label: 'Regole', icon: ScrollText },
  { id: 'gruppo', label: 'Gruppo', icon: Users },
] as const
type TabId = (typeof TABS)[number]['id']

function readTab(): TabId {
  const h = window.location.hash.replace('#', '')
  return (TABS.find((t) => t.id === h)?.id ?? 'giro') as TabId
}

function useTab(): [TabId, (t: TabId) => void] {
  const [tab, setTab] = useState<TabId>(readTab)
  useEffect(() => {
    const on = () => setTab(readTab())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const go = (t: TabId) => {
    if (t !== tab) {
      history.pushState(null, '', `${window.location.pathname}${window.location.search}#${t}`)
      setTab(t)
    }
    window.scrollTo({ top: 0 })
  }
  return [tab, go]
}

export function Game({
  backend,
  groupId,
  groups,
  onSwitchGroup,
  onGroupAdded,
  onGroupDeleted,
  onGroupsStale,
  onSignOut,
  onLostAccess,
  email,
  banner,
}: {
  backend: Backend
  groupId: string
  groups?: GroupSummary[]
  onSwitchGroup?: (id: string) => void
  /** Dopo aver creato un gruppo o essere entrati in uno nuovo. */
  onGroupAdded?: (id: string) => void
  /** Dopo aver eliminato il gruppo aperto. */
  onGroupDeleted?: () => void
  /** Il nome o il ruolo del gruppo aperto è cambiato: va riletto l'elenco dei gruppi. */
  onGroupsStale?: () => void
  onSignOut?: () => void
  onLostAccess?: () => void
  email?: string | null
  banner?: ReactNode
}) {
  const { state, error, refresh } = useGameState(backend, groupId)
  const [tab, go] = useTab()
  // cambiando scheda ricarico i dati, nel caso il tempo reale non sia arrivato
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    void refresh()
  }, [tab, refresh])

  // nome e ruolo del gruppo aperto vengono dallo stato appena letto, così il menu dei gruppi non resta indietro
  const name = state?.group.name
  const role = state?.me.role
  const groupList = groups?.map((g) => (g.id === groupId && name && role ? { ...g, name, role } : g))
  const stale = groups?.find((g) => g.id === groupId)
  const asked = useRef('')
  useEffect(() => {
    const key = `${name}|${role}`
    if (name && stale && (stale.name !== name || stale.role !== role) && asked.current !== key) {
      asked.current = key // una sola richiesta per ogni cambio, anche se l'elenco tarda ad aggiornarsi
      onGroupsStale?.()
    }
  }, [name, role, stale, onGroupsStale])
  useEffect(() => {
    document.title = name ? `${name} · Cena alla cieca` : 'Cena alla cieca'
  }, [name])

  // gruppo eliminato o membro tolto: non ha senso restare sulla pagina
  if (error && /Non fai parte/.test(error) && onLostAccess) {
    return (
      <div className="center-page">
        <div className="card auth-card stack">
          <h2>Questo gruppo non è più disponibile</h2>
          <p className="muted">È stato eliminato da un organizzatore, oppure non ne fai più parte.</p>
          <div className="row">
            <button className="btn primary" onClick={onLostAccess}>
              Vai ai tuoi gruppi
            </button>
            {onSignOut && (
              <button className="btn ghost" onClick={onSignOut}>
                Esci
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (!state) {
    if (!error) return <Spinner />
    return (
      <div className="center-page">
        <div className="card auth-card stack">
          <h2>Non riesco a caricare il gruppo</h2>
          <p className="muted">{error}</p>
          <div className="row">
            <button className="btn primary" onClick={() => void refresh()}>
              <RefreshCw size={16} /> Riprova
            </button>
            {onSignOut && (
              <button className="btn ghost" onClick={onSignOut}>
                Esci
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  const page = {
    giro: <RoundPage goRules={() => go('regole')} />,
    storico: <HistoryPage />,
    classifica: <LeaderboardPage />,
    regole: <RulesPage />,
    gruppo: (
      <GroupPage
        onSignOut={onSignOut}
        email={email}
        groups={groupList}
        onSwitchGroup={onSwitchGroup}
        onGroupAdded={onGroupAdded}
        onGroupDeleted={onGroupDeleted}
      />
    ),
  }[tab]

  return (
    <GameProvider backend={backend} state={state} refresh={refresh}>
      <div className="app">
        {banner}
        <header className="topbar">
          <div className="topbar-inner">
            <div className="brand">
              <BrandMark />
              {groupList && groupList.length > 1 && onSwitchGroup ? (
                <select
                  className="input"
                  style={{ minHeight: 34, padding: '4px 8px', width: 'auto' }}
                  value={groupId}
                  onChange={(e) => onSwitchGroup(e.target.value)}
                  aria-label="Gruppo"
                >
                  {groupList.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="brand-name">{state.group.name}</span>
              )}
            </div>
            <nav className="tabs" aria-label="Sezioni">
              {TABS.map((t) => (
                <button key={t.id} className="tab" aria-current={tab === t.id ? 'page' : undefined} onClick={() => go(t.id)}>
                  <t.icon size={17} />
                  {t.label}
                </button>
              ))}
            </nav>
          </div>
        </header>
        <main className="main">
          {error && (
            <div style={{ marginBottom: 14 }}>
              <Notice tone="warn" icon={<WifiOff size={18} />}>
                Non riesco ad aggiornare: {error}
              </Notice>
            </div>
          )}
          {page}
        </main>
        <nav className="tabbar" aria-label="Sezioni">
          {TABS.map((t) => (
            <button key={t.id} className="tab" aria-current={tab === t.id ? 'page' : undefined} onClick={() => go(t.id)}>
              <t.icon size={21} />
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </GameProvider>
  )
}
