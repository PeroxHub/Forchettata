import { useEffect, useState, type ReactNode } from 'react'
import { Eye, KeyRound, Mail } from 'lucide-react'
import { BrandMark, GoogleIcon, Notice, useToast } from '../components/ui'
import { errorMessage, type Backend } from '../lib/backend'

function Hero({ subtitle }: { subtitle: ReactNode }) {
  return (
    <div className="auth-hero">
      <BrandMark />
      <h1>Cena alla cieca</h1>
      <p className="muted">{subtitle}</p>
    </div>
  )
}

function HowItWorks() {
  return (
    <ol className="how">
      <li>Ognuno mette in busta un locale e segna quando è libero.</li>
      <li>Si sorteggia una busta: nessuno sa di chi è.</li>
      <li>Si va a cena e si vota menu, location, conto e servizio.</li>
      <li>Media sopra il target? Chi l’ha proposto vince il premio.</li>
    </ol>
  )
}

export function LoginPage({
  backend,
  invited,
  error,
  onDemo,
}: {
  backend: Backend
  invited: boolean
  error?: string | null
  onDemo: () => void
}) {
  const toast = useToast()
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    backend.diagnose?.().then((p) => alive && setProblem(p))
    return () => {
      alive = false
    }
  }, [backend])
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const go = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center-page">
      <div className="auth-card stack-lg">
        <Hero subtitle="Il gioco delle cene a sorpresa tra amici." />
        <div className="card stack-lg">
          {problem && (
            <Notice tone="bad">
              <b>Configurazione da sistemare.</b> {problem}
            </Notice>
          )}
          {error && (
            <Notice tone="bad">
              <b>Accesso non riuscito.</b> {error}
            </Notice>
          )}
          {invited && <Notice tone="accent">Sei stato invitato in un gruppo: accedi per entrare.</Notice>}
          <button className="btn big block" disabled={busy} onClick={() => go(() => backend.signInWithGoogle())}>
            <GoogleIcon /> Accedi con Google
          </button>
          <div className="or">oppure con un link via email</div>
          {!sent ? (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault()
                void go(async () => {
                  await backend.signInWithEmail(email.trim())
                  setSent(true)
                })
              }}
            >
              <input
                className="input"
                type="email"
                required
                placeholder="la-tua@email.it"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label="Email"
                autoComplete="email"
              />
              <button className="btn block" type="submit" disabled={busy || !email.includes('@')}>
                <Mail size={18} /> Mandami il link
              </button>
            </form>
          ) : (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault()
                void go(() => backend.verifyEmailCode(email.trim(), code))
              }}
            >
              <Notice tone="ok">
                Ti ho mandato un’email a <b>{email}</b>. Apri il link <b>da questo stesso dispositivo</b>, oppure scrivi qui il codice che
                trovi nell’email.
              </Notice>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input
                  className="input grow"
                  inputMode="numeric"
                  placeholder="Codice"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  aria-label="Codice dall'email"
                  autoComplete="one-time-code"
                />
                <button className="btn" type="submit" disabled={busy || code.trim().length < 6}>
                  <KeyRound size={18} /> Entra
                </button>
              </div>
              <button type="button" className="btn ghost small" onClick={() => setSent(false)}>
                Usa un’altra email
              </button>
            </form>
          )}
        </div>
        <div className="card stack">
          <h3>Come funziona</h3>
          <HowItWorks />
          <button className="btn ghost" onClick={onDemo}>
            <Eye size={18} /> Guarda l’anteprima con dati di esempio
          </button>
        </div>
      </div>
    </div>
  )
}

export function JoinPage({
  backend,
  initialCode,
  error,
  onJoined,
  onSignOut,
  onDemo,
}: {
  backend: Backend
  initialCode?: string
  error?: string | null
  onJoined: (groupId: string) => void
  onSignOut: () => void
  onDemo: () => void
}) {
  const toast = useToast()
  const [code, setCode] = useState(initialCode ?? '')
  const [busy, setBusy] = useState(false)
  return (
    <div className="center-page">
      <div className="auth-card stack-lg">
        <Hero subtitle="Manca solo l’ingresso nel gruppo." />
        <form
          className="card stack"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            try {
              onJoined(await backend.joinGroup(code))
            } catch (err) {
              toast(errorMessage(err), 'error')
            } finally {
              setBusy(false)
            }
          }}
        >
          {error && <Notice tone="bad">{error}</Notice>}
          <label className="field">
            <span>Codice d’invito</span>
            <input
              className="input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Es. K7PQ3MXA"
              autoCapitalize="characters"
              required
            />
            <small>Te lo dà l’organizzatore, di solito insieme al link. Se hai aperto il link d’invito, entri da solo.</small>
          </label>
          <button className="btn primary block" type="submit" disabled={busy || code.trim().length < 4}>
            Entra nel gruppo
          </button>
        </form>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn ghost small" onClick={onDemo}>
            Guarda l’anteprima
          </button>
          <button className="btn ghost small" onClick={onSignOut}>
            Esci
          </button>
        </div>
      </div>
    </div>
  )
}

export function SetupMissing({ onDemo, problem }: { onDemo: () => void; problem?: string }) {
  return (
    <div className="center-page">
      <div className="auth-card stack-lg">
        <Hero
          subtitle={
            problem
              ? 'L’app è pubblicata, ma la configurazione ha un errore.'
              : 'L’app è pubblicata, ma non è ancora collegata al database.'
          }
        />
        <div className="card stack">
          {problem ? (
            <Notice tone="bad">{problem}</Notice>
          ) : (
            <p>
              Chi gestisce l’app deve creare il progetto Supabase e inserire su GitHub le variabili <code>SUPABASE_URL</code> e{' '}
              <code>SUPABASE_KEY</code>. I passaggi sono nel file README del repository.
            </p>
          )}
          {problem && (
            <p className="small muted">
              Dopo aver corretto la variabile su GitHub, l’app va ripubblicata (Actions → Test e pubblicazione → Run workflow).
            </p>
          )}
          <button className="btn primary" onClick={onDemo}>
            <Eye size={18} /> Intanto guarda l’anteprima
          </button>
        </div>
      </div>
    </div>
  )
}
