import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const root = fileURLToPath(new URL('../../', import.meta.url))
export const DATABASE_URL = process.env.DATABASE_URL

/** Crea un database nuovo, carica il finto "auth" di Supabase e lo schema. */
export async function createTestDb() {
  const admin = new pg.Client({ connectionString: DATABASE_URL })
  await admin.connect()
  const name = `cena_t_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
  await admin.query(`create database ${name}`)
  await admin.end()

  const url = new URL(DATABASE_URL!)
  url.pathname = `/${name}`
  const pool = new pg.Pool({ connectionString: url.toString(), max: 4 })
  pool.on('error', () => {})
  const c = await pool.connect()
  await c.query('set client_min_messages = error')
  await c.query(readFileSync(`${root}supabase/local/auth-mock.sql`, 'utf8'))
  await c.query(readFileSync(`${root}supabase/schema.sql`, 'utf8'))
  c.release()

  const db = new TestDb(pool)
  return {
    db,
    async drop() {
      await pool.end()
      const a = new pg.Client({ connectionString: DATABASE_URL })
      await a.connect()
      await a.query(`drop database if exists ${name} with (force)`)
      await a.end()
    },
  }
}

function param(v: unknown) {
  if (v === null || v === undefined) return null
  if (Array.isArray(v)) return v
  if (typeof v === 'object') return JSON.stringify(v)
  return v
}

export class TestDb {
  constructor(public pool: pg.Pool) {}

  /** Query come superutente (vede tutto, salta la RLS). */
  async sql<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.pool.query(text, params.map(param))
    return r.rows as T[]
  }

  /** Esegue una query come utente autenticato (con RLS). */
  async asUser<T = any>(user: string | null, text: string, params: unknown[] = [], role = 'authenticated'): Promise<T[]> {
    const c = await this.pool.connect()
    try {
      await c.query('begin')
      await c.query(`set local role ${role}`)
      await c.query("select set_config('request.jwt.claims', $1, true)", [user ? JSON.stringify({ sub: user, role }) : ''])
      const r = await c.query(text, params.map(param))
      await c.query('commit')
      return r.rows as T[]
    } catch (e) {
      await c.query('rollback')
      throw e
    } finally {
      c.release()
    }
  }

  /** Chiama una RPC pubblica come un utente. */
  async rpc<T = any>(user: string | null, fn: string, args: Record<string, unknown> = {}, role = 'authenticated'): Promise<T> {
    const names = Object.keys(args)
    const call = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`
    const rows = await this.asUser(
      user,
      call,
      names.map((n) => args[n]),
      role,
    )
    return rows[0]?.r as T
  }

  async createUser(name: string, email = `${name.toLowerCase()}@example.com`) {
    const id = randomUUID()
    await this.sql('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [id, email, { full_name: name }])
    return id
  }

  /** Crea un gruppo con regole personalizzate e restituisce id e codice. */
  async createGroup(rules: Record<string, unknown> = {}) {
    const [g] = await this.sql(
      `insert into public.groups (name, settings)
       values ('Test', private.validate_rules(private.default_rules() || $1::jsonb)) returning id`,
      [rules],
    )
    const code = `T${Math.random().toString(36).slice(2, 10).toUpperCase()}`
    await this.sql('insert into public.group_invites (group_id, code) values ($1, $2)', [g.id, code])
    return { gid: g.id as string, code }
  }

  /** Gruppo con giocatori già entrati: il primo è l'organizzatore. */
  async groupWith(names: string[], rules: Record<string, unknown> = {}) {
    const { gid, code } = await this.createGroup(rules)
    const users: Record<string, string> = {}
    for (const n of names) {
      users[n] = await this.createUser(n)
      await this.rpc(users[n], 'join_group', { p_code: code })
    }
    return { gid, code, users, ids: names.map((n) => users[n]) }
  }

  async state(user: string, gid: string) {
    return this.rpc<any>(user, 'get_state', { p_group: gid })
  }

  async currentRound(gid: string) {
    const [r] = await this.sql(`select * from public.rounds where group_id = $1 and status <> 'closed'`, [gid])
    return r
  }

  async today(): Promise<string> {
    const [r] = await this.sql(`select private.today()::text as d`)
    return r.d
  }
}

export const sc = (menu: number, location: number, conto: number, servizio: number) => ({
  menu,
  location,
  conto,
  servizio,
})
