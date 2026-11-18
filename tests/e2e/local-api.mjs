/*
 * Finto server Supabase per le prove in locale (solo sviluppo).
 * Risponde alle chiamate che fa l'app (RPC e utente corrente) usando un
 * PostgreSQL locale con lo schema caricato, come farebbe PostgREST:
 * ogni chiamata gira con il ruolo "authenticated" e l'id dell'utente preso dal token.
 *
 *   DATABASE_URL=postgres://... PORT=54321 node tests/e2e/local-api.mjs
 */
import http from 'node:http'
import pg from 'pg'

pg.types.setTypeParser(1082, (v) => v) // date -> 'YYYY-MM-DD'
pg.types.setTypeParser(1182, (v) => (v === '{}' ? [] : v.slice(1, -1).split(','))) // date[]

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6 })
const PORT = Number(process.env.PORT || 54321)

function claims(req) {
  const auth = req.headers.authorization || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    return payload.sub ? payload : null
  } catch {
    return null
  }
}

function send(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

async function readBody(req) {
  let data = ''
  for await (const chunk of req) data += chunk
  return data ? JSON.parse(data) : {}
}

function param(v) {
  if (v === null || v === undefined) return null
  if (Array.isArray(v)) return v
  if (typeof v === 'object') return JSON.stringify(v)
  return v
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  if (req.method === 'OPTIONS') return send(res, 204)
  const c = claims(req)

  if (url.pathname === '/auth/v1/user') {
    if (!c) return send(res, 401, { message: 'not logged in' })
    const { rows } = await pool.query('select id, email, raw_user_meta_data from auth.users where id = $1', [c.sub])
    if (!rows[0]) return send(res, 404, { message: 'user not found' })
    return send(res, 200, {
      id: rows[0].id,
      aud: 'authenticated',
      role: 'authenticated',
      email: rows[0].email,
      user_metadata: rows[0].raw_user_meta_data,
      app_metadata: { provider: 'google' },
      created_at: new Date().toISOString(),
    })
  }
  if (url.pathname === '/auth/v1/logout') return send(res, 204)
  if (url.pathname === '/auth/v1/settings') {
    if (req.headers.apikey === 'chiave-sbagliata') return send(res, 401, { message: 'Invalid API key' })
    return send(res, 200, { external: { google: true, email: true } })
  }
  if (url.pathname === '/auth/v1/token')
    return send(res, 400, { error: 'invalid_request', error_description: 'invalid flow state, no valid flow state found' })

  const m = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/)
  if (m && req.method === 'POST') {
    const args = await readBody(req)
    const names = Object.keys(args)
    const sql = `select public.${m[1]}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query(`set local role ${c ? 'authenticated' : 'anon'}`)
      await client.query("select set_config('request.jwt.claims', $1, true)", [c ? JSON.stringify(c) : ''])
      const { rows } = await client.query(
        sql,
        names.map((n) => param(args[n])),
      )
      await client.query('commit')
      const r = rows[0]?.r
      return r === '' || r === undefined ? send(res, 204) : send(res, 200, r)
    } catch (e) {
      await client.query('rollback').catch(() => {})
      return send(res, 400, { code: e.code, message: e.message, details: null, hint: null })
    } finally {
      client.release()
    }
  }
  send(res, 404, { message: `not found: ${url.pathname}` })
})

server.listen(PORT, () => console.log(`finto Supabase su http://localhost:${PORT}`))
