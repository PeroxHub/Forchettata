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
  onSignOut,
  onLostAccess,
  email,
  banner,
}: {
  backend: Backend
  groupId: string
  groups?: GroupSummary[]
  onSwitchGroup?: (id: string) => void
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
            {/Non fai parte/.test(error) && onLostAccess && (
              <button className="btn" onClick={onLostAccess}>
                Usa un altro codice d’invito
              </button>
            )}
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
    gruppo: <GroupPage onSignOut={onSignOut} email={email} />,
  }[tab]

  return (
    <GameProvider backend={backend} state={state} refresh={refresh}>
      <div className="app">
        {banner}
        <header className="topbar">
          <div className="topbar-inner">
            <div className="brand">
              <BrandMark />
              {groups && groups.length > 1 && onSwitchGroup ? (
                <select
                  className="input"
                  style={{ minHeight: 34, padding: '4px 8px', width: 'auto' }}
                  value={groupId}
                  onChange={(e) => onSwitchGroup(e.target.value)}
                  aria-label="Gruppo"
                >
                  {groups.map((g) => (
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
