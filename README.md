# Cena alla cieca

Il gioco delle cene a sorpresa tra amici.

1. Ognuno mette **in busta** un locale e segna i giorni in cui è libero nei prossimi 90 giorni.
2. L'organizzatore **sorteggia** una busta: nessuno sa di chi è.
3. Si fissa la data tra i giorni buoni per tutti, si va a cena e si **vota** (menu, location, conto, servizio).
4. Al **verdetto** si scopre chi l'aveva proposto. Media sopra il target: vince il premio. Sotto: al giro dopo non può proporre.

Tutte le regole (target, premio, voci di giudizio e pesi, scala dei voti, penalità, apertura e chiusura del voto, giorni ammessi…) si cambiano dall'app, nella scheda **Regole**. Ogni modifica finisce in un registro visibile a tutti, e se nel giro in corso qualcuno ha già votato vale solo dal giro successivo.

L'app è un sito statico su **GitHub Pages**; i dati e il login stanno su **Supabase** (piano gratuito).

- Indirizzo dell'app, una volta pubblicata: `https://peroxhub.github.io/Forchettata/`
- Anteprima con dati di esempio (non serve configurare niente): `https://peroxhub.github.io/Forchettata/?anteprima`

---

## Mettere online l'app (circa 30 minuti, una volta sola)

