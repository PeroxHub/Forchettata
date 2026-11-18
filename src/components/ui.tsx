import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, X } from 'lucide-react'

/* ---------------- logo ---------------- */

export function BrandMark({ className = 'brand-mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="var(--accent)" />
      <rect x="12" y="19" width="40" height="28" rx="4" fill="#fff8ee" />
      <path d="M13 21 L32 36 L51 21" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="32" cy="38" r="7" fill="var(--accent)" stroke="#fff8ee" strokeWidth="2" />
      <path d="M29.5 34.5 v4 a2.5 2.5 0 0 0 5 0 v-4 M32 38.5 v4" stroke="#fff8ee" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  )
}

/* ---------------- card e avvisi ---------------- */

export function Card({
  icon,
  title,
  sub,
  tone,
  children,
  action,
  className = '',
}: {
  icon?: ReactNode
  title?: ReactNode
  sub?: ReactNode
  tone?: 'ok' | 'bad'
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <section className={`card ${tone ? `tone-${tone}` : ''} ${className}`}>
      {(title || icon) && (
        <div className="card-head">
          {icon && <div className="card-icon">{icon}</div>}
          <div className="grow">
            {title && <h2>{title}</h2>}
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Notice({ icon, tone, children }: { icon?: ReactNode; tone?: 'accent' | 'ok' | 'bad' | 'warn'; children: ReactNode }) {
  return (
    <div className={`notice ${tone ? `tone-${tone}` : ''}`}>
      {icon}
      <div className="grow">{children}</div>
    </div>
  )
}

export function Spinner({ label = 'Caricamento…' }: { label?: string }) {
  return (
    <div className="row" style={{ justifyContent: 'center', padding: 40 }} role="status">
      <div className="spinner" />
      <span className="muted">{label}</span>
    </div>
  )
}

/* ---------------- avatar ---------------- */

const COLORS = ['#b5442c', '#2c7a4b', '#3b5ba5', '#8a4fa0', '#b07a12', '#1f7f86', '#a33a6b', '#5d6b2f']

export function Avatar({ name, url, size = 32 }: { name: string; url?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false)
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
  return (
    <span className="avatar" style={{ width: size, height: size, background: COLORS[h % COLORS.length] }} aria-hidden="true">
      {url && !broken ? <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : initials || '?'}
    </span>
  )
}

/* ---------------- modale ---------------- */

export function Modal({
  title,
  children,
  onClose,
  actions,
}: {
  title: string
  children?: ReactNode
  onClose: () => void
  actions?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    ref.current?.querySelector<HTMLElement>('button.primary, button')?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="row-between" style={{ marginBottom: 10 }}>
          <h2>{title}</h2>
          <button className="btn ghost small" onClick={onClose} aria-label="Chiudi">
            <X size={18} />
          </button>
        </div>
        <div className="stack">{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  )
}

/** Chiede conferma prima di un'azione. */
export function useConfirm() {
  const [req, setReq] = useState<null | {
    title: string
    body: ReactNode
    confirm: string
    danger?: boolean
    resolve: (ok: boolean) => void
  }>(null)
  const ask = useCallback(
    (title: string, body: ReactNode, confirm = 'Conferma', danger = false) =>
      new Promise<boolean>((resolve) => setReq({ title, body, confirm, danger, resolve })),
    [],
  )
  const close = (ok: boolean) => {
    req?.resolve(ok)
    setReq(null)
  }
  const dialog = req ? (
    <Modal
      title={req.title}
      onClose={() => close(false)}
      actions={
        <>
          <button className="btn ghost" onClick={() => close(false)}>
            Annulla
          </button>
          <button className={`btn primary ${req.danger ? 'danger' : ''}`} onClick={() => close(true)}>
            {req.confirm}
          </button>
        </>
      }
    >
      <div className="muted">{req.body}</div>
    </Modal>
  ) : null
  return { ask, dialog }
}

/* ---------------- avvisi temporanei ---------------- */

interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
}
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-2), { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            {t.kind === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)

export function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

/** Rende cliccabili i link dentro un testo. */
export function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g)
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer noopener">
            {p.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}
            {p.length > 48 ? '…' : ''}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}
