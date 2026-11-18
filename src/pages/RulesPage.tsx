import { useState, type ReactNode } from 'react'
import { ArrowUp, History, Plus, Settings2, Trash2 } from 'lucide-react'
import { useGame } from '../game/context'
import { ActivityList } from '../components/ActivityList'
import { Card, Notice } from '../components/ui'
import { WEEKDAYS_SHORT } from '../lib/dates'
import {
  checkRules,
  CLOSES_LABEL,
  DEFAULT_RULES,
  describeRules,
  newCriterionKey,
  OPENS_LABEL,
  PENALTY_LABEL,
  REVEAL_LABEL,
  TARGET_MODE_LABEL,
} from '../lib/rules'
import type { Rules } from '../lib/types'

export function RulesPage() {
  const { state, round, cur, isAdmin } = useGame()
  const [editing, setEditing] = useState(false)
  const settings = state.settings
  const differs = round && JSON.stringify(round.rules) !== JSON.stringify(settings)

  return (
    <div className="stack-lg">
      <div className="row-between">
        <div className="stack" style={{ gap: 4 }}>
          <h1>Regole del gioco</h1>
          <p className="muted">
            {isAdmin ? 'Puoi cambiarle tu, come organizzatore.' : 'Le decidono gli organizzatori. Ogni modifica resta nel registro.'}
          </p>
        </div>
        {isAdmin && !editing && (
          <button className="btn primary" onClick={() => setEditing(true)}>
            <Settings2 size={18} /> Modifica
          </button>
        )}
      </div>

      {editing ? (
        <RulesEditor onDone={() => setEditing(false)} />
      ) : (
        <>
          {differs && round && (
            <Notice tone="warn">
              Nel giro {round.number} si è già votato, quindi usa ancora le regole precedenti. Quelle qui sotto valgono dal giro{' '}
              {round.number + 1}.
            </Notice>
          )}
          {describeRules(settings).map((sec) => (
            <Card key={sec.title} title={sec.title}>
              <ul className="stack" style={{ gap: 8, margin: 0, paddingLeft: 20 }}>
                {sec.items.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </Card>
          ))}
          {cur && !cur.rules_locked && isAdmin && (
            <p className="small muted">Nel giro in corso nessuno ha ancora votato: se cambi le regole, valgono subito.</p>
          )}
        </>
      )}

      <Card icon={<History size={20} />} title="Registro delle modifiche" sub="Chi ha cambiato cosa, e quando. Lo vedono tutti.">
        <ActivityList filter={(a) => a.kind === 'rules_changed'} limit={30} />
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card title={title}>
      <div className="stack-lg">{children}</div>
    </Card>
  )
}

function Options<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: Record<T, string>
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="seg" role="radiogroup" aria-label={label}>
        {(Object.keys(options) as T[]).map((k) => (
          <button
            key={k}
            type="button"
            className="chip"
            role="radio"
            aria-checked={value === k}
            aria-pressed={value === k}
            onClick={() => onChange(k)}
          >
            {options[k]}
          </button>
        ))}
      </div>
    </div>
  )
}

function Num({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  hint,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  hint?: string
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        className="input narrow"
        type="number"
        inputMode="decimal"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
      />
      {hint && <small>{hint}</small>}
    </label>
  )
}

function Check({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <b style={{ fontWeight: 600 }}>{label}</b>
        {hint && (
          <span className="small muted" style={{ display: 'block' }}>
            {hint}
          </span>
        )}
      </span>
    </label>
  )
}

