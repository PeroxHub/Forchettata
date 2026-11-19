import { useState } from 'react'
import { Activity, Copy, Layers, LogIn, LogOut, Plus, RefreshCw, Settings2, Share2, Trash2, UserCog, UserMinus, Users } from 'lucide-react'
import { useGame } from '../game/context'
import { ActivityList } from '../components/ActivityList'
import { Avatar, Card, Modal, Notice, useToast } from '../components/ui'
import { errorMessage } from '../lib/backend'
import type { GroupSummary } from '../lib/types'

export function inviteLink(code: string) {
  return `${window.location.origin}${window.location.pathname}?invito=${encodeURIComponent(code)}`
}

/** Elenco dei propri gruppi, creazione di un gruppo nuovo e ingresso con un codice. */
function MyGroups({
  groups,
  onSwitchGroup,
  onGroupAdded,
}: {
  groups: GroupSummary[]
  onSwitchGroup?: (id: string) => void
  onGroupAdded: (id: string) => void
}) {
  const { backend, state } = useGame()
  const toast = useToast()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const act = async (fn: () => Promise<string>, ok: string) => {
    setBusy(true)
    try {
      const id = await fn()
      toast(ok)
      onGroupAdded(id)
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card
      icon={<Layers size={20} />}
      title="I tuoi gruppi"
      sub="Puoi far parte di più gruppi, ognuno con le sue regole, i suoi giri e il suo storico."
    >
      <div className="stack-lg">
        {groups.length > 1 && (
          <div className="list">
            {groups.map((g) => (
              <div key={g.id} className="list-item">
                <div className="grow">
                  <b>{g.name}</b>
                  {g.role === 'admin' && (
                    <span className="badge accent" style={{ marginLeft: 8 }}>
                      organizzatore
                    </span>
                  )}
                </div>
                {g.id === state.group.id ? (
                  <span className="small muted">aperto ora</span>
                ) : (
                  <button className="btn small" onClick={() => onSwitchGroup?.(g.id)}>
                    Apri
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            void act(async () => (await backend.createGroup(name)).id, 'Gruppo creato: ora sei l’organizzatore')
          }}
        >
          <label className="field">
            <span>Crea un gruppo nuovo</span>
            <input
              className="input"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="Es. Cene del giovedì"
            />
            <small>Ne diventi l’organizzatore: poi dalla scheda Gruppo prendi il link d’invito per i nuovi amici.</small>
          </label>
          <div>
            <button className="btn" type="submit" disabled={busy || !name.trim()}>
              <Plus size={18} /> Crea il gruppo
            </button>
          </div>
        </form>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            void act(() => backend.joinGroup(code), 'Sei entrato nel gruppo')
          }}
        >
          <label className="field">
            <span>Entra in un altro gruppo</span>
            <input
              className="input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Codice d’invito"
              autoCapitalize="characters"
            />
          </label>
          <div>
            <button className="btn" type="submit" disabled={busy || code.trim().length < 4}>
              <LogIn size={18} /> Entra
            </button>
          </div>
        </form>
      </div>
    </Card>
  )
}

/** Nome del gruppo ed eliminazione: solo per gli organizzatori. */
function GroupSettings({ onGroupDeleted }: { onGroupDeleted?: () => void }) {
  const { state, backend, run } = useGame()
  const toast = useToast()
  const [name, setName] = useState(state.group.name)
  const [askDelete, setAskDelete] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const matches = confirm.trim().toLowerCase() === state.group.name.trim().toLowerCase()

  const remove = async () => {
    setBusy(true)
    try {
      await backend.deleteGroup(state.group.id, confirm)
      toast(`Gruppo “${state.group.name}” eliminato`)
      setAskDelete(false)
      onGroupDeleted?.()
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card icon={<Settings2 size={20} />} title="Impostazioni del gruppo">
      <div className="stack-lg">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            void run(() => backend.renameGroup(state.group.id, name), 'Nome del gruppo aggiornato')
          }}
        >
          <label className="field">
            <span>Nome del gruppo</span>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input className="input grow" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
              <button className="btn" type="submit" disabled={!name.trim() || name.trim() === state.group.name}>
                Rinomina
              </button>
            </div>
          </label>
        </form>
        <div className="divider" />
        <div className="row-between">
          <div className="grow" style={{ minWidth: 200 }}>
            <b>Elimina il gruppo</b>
            <p className="small muted">Spariscono giri, proposte, voti, storico e registro, per tutti. Non si torna indietro.</p>
          </div>
          {onGroupDeleted && (
            <button className="btn danger" onClick={() => (setConfirm(''), setAskDelete(true))}>
              <Trash2 size={17} /> Elimina…
            </button>
          )}
        </div>
      </div>
      {askDelete && (
        <Modal
          title="Eliminare il gruppo?"
          onClose={() => setAskDelete(false)}
          actions={
            <>
              <button className="btn ghost" onClick={() => setAskDelete(false)}>
                Annulla
              </button>
              <button className="btn primary danger" disabled={!matches || busy} onClick={remove}>
                <Trash2 size={17} /> Elimina per sempre
              </button>
            </>
          }
        >
          <Notice tone="bad">
            Elimini <b>{state.group.name}</b> per tutti i {state.members.filter((m) => m.active).length} giocatori, con tutti i giri, le
            proposte, i voti e lo storico. Non si può annullare.
          </Notice>
          <label className="field">
            <span>Per confermare scrivi il nome del gruppo</span>
            <input
              className="input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={state.group.name}
              autoFocus
            />
          </label>
        </Modal>
      )}
    </Card>
  )
}

export function GroupPage({
  onSignOut,
  email,
  groups,
  onSwitchGroup,
  onGroupAdded,
  onGroupDeleted,
}: {
  onSignOut?: () => void
  email?: string | null
  groups?: GroupSummary[]
  onSwitchGroup?: (id: string) => void
  onGroupAdded?: (id: string) => void
  onGroupDeleted?: () => void
}) {
  const { state, isAdmin, backend, run, ask } = useGame()
  const toast = useToast()
  const [myName, setMyName] = useState(state.me.display_name)
  const active = state.members.filter((m) => m.active)
  const former = state.members.filter((m) => !m.active)
  const admins = active.filter((m) => m.role === 'admin').length
  const link = state.invite_code ? inviteLink(state.invite_code) : null

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      toast('Link copiato')
    } catch {
      toast('Non riesco a copiare: tieni premuto sul link per copiarlo', 'error')
    }
  }
  const share = async () => {
    if (!link) return
    if (navigator.share) {
      try {
        await navigator.share({
          title: state.group.name,
          text: `Entra in “${state.group.name}”: proponiamo i posti in busta chiusa e poi li votiamo.`,
          url: link,
        })
      } catch {
        /* annullato */
      }
    } else void copy()
  }

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 4 }}>
        <h1>{state.group.name}</h1>
        <p className="muted">
          {active.length} {active.length === 1 ? 'giocatore' : 'giocatori'} · {admins === 1 ? '1 organizzatore' : `${admins} organizzatori`}
        </p>
      </div>

      {isAdmin && link && (
        <Card icon={<Share2 size={20} />} title="Invita gli amici" sub="Chi apre questo link e accede entra nel gruppo.">
          <div className="stack">
            <div className="notice" style={{ wordBreak: 'break-all', fontFamily: 'ui-monospace, monospace', fontSize: '0.85rem' }}>
              {link}
            </div>
            <div className="row">
              <button className="btn primary" onClick={share}>
                <Share2 size={18} /> Condividi
              </button>
              <button className="btn" onClick={copy}>
                <Copy size={18} /> Copia
              </button>
              <button
                className="btn ghost"
                onClick={async () => {
                  if (
                    await ask(
                      'Creare un nuovo link?',
                      'Il link attuale smette di funzionare. Chi è già nel gruppo resta dentro.',
                      'Crea nuovo link',
                    )
                  )
                    await run(() => backend.regenerateInvite(state.group.id), 'Nuovo link creato')
                }}
              >
                <RefreshCw size={16} /> Nuovo link
              </button>
            </div>
            <p className="small muted">
              Codice: <b>{state.invite_code}</b>
            </p>
          </div>
        </Card>
      )}

      <Card icon={<Users size={20} />} title="Giocatori">
        <div className="list">
          {active.map((m) => {
            const me = m.user_id === state.me.user_id
            return (
              <div key={m.user_id} className="list-item">
                <Avatar name={m.display_name} url={m.avatar_url} />
                <div className="grow">
                  <b>{m.display_name}</b>
                  {me && <span className="muted"> (tu)</span>}
                </div>
                {m.role === 'admin' && <span className="badge accent">organizzatore</span>}
                {isAdmin && !me && (
                  <div className="row" style={{ gap: 2 }}>
                    <button
                      className="btn ghost small"
                      title={m.role === 'admin' ? 'Togli il ruolo di organizzatore' : 'Nomina organizzatore'}
                      aria-label={
                        m.role === 'admin'
                          ? `Togli a ${m.display_name} il ruolo di organizzatore`
                          : `Nomina ${m.display_name} organizzatore`
                      }
                      onClick={() =>
                        run(
                          () => backend.setMemberRole(state.group.id, m.user_id, m.role === 'admin' ? 'player' : 'admin'),
                          m.role === 'admin' ? `${m.display_name} non è più organizzatore` : `${m.display_name} ora è organizzatore`,
                        )
                      }
                    >
                      <UserCog size={17} />
                    </button>
                    <button
                      className="btn ghost small danger"
                      aria-label={`Togli ${m.display_name} dal gruppo`}
                      onClick={async () => {
                        if (
                          await ask(
                            `Togliere ${m.display_name}?`,
                            'Non potrà più vedere né giocare. Lo storico resta. Potrà rientrare solo con il link d’invito.',
                            'Togli dal gruppo',
                            true,
                          )
                        )
                          await run(() => backend.removeMember(state.group.id, m.user_id), `${m.display_name} non fa più parte del gruppo`)
                      }}
                    >
                      <UserMinus size={17} />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {former.length > 0 && (
          <p className="small muted" style={{ marginTop: 8 }}>
            Usciti: {former.map((m) => m.display_name).join(', ')}
          </p>
        )}
        {isAdmin && (
          <p className="small muted" style={{ marginTop: 8 }}>
            Gli organizzatori sorteggiano, fissano la data, chiudono il voto e cambiano le regole. Giocano come tutti.
          </p>
        )}
      </Card>

      {groups && onGroupAdded && <MyGroups groups={groups} onSwitchGroup={onSwitchGroup} onGroupAdded={onGroupAdded} />}

      {isAdmin && <GroupSettings onGroupDeleted={onGroupDeleted} />}

      <Card title="Il tuo nome nel gruppo">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            void run(() => backend.updateProfile(state.group.id, myName), 'Nome aggiornato')
          }}
        >
          <input
            className="input grow"
            value={myName}
            maxLength={40}
            onChange={(e) => setMyName(e.target.value)}
            aria-label="Il tuo nome"
          />
          <button className="btn" type="submit" disabled={!myName.trim() || myName.trim() === state.me.display_name}>
            Salva
          </button>
        </form>
        {onSignOut && (
          <div className="row-between" style={{ marginTop: 14 }}>
            <span className="small muted">{email ? `Accesso come ${email}` : ''}</span>
            <button className="btn ghost small" onClick={onSignOut}>
              <LogOut size={16} /> Esci
            </button>
          </div>
        )}
      </Card>

      <Card
        icon={<Activity size={20} />}
        title="Attività"
        sub="Sorteggi, date, verdetti e modifiche. Le proposte e i voti non compaiono mai."
      >
        <ActivityList limit={60} />
      </Card>
    </div>
  )
}
