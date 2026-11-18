/*
 * Prova completa nel browser con tre giocatori, contro il finto Supabase locale.
 *   APP_URL=http://localhost:5174/ DATABASE_URL=postgres://... node tests/e2e/flow.cjs [cartella-screenshot]
 * Richiede: database con schema caricato, tests/e2e/local-api.mjs avviato,
 * e l'app avviata con VITE_SUPABASE_URL=http://localhost:54321.
 */
const { chromium } = require('playwright')
const { randomUUID } = require('node:crypto')
const pg = require('pg')

const APP = process.env.APP_URL || 'http://localhost:5174/'
const OUT = process.argv[2]
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (u) =>
  `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email, exp: Math.floor(Date.now() / 1000) + 86400 })}.firma`
const step = (...a) => console.log('✓', ...a)

function assert(cond, msg) {
  if (!cond) throw new Error(`ATTESO: ${msg}`)
}

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  const [{ code }] = (await db.query('select code from public.group_invites limit 1')).rows
  const users = {}
  for (const name of ['Anna', 'Bruno', 'Carla']) {
    const u = { id: randomUUID(), email: `${name.toLowerCase()}@example.com`, name }
    await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [
      u.id,
      u.email,
      { full_name: name, avatar_url: null },
    ])
    users[name] = u
  }

  const browser = await chromium.launch()
  const errors = []
  const pages = {}
  for (const [name, u] of Object.entries(users)) {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 900 }, locale: 'it-IT', timezoneId: 'Europe/Rome' })
    const session = {
      access_token: jwt(u),
      refresh_token: 'refresh',
      token_type: 'bearer',
      expires_in: 86400,
      expires_at: Math.floor(Date.now() / 1000) + 86400,
      user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, user_metadata: { full_name: name }, app_metadata: {} },
    }
    await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), ['sb-localhost-auth-token', JSON.stringify(session)])
    const page = await ctx.newPage()
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error' && !/websocket|realtime|ERR_CONNECTION_REFUSED|404/i.test(m.text())) errors.push(`${name}: ${m.text()}`)
    })
    pages[name] = page
  }
  const { Anna, Bruno, Carla } = pages
  /** Aspetta un avviso che corrisponda al testo; se non arriva mostra quelli presenti. */
  const expectToast = async (p, re, msg) => {
    const t = p.locator('.toast').filter({ hasText: re }).first()
    try {
      await t.waitFor({ timeout: 6000 })
      return (await t.textContent()).trim()
    } catch {
      const all = await p.locator('.toast').allTextContents()
      throw new Error(`ATTESO: ${msg} (avvisi: ${all.join(' | ') || 'nessuno'})`)
    }
  }
  const shot = (p, n) => OUT && p.screenshot({ path: `${OUT}/e2e-${n}.png`, fullPage: true })
  const reload = async (p) => {
    await p.reload()
    await p.waitForSelector('.hero, h1')
  }

  // 1. Ingresso con il link d'invito: Anna per prima diventa organizzatrice
  for (const name of ['Anna', 'Bruno', 'Carla']) {
    await pages[name].goto(`${APP}?invito=${code}`)
    await pages[name].waitForSelector('.hero', { timeout: 10000 })
  }
  assert((await Anna.locator('.hero h1').textContent()) === 'Giro 1', 'giro 1 aperto')
  assert(await Anna.getByRole('button', { name: 'Sorteggia', exact: true }).count(), 'Anna vede il sorteggio')
  assert(!(await Bruno.getByRole('button', { name: 'Sorteggia', exact: true }).count()), 'Bruno non vede il sorteggio')
  assert(!(await Bruno.url()).includes('invito'), 'il codice sparisce dall’indirizzo')
  step('tre giocatori entrati, Anna organizzatrice')

  // 2. Proposte
  for (const [p, place] of [
    [Bruno, 'Osteria di Bruno'],
    [Carla, 'Pizzeria di Carla'],
  ]) {
    await p.getByLabel('Nome del locale').fill(place)
    await p.getByRole('button', { name: 'Metti in busta' }).click()
    await expectToast(p, 'Busta chiusa', 'busta salvata')
  }
  await reload(Anna)
  assert((await Anna.locator('text=2 buste chiuse').count()) === 1, 'Anna vede 2 buste')
  assert((await Anna.content()).indexOf('Osteria di Bruno') === -1, 'Anna non vede le proposte altrui')
  step('proposte in busta, contenuto invisibile agli altri')

  // 3. Disponibilità
  for (const p of [Anna, Bruno, Carla]) {
    await p.getByRole('button', { name: 'Tutti i sabato' }).click()
    await p.getByRole('button', { name: 'Salva disponibilità' }).click()
    await expectToast(p, 'Disponibilità salvata', 'disponibilità salvata')
  }
  await reload(Anna)
  assert(await Anna.locator('text=Hanno risposto 3 su 3').count(), 'tutti hanno risposto')
  assert(await Anna.locator('text=vanno bene a tutti').count(), 'giorni comuni trovati')
  await shot(Anna, '1-proposte')
  step('disponibilità di tutti e giorni comuni')

  // 4. Sorteggio
  await Anna.getByRole('button', { name: 'Sorteggia', exact: true }).click()
  await Anna.getByRole('dialog').getByRole('button', { name: 'Sorteggia' }).click()
  const drawn = (await expectToast(Anna, 'Estratto:', 'sorteggio')).replace('Estratto: ', '')
  const proposer = drawn.includes('Bruno') ? 'Bruno' : 'Carla'
  const other = proposer === 'Bruno' ? 'Carla' : 'Bruno'
  await reload(pages[proposer])
  await reload(pages[other])
  assert(await pages[proposer].locator('text=È il tuo posto.').count(), 'il proponente lo sa')
  assert(!(await pages[other].locator('text=È il tuo posto').count()), 'l’altro non lo sa')
  step(`sorteggiato “${drawn}” (di ${proposer}), lo sa solo ${proposer}`)

  // 5. Data della cena oggi: il voto si apre
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date())
  await Anna.getByLabel('Data della cena').fill(today)
  await Anna.getByRole('button', { name: 'Fissa la data' }).click()
  await expectToast(Anna, 'Data della cena fissata', 'data fissata')
  await reload(pages[other])
  await reload(pages[proposer])
  assert(await pages[proposer].locator('text=stavolta non voti').count(), 'il proponente non vota')
  assert(!(await pages[proposer].getByRole('radiogroup').count()), 'nessun modulo di voto per il proponente')
  await shot(pages[other], '2-voto')

  // 6. Voti bassi: sarà bocciato
  for (const p of [Anna, pages[other]]) {
    for (const label of ['Menu', 'Location', 'Conto', 'Servizio']) {
      await p.getByRole('radiogroup', { name: label }).getByRole('radio', { name: '5', exact: true }).click()
    }
    await p.getByRole('button', { name: 'Vota', exact: true }).click()
    await expectToast(p, 'Voto salvato', 'voto salvato')
  }
  await reload(Anna)
  assert(await Anna.locator('text=Hanno votato').filter({ hasText: '2' }).count(), 'conteggio voti')
  step('voti dati, il proponente escluso')

  // 7. Chiusura e verdetto
  await Anna.getByRole('button', { name: 'Chiudi la votazione e calcola il verdetto' }).click()
  await Anna.getByRole('dialog').getByRole('button', { name: 'Chiudi e calcola' }).click()
  await expectToast(Anna, 'Bocciato con 5,00', 'bocciato con 5,00')
  await reload(pages[proposer])
  assert((await pages[proposer].locator('.hero h1').textContent()) === 'Giro 2', 'giro 2 aperto')
  assert(await pages[proposer].locator('text=In questo giro non proponi').count(), 'penalità applicata')
  await reload(pages[other])
  assert(await pages[other].locator(`text=Proposto da ${proposer}`).count(), 'proponente rivelato')
  await shot(pages[proposer], '3-bocciato')
  step(`verdetto: bocciato, ${proposer} rivelato e penalizzato`)

  // 8. Regole: Anna cambia il premio, Bruno lo vede nel registro
  await Anna.goto(`${APP}#regole`)
  await Anna.getByRole('button', { name: 'Modifica', exact: true }).click()
  await Anna.getByLabel('Premio').fill('Pizza pagata')
  await Anna.getByRole('button', { name: 'Salva le regole' }).click()
  await expectToast(Anna, 'valgono già per il giro in corso', 'regole applicate al giro in corso')
  await Bruno.goto(`${APP}#regole`)
  await Bruno.waitForSelector('text=Registro delle modifiche')
  assert(await Bruno.locator('text=Premio: nessuno → “Pizza pagata”').count(), 'Bruno vede la modifica')
  assert(!(await Bruno.getByRole('button', { name: 'Modifica', exact: true }).count()), 'Bruno non può modificare')
  step('regole cambiate e registro visibile a tutti')

  // 9. Storico e classifica
  await Carla.goto(`${APP}#storico`)
  await Carla.waitForSelector('text=bocciato')
  await Carla.goto(`${APP}#classifica`)
  await Carla.waitForSelector('text=I posti migliori')
  await shot(Carla, '4-classifica')
  step('storico e classifica')

  await browser.close()
  await db.end()
  if (errors.length) throw new Error('Errori nel browser:\n' + errors.join('\n'))
  console.log('\nTUTTO OK')
}

main().catch((e) => {
  console.error('\n✗', e.message)
  process.exit(1)
})