function RulesEditor({ onDone }: { onDone: () => void }) {
  const { state, cur, round, backend, run, busy, ask } = useGame()
  const [name, setName] = useState(state.group.name)
  const [r, setR] = useState<Rules>(structuredClone(state.settings))
  const set = <K extends keyof Rules>(k: K, v: Rules[K]) => setR((x) => ({ ...x, [k]: v }))
  const problem = checkRules(r) ?? (!name.trim() ? 'Il gruppo deve avere un nome.' : null)

  const setCrit = (i: number, patch: Partial<Rules['criteria'][number]>) =>
    set(
      'criteria',
      r.criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)),
    )
  const move = (i: number, d: number) => {
    const c = [...r.criteria]
    const [x] = c.splice(i, 1)
    c.splice(i + d, 0, x)
    set('criteria', c)
  }

  const save = async () => {
    if (problem) return
    const clean: Rules = { ...r, criteria: r.criteria.map((c) => ({ ...c, label: c.label.trim() })), prize: r.prize.trim() }
    const res = await run(
      () => backend.updateSettings(state.group.id, name, clean),
      (x) =>
        !x.changed
          ? 'Nessuna modifica'
          : x.applied_to_current
            ? 'Regole salvate: valgono già per il giro in corso'
            : `Regole salvate: valgono dal giro ${(round?.number ?? 0) + 1}`,
    )
    if (res) onDone()
  }

  return (
    <div className="stack-lg">
      <Notice tone={cur?.rules_locked ? 'warn' : 'accent'}>
        {cur?.rules_locked
          ? `Nel giro ${round?.number} qualcuno ha già votato: le modifiche partiranno dal giro ${(round?.number ?? 0) + 1}.`
          : 'Nel giro in corso nessuno ha ancora votato: le modifiche valgono subito.'}{' '}
        Ogni modifica viene scritta nel registro, visibile a tutti.
      </Notice>

      <Section title="Gruppo">
        <label className="field">
          <span>Nome del gruppo</span>
          <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
      </Section>

      <Section title="Verdetto e premio">
        <Num
          label="Target"
          value={r.target}
          min={r.scale_min}
          max={r.scale_max}
          step={0.1}
          onChange={(v) => set('target', v)}
          hint={`La media da raggiungere, tra ${r.scale_min} e ${r.scale_max}.`}
        />
        <Options
          label="Il posto è promosso se la media è"
          value={r.target_mode}
          options={TARGET_MODE_LABEL}
          onChange={(v) => set('target_mode', v)}
        />
        <label className="field">
          <span>Premio</span>
          <input
            className="input"
            value={r.prize}
            maxLength={200}
            placeholder="Es. la prossima cena gliela offrono gli altri"
            onChange={(e) => set('prize', e.target.value)}
          />
        </label>
        <Options label="Il nome di chi ha proposto si scopre" value={r.reveal} options={REVEAL_LABEL} onChange={(v) => set('reveal', v)} />
      </Section>

      <Section title="Penalità per chi viene bocciato">
        <Options label="Chi viene bocciato" value={r.penalty} options={PENALTY_LABEL} onChange={(v) => set('penalty', v)} />
        {r.penalty !== 'none' && (
          <Num label="Per quanti giri" value={r.penalty_rounds} min={1} max={10} onChange={(v) => set('penalty_rounds', v)} />
        )}
      </Section>

      <Section title="Voci di giudizio">
        <div className="stack" style={{ gap: 8 }}>
          <div className="row small muted" style={{ gap: 4, flexWrap: 'nowrap' }}>
            <span className="grow">Voce</span>
            <span style={{ width: 58 + 4 + 34 * 2 + 4 }}>Peso</span>
          </div>
          {r.criteria.map((c, i) => (
            <div key={c.key} className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
              <input
                className="input grow"
                value={c.label}
                maxLength={30}
                aria-label={`Nome voce ${i + 1}`}
                onChange={(e) => setCrit(i, { label: e.target.value })}
              />
              <input
                className="input"
                style={{ width: 58, paddingInline: 8 }}
                type="number"
                min={0.1}
                max={10}
                step={0.5}
                value={Number.isFinite(c.weight) ? c.weight : ''}
                aria-label={`Peso di ${c.label || 'questa voce'}`}
                onChange={(e) => setCrit(i, { weight: e.target.value === '' ? NaN : Number(e.target.value) })}
              />
              <button type="button" className="btn ghost small icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Sposta su">
                <ArrowUp size={16} />
              </button>
              <button
                type="button"
                className="btn ghost small icon danger"
                disabled={r.criteria.length <= 1}
                onClick={() =>
                  set(
                    'criteria',
                    r.criteria.filter((_, j) => j !== i),
                  )
                }
                aria-label="Togli voce"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <div>
            <button
              type="button"
              className="btn small"
              disabled={r.criteria.length >= 8}
              onClick={() => set('criteria', [...r.criteria, { key: newCriterionKey(r.criteria.map((c) => c.key)), label: '', weight: 1 }])}
            >
              <Plus size={16} /> Aggiungi voce
            </button>
          </div>
          <p className="small muted">Il peso dice quanto conta la voce nella media finale: con peso 2 conta il doppio.</p>
        </div>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <Num label="Voto minimo" value={r.scale_min} min={0} max={99} onChange={(v) => set('scale_min', v)} />
          <Num label="Voto massimo" value={r.scale_max} min={1} max={100} onChange={(v) => set('scale_max', v)} />
        </div>
        <Check
          label="Mezzi punti"
          hint="Si può votare anche 7,5."
          checked={r.scale_step === 0.5}
          onChange={(v) => set('scale_step', v ? 0.5 : 1)}
        />
      </Section>

      <Section title="Voto">
        <Check
          label="Anche chi ha proposto vota"
          hint="Se lo spegni, la media viene solo da chi non ha scelto il posto."
          checked={r.proposer_votes}
          onChange={(v) => set('proposer_votes', v)}
        />
        <Check
          label="Scarta il voto più alto e il più basso"
          hint="Per ogni voce, solo se votano almeno 5 persone."
          checked={r.trim_extremes}
          onChange={(v) => set('trim_extremes', v)}
        />
        <Options label="Il voto si apre" value={r.voting_opens} options={OPENS_LABEL} onChange={(v) => set('voting_opens', v)} />
        <Options label="Il voto si chiude" value={r.voting_closes} options={CLOSES_LABEL} onChange={(v) => set('voting_closes', v)} />
        {r.voting_closes === 'days_after' && (
          <Num label="Giorni dopo la cena" value={r.close_after_days} min={1} max={30} onChange={(v) => set('close_after_days', v)} />
        )}
      </Section>

      <Section title="Proposte e calendario">
        <Num label="Proposte a testa" value={r.proposals_per_person} min={1} max={5} onChange={(v) => set('proposals_per_person', v)} />
        <Num
          label="Finestra di disponibilità (giorni)"
          value={r.availability_days}
          min={7}
          max={180}
          onChange={(v) => set('availability_days', v)}
          hint="Su quanti giorni a partire dall’apertura del giro si segna la disponibilità."
        />
        <div className="field">
          <span>Giorni della settimana ammessi</span>
          <div className="seg">
            {WEEKDAYS_SHORT.map((w, i) => {
              const d = i + 1
              const on = r.allowed_weekdays.includes(d)
              return (
                <button
                  key={w}
                  type="button"
                  className="chip"
                  aria-pressed={on}
                  onClick={() =>
                    set('allowed_weekdays', on ? r.allowed_weekdays.filter((x) => x !== d) : [...r.allowed_weekdays, d].sort())
                  }
                >
                  {w}
                </button>
              )
            })}
          </div>
        </div>
      </Section>

      {problem && <Notice tone="bad">{problem}</Notice>}
      <div className="row-between">
        <button
          type="button"
          className="btn ghost"
          onClick={async () => {
            if (
              await ask(
                'Ripristinare le regole iniziali?',
                'Il modulo torna ai valori iniziali (target 7, 4 voci…). Il premio resta. Poi devi salvare.',
                'Ripristina',
              )
            )
              setR({ ...structuredClone(DEFAULT_RULES), prize: r.prize })
          }}
        >
          Valori iniziali
        </button>
        <div className="row">
          <button type="button" className="btn ghost" onClick={onDone}>
            Annulla
          </button>
          <button type="button" className="btn primary" disabled={!!problem || busy} onClick={save}>
            Salva le regole
          </button>
        </div>
      </div>
    </div>
  )
}