Servono: un account [Supabase](https://supabase.com), un account Google e l'accesso a questo repository GitHub.

### 1. Crea il database su Supabase

1. Su supabase.com crea un nuovo progetto (piano Free, regione europea, es. Frankfurt). Annota la password del database in un posto sicuro.
2. Apri **SQL Editor**, incolla tutto il contenuto di [`supabase/schema.sql`](supabase/schema.sql) e premi **Run**.
3. In fondo compare una tabellina con il **codice d'invito** del gruppo (es. `K7PQ3MXA`): ti serve al punto 5.
   Se lo perdi, rieseguilo con: `select code from group_invites;`
4. Copia i due valori che servono all'app (in **Project Settings**, alle voci *Data API* e *API Keys*):
   - **Project URL**, tipo `https://abcdefgh.supabase.co`
   - **Publishable key** (`sb_publishable_…`; nei progetti più vecchi si chiama *anon public*).
     Questa chiave è fatta per stare nel sito: la sicurezza la garantiscono le regole del database. Non usare mai la *secret* / *service_role*.

### 2. Accesso con Google

1. Su [console.cloud.google.com](https://console.cloud.google.com) crea un progetto (es. "Cena alla cieca").
2. Apri **Google Auth Platform** (o *API e servizi → Schermata consenso OAuth*):
   - *Branding*: nome dell'app ed email di assistenza.
   - *Pubblico / Audience*: tipo **Esterno**, poi **Pubblica app** (In produzione). Così può entrare chiunque abbia un account Google; con i soli dati base (nome ed email) Google non chiede verifiche.
   - *Client*: **Crea client** → tipo **Applicazione web**.
     - Origini JavaScript autorizzate: `https://peroxhub.github.io`
     - URI di reindirizzamento autorizzati: l'indirizzo di callback che Supabase mostra nella pagina del provider Google (tipo `https://abcdefgh.supabase.co/auth/v1/callback`).
3. Copia **ID client** e **Client secret**.
4. In Supabase: **Authentication → Sign In / Providers → Google** → attiva, incolla ID e secret, salva.
5. In Supabase: **Authentication → URL Configuration**:
   - **Site URL**: `https://peroxhub.github.io/Forchettata/`
   - **Redirect URLs**: aggiungi `https://peroxhub.github.io/Forchettata/` (e, se provi l'app sul computer, `http://localhost:5173/`).

**Accesso via email (facoltativo).** È già attivo: chi non vuole usare Google riceve un link. Due cose da sapere:

- il servizio email gratuito di Supabase manda poche email all'ora, quindi Google resta la strada principale (per mandarne di più serve un tuo SMTP, in *Authentication → Emails → SMTP Settings*);
- il link funziona se aperto dallo stesso dispositivo. Per poter scrivere anche il codice a mano, in *Authentication → Emails → Templates → Magic Link* aggiungi al testo: `Il tuo codice: {{ .Token }}`.

### 3. Pubblica su GitHub Pages

1. Nel repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → scheda Variables → New repository variable**, e crea:
   - `SUPABASE_URL` = il Project URL
   - `SUPABASE_KEY` = la Publishable key
3. Ogni modifica su `main` pubblica l'app da sola (workflow *Test e pubblicazione*, scheda **Actions**). Per pubblicare subito dopo aver inserito le variabili: Actions → *Test e pubblicazione* → **Run workflow**.

### 4. Primo accesso: diventi organizzatore

Apri `https://peroxhub.github.io/Forchettata/?invito=CODICE` (con il codice del punto 1.3) e accedi con Google.
**Chi entra per primo diventa organizzatore** e apre il giro 1: fallo tu prima di mandare il link agli altri.

### 5. Invita gli amici

Nella scheda **Gruppo** trovi il link d'invito con i pulsanti *Condividi* e *Copia*. Chi lo apre accede con Google ed entra nel gruppo, senza altre registrazioni. Dal telefono si può aggiungere alla schermata Home come un'app.

Se il link finisce in mani sbagliate: *Gruppo → Nuovo link* (quello vecchio smette di funzionare) e, se serve, togli chi non c'entra.

---

## Anonimato: cosa è protetto

- Le **proposte** e i **voti** si leggono solo da chi li ha scritti: lo impone il database (Row Level Security), non l'app. Nessun giocatore, neanche l'organizzatore, può vederli, nemmeno sapendo programmare.
- Il **sorteggio** avviene nel database, non nel browser di qualcuno.
- Il **proponente** del posto estratto viene salvato in modo nascosto e rivelato solo al verdetto (o mai, se le regole dicono "solo se promosso" e il posto viene bocciato).
- Chi ha già votato non si vede: si vede solo quanti hanno votato.
- Il registro attività mostra sorteggi, date, verdetti e modifiche alle regole, mai proposte o voti.

**L'unica eccezione:** chi amministra il progetto Supabase può aprire le tabelle dal pannello di Supabase. Meglio che lo gestisca una persona di fiducia che promette di non sbirciare.

---

## Manutenzione

- **Progetto in pausa.** Al momento il piano gratuito di Supabase mette in pausa i progetti inattivi da circa una settimana. Se l'app dice che non riesce a collegarsi, entra in Supabase e premi *Restore project*: i dati restano.
- **Aggiornare il database.** Se lo schema cambia, basta rieseguire tutto `supabase/schema.sql` nello SQL Editor: aggiorna funzioni e regole di sicurezza senza toccare i dati.
- **Rinominare o eliminare un gruppo.** Lo fa un organizzatore dalla scheda **Gruppo → Impostazioni del gruppo**. Per eliminarlo bisogna riscrivere il nome del gruppo: spariscono giri, proposte, voti, storico e registro, per tutti, e non si torna indietro. Chi era nel gruppo viene portato agli altri suoi gruppi, o alla pagina di ingresso.
- **Più gruppi.** Chiunque abbia accesso può creare un gruppo nuovo (scheda **Gruppo → I tuoi gruppi → Crea un gruppo nuovo**, oppure dalla pagina di ingresso se non è ancora in nessun gruppo) e ne diventa l'organizzatore, con il suo link d'invito, le sue regole e il suo storico. Si passa da un gruppo all'altro dal menu in alto. Ogni persona può organizzare al massimo 10 gruppi.

---

## Per chi sviluppa

```bash
npm install
npm run dev          # app su http://localhost:5173 (senza .env.local parte la pagina "da configurare" + anteprima)
npm test             # test della logica (calendario, medie, classifica, anteprima)
npm run typecheck
npm run format       # Prettier
```

Per collegare l'app in locale a un progetto Supabase copia `.env.example` in `.env.local` e compila i valori.

**Test del database.** Lo schema viene provato su un PostgreSQL vero, simulando l'autenticazione di Supabase (`supabase/local/auth-mock.sql`): anonimato, sorteggio, voto, verdetto, penalità, regole, membri.

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db
```

Girano anche su GitHub Actions a ogni modifica.

**Prova completa nel browser** (facoltativa, serve Playwright). `tests/e2e/local-api.mjs` imita l'API di Supabase su un PostgreSQL locale; `tests/e2e/flow.cjs` fa giocare tre utenti un giro intero: ingresso con invito, proposte, disponibilità, sorteggio, voto, verdetto, penalità, regole.

```bash
# database con schema caricato (auth-mock.sql + schema.sql), poi:
DATABASE_URL=postgres://.../cena_e2e node tests/e2e/local-api.mjs &
VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_KEY=x npx vite --port 5174 &
APP_URL=http://localhost:5174/ DATABASE_URL=postgres://.../cena_e2e node tests/e2e/flow.cjs
```

### Struttura

```
supabase/schema.sql        tabelle, sicurezza (RLS) e regole del gioco (funzioni RPC)
src/lib/                   tipi, date, regole, logica pura, collegamento a Supabase, motore dell'anteprima
src/components/            calendario, disponibilità, busta, urna, voto, verdetto
src/pages/                 Giro, Storico, Classifica, Regole, Gruppo, accesso
tests/unit, tests/db       test automatici
.github/workflows/         test e pubblicazione su GitHub Pages
```

Tutte le scritture passano da funzioni del database (`save_proposal`, `draw_round`, `cast_vote`, `close_round`, `update_settings`…) che controllano le regole; le tabelle sono in sola lettura e filtrate per utente. L'app legge tutto con una sola chiamata (`get_state`) e si aggiorna in tempo reale con Supabase Realtime, più un controllo ogni minuto.
