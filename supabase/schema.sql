-- =====================================================================
--  Cena alla cieca — schema del database (Supabase / PostgreSQL)
--
--  Come si usa: Supabase → SQL Editor → incolla tutto il file → Run.
--  Lo script si può rieseguire: aggiorna funzioni e regole senza
--  cancellare i dati. Alla fine stampa il codice d'invito del gruppo.
--
--  Principi:
--   * Tutte le scritture passano da funzioni (RPC) che controllano le
--     regole del gioco. Nessuno può scrivere direttamente nelle tabelle.
--   * Le proposte e i voti sono leggibili solo da chi li ha scritti.
--   * Il proponente del posto estratto viene rivelato solo al verdetto.
-- =====================================================================

create schema if not exists private;

-- ---------------------------------------------------------------------
--  Tabelle
-- ---------------------------------------------------------------------

create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Cena alla cieca'
              check (char_length(name) between 1 and 60),
  settings    jsonb not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.group_invites (
  group_id    uuid primary key references public.groups(id) on delete cascade,
  code        text not null unique,
  updated_at  timestamptz not null default now()
);

create table if not exists public.members (
  group_id     uuid not null references public.groups(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar_url   text,
  role         text not null default 'player' check (role in ('admin', 'player')),
  active       boolean not null default true,
  joined_at    timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.rounds (
  id                 uuid primary key default gen_random_uuid(),
  group_id           uuid not null references public.groups(id) on delete cascade,
  number             int  not null,
  status             text not null default 'proposals'
                     check (status in ('proposals', 'drawn', 'closed')),
  rules              jsonb not null,
  opened_at          timestamptz not null default now(),
  window_start       date not null,
  window_end         date not null,
  proposals_count    int  not null default 0,
  votes_count        int  not null default 0,
  drawn_proposal_id  uuid,
  place_name         text,
  place_notes        text,
  drawn_at           timestamptz,
  dinner_date        date,
  voting_forced_open boolean not null default false,
  closed_at          timestamptz,
  results            jsonb,
  final_mean         numeric(6, 2),
  outcome            text check (outcome in ('promoted', 'failed')),
  proposer_id        uuid references auth.users(id) on delete set null,
  unique (group_id, number)
);
create unique index if not exists rounds_one_open_per_group
  on public.rounds (group_id) where status <> 'closed';

create table if not exists public.proposals (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references public.rounds(id) on delete cascade,
  group_id    uuid not null references public.groups(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  place_name  text not null check (char_length(place_name) between 1 and 120),
  notes       text check (notes is null or char_length(notes) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists proposals_round_idx on public.proposals (round_id);

create table if not exists public.availability (
  round_id    uuid not null references public.rounds(id) on delete cascade,
  group_id    uuid not null references public.groups(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  days        date[] not null default '{}',
  updated_at  timestamptz not null default now(),
  primary key (round_id, user_id)
);

create table if not exists public.votes (
  round_id    uuid not null references public.rounds(id) on delete cascade,
  group_id    uuid not null references public.groups(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  scores      jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (round_id, user_id)
);

create table if not exists public.penalties (
  id               uuid primary key default gen_random_uuid(),
  group_id         uuid not null references public.groups(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  kind             text not null check (kind in ('no_propose', 'no_vote')),
  from_number      int  not null,
  to_number        int  not null,
  source_round_id  uuid references public.rounds(id) on delete cascade,
  created_at       timestamptz not null default now()
);

create table if not exists public.activity_log (
  id        bigint generated always as identity primary key,
  group_id  uuid not null references public.groups(id) on delete cascade,
  user_id   uuid references auth.users(id) on delete set null,
  at        timestamptz not null default now(),
  kind      text not null,
  details   jsonb not null default '{}'
);
create index if not exists activity_log_group_idx on public.activity_log (group_id, at desc);

-- ---------------------------------------------------------------------
--  Funzioni interne (schema private, non esposte dall'API)
-- ---------------------------------------------------------------------

create or replace function private.today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Europe/Rome')::date
$$;

create or replace function private.random_code(len int default 8)
returns text language sql volatile set search_path = '' as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                           1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, len)
$$;

create or replace function private.default_rules()
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'target', 7,
    'target_mode', 'gt',
    'prize', '',
    'reveal', 'always',
    'penalty', 'no_propose',
    'penalty_rounds', 1,
    'criteria', jsonb_build_array(
      jsonb_build_object('key', 'menu',     'label', 'Menu',     'weight', 1),
      jsonb_build_object('key', 'location', 'label', 'Location', 'weight', 1),
      jsonb_build_object('key', 'conto',    'label', 'Conto',    'weight', 1),
      jsonb_build_object('key', 'servizio', 'label', 'Servizio', 'weight', 1)
    ),
    'scale_min', 1,
    'scale_max', 10,
    'scale_step', 1,
    'proposer_votes', false,
    'trim_extremes', false,
    'voting_opens', 'dinner_day',
    'voting_closes', 'manual',
    'close_after_days', 3,
    'proposals_per_person', 1,
    'availability_days', 90,
    'allowed_weekdays', jsonb_build_array(1, 2, 3, 4, 5, 6, 7)
  )
$$;

-- Controlla e normalizza le regole. Le chiavi mancanti prendono il valore
-- predefinito, quelle sconosciute vengono ignorate.
create or replace function private.validate_rules(p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  r jsonb := private.default_rules() || coalesce(p, '{}'::jsonb);
  o jsonb := '{}'::jsonb;
  c jsonb;
  crit jsonb := '[]'::jsonb;
  keys text[] := '{}';
  k text;
  lbl text;
  w numeric;
  smin numeric;
  smax numeric;
  step numeric;
  target numeric;
  n int;
  days int[];
begin
  -- scala
  if jsonb_typeof(r->'scale_min') is distinct from 'number' or jsonb_typeof(r->'scale_max') is distinct from 'number' then
    raise exception 'La scala dei voti deve essere numerica';
  end if;
  smin := (r->>'scale_min')::numeric;
  smax := (r->>'scale_max')::numeric;
  if smin <> trunc(smin) or smax <> trunc(smax) or smin < 0 or smax > 100 or smin >= smax then
    raise exception 'La scala dei voti deve andare da un intero a un intero più grande (tra 0 e 100)';
  end if;
  step := (r->>'scale_step')::numeric;
  if step is null or step not in (1, 0.5) then
    raise exception 'Il passo dei voti può essere 1 oppure 0,5';
  end if;
  o := o || jsonb_build_object('scale_min', smin, 'scale_max', smax, 'scale_step', step);

  -- target
  if jsonb_typeof(r->'target') is distinct from 'number' then
    raise exception 'Il target deve essere un numero';
  end if;
  target := round((r->>'target')::numeric, 2);
  if target < smin or target > smax then
    raise exception 'Il target deve essere compreso nella scala dei voti (da % a %)', smin, smax;
  end if;
  if coalesce(r->>'target_mode', '') not in ('gt', 'gte') then
    raise exception 'Confronto col target non valido';
  end if;
  o := o || jsonb_build_object('target', target, 'target_mode', r->>'target_mode');

  -- premio e rivelazione
  if jsonb_typeof(r->'prize') is distinct from 'string' or char_length(r->>'prize') > 200 then
    raise exception 'Il premio deve essere un testo di massimo 200 caratteri';
  end if;
  if coalesce(r->>'reveal', '') not in ('always', 'winner_only') then
    raise exception 'Opzione di rivelazione non valida';
  end if;
  o := o || jsonb_build_object('prize', btrim(r->>'prize'), 'reveal', r->>'reveal');

  -- penalità
  if coalesce(r->>'penalty', '') not in ('no_propose', 'no_vote', 'none') then
    raise exception 'Tipo di penalità non valido';
  end if;
  if jsonb_typeof(r->'penalty_rounds') is distinct from 'number'
     or (r->>'penalty_rounds')::numeric <> trunc((r->>'penalty_rounds')::numeric)
     or (r->>'penalty_rounds')::int not between 1 and 10 then
    raise exception 'La durata della penalità deve essere tra 1 e 10 giri';
  end if;
  o := o || jsonb_build_object('penalty', r->>'penalty',
                                   'penalty_rounds', (r->>'penalty_rounds')::int);

  -- voci di giudizio
  if jsonb_typeof(r->'criteria') is distinct from 'array' then
    raise exception 'Le voci di giudizio devono essere un elenco';
  end if;
  n := jsonb_array_length(r->'criteria');
  if n < 1 or n > 8 then
    raise exception 'Servono da 1 a 8 voci di giudizio';
  end if;
  for c in select value from jsonb_array_elements(r->'criteria') loop
    k := c->>'key';
    lbl := btrim(coalesce(c->>'label', ''));
    if k is null or k !~ '^[a-z0-9_]{1,30}$' then
      raise exception 'Codice voce non valido: %', coalesce(k, '(vuoto)');
    end if;
    if k = any(keys) then
      raise exception 'Due voci hanno lo stesso codice: %', k;
    end if;
    if char_length(lbl) not between 1 and 30 then
      raise exception 'Il nome di ogni voce deve avere da 1 a 30 caratteri';
    end if;
    if jsonb_typeof(c->'weight') is distinct from 'number' then
      raise exception 'Il peso della voce % deve essere un numero', lbl;
    end if;
    w := round((c->>'weight')::numeric, 2);
    if w <= 0 or w > 10 then
      raise exception 'Il peso della voce % deve essere maggiore di 0 e al massimo 10', lbl;
    end if;
    keys := keys || k;
    crit := crit || jsonb_build_array(jsonb_build_object('key', k, 'label', lbl, 'weight', w));
  end loop;
  o := o || jsonb_build_object('criteria', crit);

  -- voto
  if jsonb_typeof(r->'proposer_votes') is distinct from 'boolean' or jsonb_typeof(r->'trim_extremes') is distinct from 'boolean' then
    raise exception 'Opzioni di voto non valide';
  end if;
  if coalesce(r->>'voting_opens', '') not in ('after_draw', 'dinner_day') then
    raise exception 'Apertura del voto non valida';
  end if;
  if coalesce(r->>'voting_closes', '') not in ('manual', 'all_voted', 'days_after') then
    raise exception 'Chiusura del voto non valida';
  end if;
  if jsonb_typeof(r->'close_after_days') is distinct from 'number'
     or (r->>'close_after_days')::numeric <> trunc((r->>'close_after_days')::numeric)
     or (r->>'close_after_days')::int not between 1 and 30 then
    raise exception 'I giorni prima della chiusura automatica devono essere tra 1 e 30';
  end if;
  o := o || jsonb_build_object(
    'proposer_votes', (r->>'proposer_votes')::boolean,
    'trim_extremes', (r->>'trim_extremes')::boolean,
    'voting_opens', r->>'voting_opens',
    'voting_closes', r->>'voting_closes',
    'close_after_days', (r->>'close_after_days')::int);

  -- proposte e calendario
  if jsonb_typeof(r->'proposals_per_person') is distinct from 'number'
     or (r->>'proposals_per_person')::numeric <> trunc((r->>'proposals_per_person')::numeric)
     or (r->>'proposals_per_person')::int not between 1 and 5 then
    raise exception 'Le proposte a testa devono essere tra 1 e 5';
  end if;
  if jsonb_typeof(r->'availability_days') is distinct from 'number'
     or (r->>'availability_days')::numeric <> trunc((r->>'availability_days')::numeric)
     or (r->>'availability_days')::int not between 7 and 180 then
    raise exception 'La finestra di disponibilità deve essere tra 7 e 180 giorni';
  end if;
  if jsonb_typeof(r->'allowed_weekdays') is distinct from 'array' then
    raise exception 'I giorni della settimana devono essere un elenco';
  end if;
  select coalesce(array_agg(distinct d order by d), '{}')
    into days
    from (select (value #>> '{}')::int as d from jsonb_array_elements(r->'allowed_weekdays')) s;
  if cardinality(days) = 0 or days[1] < 1 or days[cardinality(days)] > 7 then
    raise exception 'Scegli almeno un giorno della settimana valido';
  end if;
  o := o || jsonb_build_object(
    'proposals_per_person', (r->>'proposals_per_person')::int,
    'availability_days', (r->>'availability_days')::int,
    'allowed_weekdays', to_jsonb(days));

  return o;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Regole non valide: controlla i numeri inseriti';
end
$$;

create or replace function private.is_member(gid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m
    where m.group_id = gid and m.user_id = auth.uid() and m.active)
$$;

create or replace function private.is_admin(gid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m
    where m.group_id = gid and m.user_id = auth.uid() and m.active and m.role = 'admin')
$$;

create or replace function private.require_member(gid uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Devi prima accedere';
  end if;
  if not private.is_member(gid) then
    raise exception 'Non fai parte di questo gruppo';
  end if;
end
$$;

create or replace function private.require_admin(gid uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_member(gid);
  if not private.is_admin(gid) then
    raise exception 'Solo un organizzatore può farlo';
  end if;
end
$$;

create or replace function private.has_penalty(gid uuid, uid uuid, rnum int, k text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.penalties p
    where p.group_id = gid and p.user_id = uid and p.kind = k
      and rnum between p.from_number and p.to_number)
$$;

create or replace function private.round_proposer(rid uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select p.user_id
  from public.rounds r
  join public.proposals p on p.id = r.drawn_proposal_id
  where r.id = rid
$$;

create or replace function private.voting_open(r public.rounds)
returns boolean language sql stable set search_path = '' as $$
  select r.status = 'drawn' and (
    r.voting_forced_open
    or r.rules->>'voting_opens' = 'after_draw'
    or (r.dinner_date is not null and private.today() >= r.dinner_date))
$$;

-- Quanti voti ci si aspetta: membri attivi, escluso il proponente se non
-- vota e chi ha la penalità "non vota".
create or replace function private.expected_voters(r public.rounds)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int
  from public.members m
  where m.group_id = r.group_id and m.active
    and (coalesce((r.rules->>'proposer_votes')::boolean, false)
         or m.user_id is distinct from private.round_proposer(r.id))
    and not private.has_penalty(r.group_id, m.user_id, r.number, 'no_vote')
$$;

create or replace function private.active_votes(r public.rounds)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int
  from public.votes v
  join public.members m on m.group_id = v.group_id and m.user_id = v.user_id and m.active
  where v.round_id = r.id
$$;

create or replace function private.log(gid uuid, k text, d jsonb default '{}'::jsonb,
                                       uid uuid default auth.uid())
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.activity_log (group_id, user_id, kind, details) values (gid, uid, k, d)
$$;

create or replace function private.open_round(gid uuid)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  n int;
  rl jsonb;
  t date := private.today();
  rid uuid;
begin
  select coalesce(max(number), 0) + 1 into n from public.rounds where group_id = gid;
  select settings into rl from public.groups where id = gid;
  insert into public.rounds (group_id, number, rules, window_start, window_end)
  values (gid, n, rl, t, t + ((rl->>'availability_days')::int - 1))
  returning id into rid;
  perform private.log(gid, 'round_opened', jsonb_build_object('round_number', n), null);
  return rid;
end
$$;

-- Calcola le medie del giro. Esclude il voto del proponente se non può votare.
create or replace function private.compute_results(rid uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.rounds;
  c jsonb;
  k text;
  w numeric;
  vals numeric[];
  n int;
  trimmed boolean;
  a numeric;
  total numeric := 0;
  wsum numeric := 0;
  crit jsonb := '[]'::jsonb;
  proposer uuid;
  pv boolean;
  voters int;
begin
  select * into r from public.rounds where id = rid;
  proposer := private.round_proposer(rid);
  pv := coalesce((r.rules->>'proposer_votes')::boolean, false);

  select count(*) into voters from public.votes v
   where v.round_id = rid and (pv or v.user_id is distinct from proposer);
  if voters = 0 then
    raise exception 'Non ha ancora votato nessuno';
  end if;

  for c in select value from jsonb_array_elements(r.rules->'criteria') loop
    k := c->>'key';
    w := (c->>'weight')::numeric;
    select array_agg((v.scores->>k)::numeric order by (v.scores->>k)::numeric)
      into vals
      from public.votes v
     where v.round_id = rid and v.scores ? k
       and (pv or v.user_id is distinct from proposer);
    n := coalesce(cardinality(vals), 0);
    if n = 0 then
      raise exception 'Nessun voto per la voce %', c->>'label';
    end if;
    trimmed := coalesce((r.rules->>'trim_extremes')::boolean, false) and n >= 5;
    if trimmed then
      vals := vals[2:n - 1];
    end if;
    select avg(x) into a from unnest(vals) as x;
    total := total + w * a;
    wsum := wsum + w;
    crit := crit || jsonb_build_array(jsonb_build_object(
      'key', k, 'label', c->>'label', 'weight', w,
      'avg', round(a, 2), 'n', n, 'trimmed', trimmed));
  end loop;

  return jsonb_build_object('criteria', crit, 'voters', voters,
                            'final_mean', round(total / wsum, 2));
end
$$;

create or replace function private.close_round_internal(rid uuid, is_auto boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.rounds;
  res jsonb;
  m numeric;
  tgt numeric;
  promoted boolean;
  proposer uuid;
  revealed uuid;
begin
  select * into r from public.rounds where id = rid for update;
  if not found or r.status <> 'drawn' then
    raise exception 'Questo giro non è in votazione';
  end if;

  res := private.compute_results(rid);
  m := (res->>'final_mean')::numeric;
  tgt := (r.rules->>'target')::numeric;
  promoted := case when r.rules->>'target_mode' = 'gte' then m >= tgt else m > tgt end;
  proposer := private.round_proposer(rid);
  revealed := case when promoted or r.rules->>'reveal' = 'always' then proposer end;

  update public.rounds
     set status = 'closed',
         closed_at = now(),
         results = res - 'final_mean',
         final_mean = m,
         outcome = case when promoted then 'promoted' else 'failed' end,
         proposer_id = revealed
   where id = rid;

  if not promoted and r.rules->>'penalty' <> 'none' and proposer is not null then
    insert into public.penalties (group_id, user_id, kind, from_number, to_number, source_round_id)
    values (r.group_id, proposer, r.rules->>'penalty', r.number + 1,
            r.number + (r.rules->>'penalty_rounds')::int, rid);
  end if;

  perform private.log(r.group_id, 'round_closed',
    jsonb_build_object('round_number', r.number, 'place_name', r.place_name,
                       'outcome', case when promoted then 'promoted' else 'failed' end,
                       'mean', m, 'auto', is_auto),
    case when is_auto then null else auth.uid() end);

  perform private.open_round(r.group_id);

  return jsonb_build_object('outcome', case when promoted then 'promoted' else 'failed' end,
                            'mean', m);
end
$$;

-- Aggiorna i contatori pubblici di buste e voti (senza rivelarne il contenuto).
create or replace function private.refresh_counts()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  rid uuid := coalesce(new.round_id, old.round_id);
begin
  if tg_table_name = 'proposals' then
    update public.rounds
       set proposals_count = (select count(*) from public.proposals where round_id = rid)
     where id = rid;
  else
    update public.rounds
       set votes_count = (select count(*) from public.votes where round_id = rid)
     where id = rid;
  end if;
  return null;
end
$$;

drop trigger if exists proposals_count_trg on public.proposals;
create trigger proposals_count_trg after insert or delete on public.proposals
  for each row execute function private.refresh_counts();

drop trigger if exists votes_count_trg on public.votes;
create trigger votes_count_trg after insert or delete on public.votes
  for each row execute function private.refresh_counts();

-- ---------------------------------------------------------------------
--  API pubblica (chiamata dall'app con supabase.rpc)
-- ---------------------------------------------------------------------

create or replace function public.my_groups()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'role', m.role)
                            order by m.joined_at), '[]'::jsonb)
  from public.members m
  join public.groups g on g.id = m.group_id
  where m.user_id = auth.uid() and m.active
$$;

create or replace function public.join_group(p_code text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  gid uuid;
  nm text;
  av text;
  first_member boolean;
  existing public.members;
begin
  if uid is null then
    raise exception 'Devi prima accedere';
  end if;
  select group_id into gid from public.group_invites
   where code = upper(btrim(coalesce(p_code, '')));
  if gid is null then
    raise exception 'Codice d''invito non valido';
  end if;
  perform 1 from public.groups where id = gid for update;

  select * into existing from public.members where group_id = gid and user_id = uid;
  if found then
    if not existing.active then
      update public.members set active = true where group_id = gid and user_id = uid;
      perform private.log(gid, 'joined', jsonb_build_object('rejoined', true));
    end if;
    return gid;
  end if;

  select left(coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
                       nullif(btrim(u.raw_user_meta_data->>'name'), ''),
                       nullif(split_part(u.email, '@', 1), ''),
                       'Giocatore'), 40),
         u.raw_user_meta_data->>'avatar_url'
    into nm, av
    from auth.users u where u.id = uid;

  first_member := not exists (select 1 from public.members where group_id = gid);
  insert into public.members (group_id, user_id, display_name, avatar_url, role)
  values (gid, uid, coalesce(nm, 'Giocatore'), av,
          case when first_member then 'admin' else 'player' end);
  perform private.log(gid, 'joined', jsonb_build_object('first', first_member));

  if not exists (select 1 from public.rounds where group_id = gid) then
    perform private.open_round(gid);
  end if;
  return gid;
end
$$;

-- Crea un gruppo nuovo: chi lo crea ne diventa organizzatore e si apre il giro 1.
create or replace function public.create_group(p_name text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  nm text := btrim(coalesce(p_name, ''));
  gid uuid;
  c text;
  dn text;
  av text;
begin
  if uid is null then
    raise exception 'Devi prima accedere';
  end if;
  if char_length(nm) not between 1 and 60 then
    raise exception 'Il nome del gruppo deve avere da 1 a 60 caratteri';
  end if;
  if (select count(*) from public.members m
       where m.user_id = uid and m.role = 'admin' and m.active) >= 10 then
    raise exception 'Organizzi già 10 gruppi: è il massimo';
  end if;

  insert into public.groups (name, settings)
  values (nm, private.validate_rules(private.default_rules()))
  returning id into gid;
  loop
    c := private.random_code(8);
    exit when not exists (select 1 from public.group_invites where code = c);
  end loop;
  insert into public.group_invites (group_id, code) values (gid, c);

  select left(coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
                       nullif(btrim(u.raw_user_meta_data->>'name'), ''),
                       nullif(split_part(u.email, '@', 1), ''),
                       'Giocatore'), 40),
         u.raw_user_meta_data->>'avatar_url'
    into dn, av
    from auth.users u where u.id = uid;
  insert into public.members (group_id, user_id, display_name, avatar_url, role)
  values (gid, uid, coalesce(dn, 'Giocatore'), av, 'admin');
  perform private.log(gid, 'joined', jsonb_build_object('first', true));
  perform private.open_round(gid);
  return jsonb_build_object('id', gid, 'code', c);
end
$$;

-- Tutto quello che serve all'app per l'utente corrente, in una chiamata.
create or replace function public.get_state(p_group uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  g public.groups;
  me public.members;
  cur public.rounds;
  proposer uuid;
  t date := private.today();
  is_prop boolean := false;
  can_prop boolean := false;
  prop_reason text;
  can_v boolean := false;
  v_reason text;
  my_prop_count int := 0;
  current_json jsonb;
begin
  perform private.require_member(p_group);
  select * into g from public.groups where id = p_group;
  select * into me from public.members where group_id = p_group and user_id = uid;
  select * into cur from public.rounds where group_id = p_group and status <> 'closed';

  if cur.id is not null then
    proposer := private.round_proposer(cur.id);
    is_prop := cur.status <> 'proposals' and proposer = uid;
    select count(*) into my_prop_count from public.proposals where round_id = cur.id and user_id = uid;

    if cur.status <> 'proposals' then
      prop_reason := 'phase';
    elsif private.has_penalty(p_group, uid, cur.number, 'no_propose') then
      prop_reason := 'penalty';
    elsif my_prop_count >= (cur.rules->>'proposals_per_person')::int then
      prop_reason := 'limit';
    else
      can_prop := true;
    end if;

    if cur.status <> 'drawn' then
      v_reason := 'not_drawn';
    elsif is_prop and not coalesce((cur.rules->>'proposer_votes')::boolean, false) then
      v_reason := 'proposer';
    elsif private.has_penalty(p_group, uid, cur.number, 'no_vote') then
      v_reason := 'penalty';
    elsif not private.voting_open(cur) then
      v_reason := 'not_open';
    else
      can_v := true;
    end if;

    current_json := jsonb_build_object(
      'round_id', cur.id,
      'is_proposer', is_prop,
      'can_propose', can_prop,
      'propose_block_reason', prop_reason,
      'can_vote', can_v,
      'vote_block_reason', v_reason,
      'voting_open', private.voting_open(cur),
      'expected_voters', case when cur.status = 'drawn' then private.expected_voters(cur) end,
      'rules_locked', cur.votes_count > 0,
      'my_proposals', coalesce((
        select jsonb_agg(jsonb_build_object('id', p.id, 'place_name', p.place_name,
                                            'notes', p.notes, 'updated_at', p.updated_at)
                         order by p.created_at)
        from public.proposals p where p.round_id = cur.id and p.user_id = uid), '[]'::jsonb),
      'my_vote', (
        select jsonb_build_object('scores', v.scores, 'updated_at', v.updated_at)
        from public.votes v where v.round_id = cur.id and v.user_id = uid),
      'availability', coalesce((
        select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'days', to_jsonb(a.days),
                                            'updated_at', a.updated_at))
        from public.availability a where a.round_id = cur.id), '[]'::jsonb)
    );
  end if;

  return jsonb_build_object(
    'today', t,
    'group', jsonb_build_object('id', g.id, 'name', g.name),
    'settings', g.settings,
    'me', jsonb_build_object('user_id', me.user_id, 'display_name', me.display_name,
                             'avatar_url', me.avatar_url, 'role', me.role),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'user_id', m.user_id, 'display_name', m.display_name, 'avatar_url', m.avatar_url,
               'role', m.role, 'active', m.active, 'joined_at', m.joined_at)
               order by m.joined_at), '[]'::jsonb)
      from public.members m where m.group_id = p_group),
    'rounds', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.id, 'number', r.number, 'status', r.status, 'rules', r.rules,
               'opened_at', r.opened_at, 'window_start', r.window_start, 'window_end', r.window_end,
               'proposals_count', r.proposals_count, 'votes_count', r.votes_count,
               'place_name', r.place_name, 'place_notes', r.place_notes, 'drawn_at', r.drawn_at,
               'dinner_date', r.dinner_date, 'voting_forced_open', r.voting_forced_open,
               'closed_at', r.closed_at, 'results', r.results, 'final_mean', r.final_mean,
               'outcome', r.outcome, 'proposer_id', r.proposer_id)
               order by r.number desc), '[]'::jsonb)
      from public.rounds r where r.group_id = p_group),
    'current', current_json,
    'my_drawn_round_ids', (
      select coalesce(jsonb_agg(r.id), '[]'::jsonb)
      from public.rounds r join public.proposals p on p.id = r.drawn_proposal_id
      where r.group_id = p_group and p.user_id = uid and r.status <> 'proposals'),
    'my_penalties', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', p.kind, 'from_number', p.from_number, 'to_number', p.to_number)
               order by p.from_number), '[]'::jsonb)
      from public.penalties p where p.group_id = p_group and p.user_id = uid),
    'activity', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', x.id, 'at', x.at, 'user_id', x.user_id, 'kind', x.kind, 'details', x.details)
               order by x.at desc, x.id desc), '[]'::jsonb)
      from (select * from public.activity_log
             where group_id = p_group order by at desc, id desc limit 150) x),
    'invite_code', case when me.role = 'admin'
                        then (select code from public.group_invites where group_id = p_group) end
  );
end
$$;

create or replace function public.save_proposal(p_round uuid, p_place text, p_notes text default null,
                                                p_id uuid default null)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.rounds;
  v_place text := btrim(coalesce(p_place, ''));
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  pid uuid;
begin
  select * into r from public.rounds where id = p_round for update;
  if not found then
    raise exception 'Giro inesistente';
  end if;
  perform private.require_member(r.group_id);
  if r.status <> 'proposals' then
    raise exception 'Le proposte sono chiuse: il sorteggio è già stato fatto';
  end if;
  if private.has_penalty(r.group_id, uid, r.number, 'no_propose') then
    raise exception 'In questo giro non puoi proporre';
  end if;
  if char_length(v_place) = 0 then
    raise exception 'Scrivi il nome del locale';
  end if;

  if p_id is null then
    if (select count(*) from public.proposals where round_id = p_round and user_id = uid)
       >= (r.rules->>'proposals_per_person')::int then
      raise exception 'Hai già messo in busta il numero massimo di proposte';
    end if;
    insert into public.proposals (round_id, group_id, user_id, place_name, notes)
    values (p_round, r.group_id, uid, v_place, v_notes)
    returning id into pid;
  else
    update public.proposals
       set place_name = v_place, notes = v_notes, updated_at = now()
     where id = p_id and round_id = p_round and user_id = uid
    returning id into pid;
    if pid is null then
      raise exception 'Proposta non trovata';
    end if;
  end if;
  return pid;
end
$$;

create or replace function public.delete_proposal(p_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  p public.proposals;
  r public.rounds;
begin
  select * into p from public.proposals where id = p_id and user_id = auth.uid();
  if not found then
    raise exception 'Proposta non trovata';
  end if;
  select * into r from public.rounds where id = p.round_id for update;
  if r.status <> 'proposals' then
    raise exception 'Il sorteggio è già stato fatto: la busta non si può più ritirare';
  end if;
  delete from public.proposals where id = p_id;
end
$$;

create or replace function public.save_availability(p_round uuid, p_days date[])
returns date[] language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.rounds;
  allowed int[];
  clean date[];
begin
  select * into r from public.rounds where id = p_round;
  if not found then
    raise exception 'Giro inesistente';
  end if;
  perform private.require_member(r.group_id);
  if r.status = 'closed' then
    raise exception 'Questo giro è chiuso';
  end if;
  select array_agg((value #>> '{}')::int) into allowed
    from jsonb_array_elements(r.rules->'allowed_weekdays');
  select coalesce(array_agg(distinct d order by d), '{}') into clean
    from unnest(coalesce(p_days, '{}')) as d
   where d between r.window_start and r.window_end
     and extract(isodow from d)::int = any(allowed);

  insert into public.availability (round_id, group_id, user_id, days, updated_at)
  values (p_round, r.group_id, uid, clean, now())
  on conflict (round_id, user_id) do update set days = excluded.days, updated_at = now();
  return clean;
end
$$;

create or replace function public.draw_round(p_round uuid)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.rounds;
  p public.proposals;
begin
  select * into r from public.rounds where id = p_round for update;
  if not found then
    raise exception 'Giro inesistente';
  end if;
  perform private.require_admin(r.group_id);
  if r.status <> 'proposals' then
    raise exception 'Il sorteggio di questo giro è già stato fatto';
  end if;

  select pr.* into p
    from public.proposals pr
    join public.members m on m.group_id = pr.group_id and m.user_id = pr.user_id and m.active
   where pr.round_id = p_round
     and not private.has_penalty(r.group_id, pr.user_id, r.number, 'no_propose')
   order by random()
   limit 1;
  if p.id is null then
    raise exception 'Non ci sono buste da sorteggiare';
  end if;

  update public.rounds
     set status = 'drawn', drawn_proposal_id = p.id, place_name = p.place_name,
         place_notes = p.notes, drawn_at = now()
   where id = p_round;
  perform private.log(r.group_id, 'drawn',
    jsonb_build_object('round_number', r.number, 'place_name', p.place_name,
                       'envelopes', r.proposals_count));
  return p.place_name;
end
$$;

create or replace function public.undo_draw(p_round uuid, p_discard boolean default false)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.rounds;
begin
  select * into r from public.rounds where id = p_round for update;
  if not found then
    raise exception 'Giro inesistente';
  end if;
  perform private.require_admin(r.group_id);
  if r.status <> 'drawn' then
    raise exception 'Non c''è un sorteggio da annullare';
  end if;
  if r.votes_count > 0 then
    raise exception 'Non si può annullare: qualcuno ha già votato';
  end if;
  update public.rounds
     set status = 'proposals', drawn_proposal_id = null, place_name = null, place_notes = null,
         drawn_at = null, dinner_date = null, voting_forced_open = false
   where id = p_round;
  if p_discard then
    delete from public.proposals where id = r.drawn_proposal_id;
  end if;
  perform private.log(r.group_id, 'draw_undone',
    jsonb_build_object('round_number', r.number, 'place_name', r.place_name,
                       'discarded', coalesce(p_discard, false)));
end
$$;

create or replace function public.set_dinner_date(p_round uuid, p_date date)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.rounds;
begin
  select * into r from public.rounds where id = p_round for update;
  if not found then
    raise exception 'Giro inesistente';
  end if;
  perform private.require_admin(r.group_id);
  if r.status <> 'drawn' then
    raise exception 'La data si fissa dopo il sorteggio';
  end if;
  update public.rounds set dinner_date = p_date where id = p_round;
  perform private.log(r.group_id, 'date_set',
    jsonb_build_object('round_number', r.number, 'date', p_date));
end
$$;

create or replace function public.open_voting_now(p_round uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.rounds;
begin
  select * into r from public.rounds where id = p_round for update;
  if not found then
    raise exception 'Giro inesistente';
  end if;
  perform private.require_admin(r.group_id);
  if r.status <> 'drawn' then
    raise exception 'Il voto si apre dopo il sorteggio';
  end if;
  update public.rounds set voting_forced_open = true where id = p_round;
  perform private.log(r.group_id, 'voting_opened', jsonb_build_object('round_number', r.number));
end
$$;

create or replace function public.cast_vote(p_round uuid, p_scores jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.rounds;
  c jsonb;
  k text;
  v numeric;
  smin numeric;
  smax numeric;
  step numeric;
  clean jsonb := '{}'::jsonb;
  res jsonb;
begin
  select * into r from public.rounds where id = p_round for update;
  if not found then
    raise exception 'Giro inesistente';
  end if;
  perform private.require_member(r.group_id);
  if r.status <> 'drawn' then
    raise exception 'Questo giro non è in votazione';
  end if;
  if not private.voting_open(r) then
    raise exception 'Il voto non è ancora aperto';
  end if;
  if not coalesce((r.rules->>'proposer_votes')::boolean, false)
     and private.round_proposer(r.id) = uid then
    raise exception 'È il tuo posto: stavolta giudicano gli altri';
  end if;
  if private.has_penalty(r.group_id, uid, r.number, 'no_vote') then
    raise exception 'In questo giro non puoi votare';
  end if;

  smin := (r.rules->>'scale_min')::numeric;
  smax := (r.rules->>'scale_max')::numeric;
  step := (r.rules->>'scale_step')::numeric;
  for c in select value from jsonb_array_elements(r.rules->'criteria') loop
    k := c->>'key';
    if p_scores is null or jsonb_typeof(p_scores->k) is distinct from 'number' then
      raise exception 'Manca il voto per %', c->>'label';
    end if;
    v := (p_scores->>k)::numeric;
    if v < smin or v > smax or mod(v - smin, step) <> 0 then
      raise exception 'Voto non valido per %: deve andare da % a %', c->>'label', smin, smax;
    end if;
    clean := clean || jsonb_build_object(k, v);
  end loop;

  insert into public.votes (round_id, group_id, user_id, scores)
  values (p_round, r.group_id, uid, clean)
  on conflict (round_id, user_id) do update set scores = excluded.scores, updated_at = now();

  if r.rules->>'voting_closes' = 'all_voted' then
    select * into r from public.rounds where id = p_round;
    if private.active_votes(r) >= private.expected_voters(r) then
      res := private.close_round_internal(p_round, true);
      return jsonb_build_object('closed', true) || res;
    end if;
  end if;
  return jsonb_build_object('closed', false);
end
$$;

create or replace function public.close_round(p_round uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.rounds;
begin
  select * into r from public.rounds where id = p_round;
  if not found then
    raise exception 'Giro inesistente';
  end if;
  perform private.require_admin(r.group_id);
  return private.close_round_internal(p_round, false);
end
$$;

-- Chiusure automatiche: l'app la chiama all'apertura e ogni tanto.
create or replace function public.tick(p_group uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.rounds;
  due boolean := false;
begin
  perform private.require_member(p_group);
  select * into r from public.rounds
   where group_id = p_group and status = 'drawn' for update;
  if not found or r.votes_count = 0 then
    return false;
  end if;
  if r.rules->>'voting_closes' = 'days_after' then
    due := r.dinner_date is not null
           and private.today() >= r.dinner_date + (r.rules->>'close_after_days')::int;
  elsif r.rules->>'voting_closes' = 'all_voted' then
    due := private.voting_open(r) and private.active_votes(r) >= private.expected_voters(r);
  end if;
  if due then
    perform private.close_round_internal(r.id, true);
  end if;
  return due;
end
$$;

create or replace function public.update_settings(p_group uuid, p_name text, p_rules jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  g public.groups;
  newr jsonb;
  changes jsonb := '{}'::jsonb;
  k text;
  cur public.rounds;
  applied boolean := false;
  nm text := btrim(coalesce(p_name, ''));
begin
  perform private.require_admin(p_group);
  select * into g from public.groups where id = p_group for update;
  newr := private.validate_rules(p_rules);
  if char_length(nm) not between 1 and 60 then
    raise exception 'Il nome del gruppo deve avere da 1 a 60 caratteri';
  end if;

  for k in select jsonb_object_keys(newr) loop
    if (g.settings->k) is distinct from (newr->k) then
      changes := changes || jsonb_build_object(k, jsonb_build_object('from', g.settings->k, 'to', newr->k));
    end if;
  end loop;
  if nm <> g.name then
    changes := changes || jsonb_build_object('name', jsonb_build_object('from', g.name, 'to', nm));
  end if;
  if changes = '{}'::jsonb then
    return jsonb_build_object('changed', false, 'applied_to_current', false);
  end if;

  update public.groups set settings = newr, name = nm where id = p_group;

  select * into cur from public.rounds where group_id = p_group and status <> 'closed' for update;
  if found and cur.votes_count = 0 and (changes - 'name') <> '{}'::jsonb then
    update public.rounds
       set rules = newr,
           window_end = window_start + ((newr->>'availability_days')::int - 1)
     where id = cur.id;
    applied := true;
  end if;

  perform private.log(p_group, 'rules_changed',
    jsonb_build_object('changes', changes, 'applied_to_current', applied,
                       'round_number', cur.number));
  return jsonb_build_object('changed', true, 'applied_to_current', applied);
end
$$;

create or replace function public.rename_group(p_group uuid, p_name text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  nm text := btrim(coalesce(p_name, ''));
  old text;
begin
  perform private.require_admin(p_group);
  if char_length(nm) not between 1 and 60 then
    raise exception 'Il nome del gruppo deve avere da 1 a 60 caratteri';
  end if;
  select name into old from public.groups where id = p_group for update;
  if old = nm then
    return;
  end if;
  update public.groups set name = nm where id = p_group;
  perform private.log(p_group, 'group_renamed', jsonb_build_object('from', old, 'to', nm));
end
$$;

-- Elimina il gruppo con tutti i suoi dati (giri, proposte, voti, disponibilità, registro).
-- Per sicurezza bisogna riscrivere il nome del gruppo.
create or replace function public.delete_group(p_group uuid, p_confirm text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  nm text;
begin
  perform private.require_admin(p_group);
  select name into nm from public.groups where id = p_group for update;
  if lower(btrim(coalesce(p_confirm, ''))) <> lower(btrim(nm)) then
    raise exception 'Per confermare scrivi esattamente il nome del gruppo: %', nm;
  end if;
  delete from public.groups where id = p_group;
end
$$;

create or replace function public.update_profile(p_group uuid, p_name text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  nm text := btrim(coalesce(p_name, ''));
begin
  perform private.require_member(p_group);
  if char_length(nm) not between 1 and 40 then
    raise exception 'Il nome deve avere da 1 a 40 caratteri';
  end if;
  update public.members set display_name = nm where group_id = p_group and user_id = auth.uid();
end
$$;

create or replace function public.set_member_role(p_group uuid, p_user uuid, p_role text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  m public.members;
begin
  perform private.require_admin(p_group);
  if coalesce(p_role, '') not in ('admin', 'player') then
    raise exception 'Ruolo non valido';
  end if;
  select * into m from public.members where group_id = p_group and user_id = p_user for update;
  if not found or not m.active then
    raise exception 'Membro non trovato';
  end if;
  if m.role = p_role then
    return;
  end if;
  if p_role = 'player' and (select count(*) from public.members
                             where group_id = p_group and role = 'admin' and active) <= 1 then
    raise exception 'Serve almeno un organizzatore';
  end if;
  update public.members set role = p_role where group_id = p_group and user_id = p_user;
  perform private.log(p_group, 'role_changed', jsonb_build_object('member_id', p_user, 'role', p_role));
end
$$;

create or replace function public.remove_member(p_group uuid, p_user uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  m public.members;
begin
  perform private.require_admin(p_group);
  select * into m from public.members where group_id = p_group and user_id = p_user for update;
  if not found or not m.active then
    raise exception 'Membro non trovato';
  end if;
  if m.role = 'admin' and (select count(*) from public.members
                            where group_id = p_group and role = 'admin' and active) <= 1 then
    raise exception 'Serve almeno un organizzatore: nominane un altro prima';
  end if;
  update public.members set active = false, role = 'player'
   where group_id = p_group and user_id = p_user;
  perform private.log(p_group, 'member_removed', jsonb_build_object('member_id', p_user));
end
$$;

create or replace function public.regenerate_invite(p_group uuid)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  c text;
begin
  perform private.require_admin(p_group);
  loop
    c := private.random_code(8);
    exit when not exists (select 1 from public.group_invites where code = c);
  end loop;
  update public.group_invites set code = c, updated_at = now() where group_id = p_group;
  perform private.log(p_group, 'invite_regenerated');
  return c;
end
$$;

-- ---------------------------------------------------------------------
--  Sicurezza: Row Level Security (solo lettura, le scritture passano dalle RPC)
-- ---------------------------------------------------------------------

alter table public.groups        enable row level security;
alter table public.group_invites enable row level security;
alter table public.members       enable row level security;
alter table public.rounds        enable row level security;
alter table public.proposals     enable row level security;
alter table public.availability  enable row level security;
alter table public.votes         enable row level security;
alter table public.penalties     enable row level security;
alter table public.activity_log  enable row level security;

drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups for select to authenticated
  using (private.is_member(id));

drop policy if exists invites_read on public.group_invites;
create policy invites_read on public.group_invites for select to authenticated
  using (private.is_admin(group_id));

drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated
  using (private.is_member(group_id));

drop policy if exists rounds_read on public.rounds;
create policy rounds_read on public.rounds for select to authenticated
  using (private.is_member(group_id));

drop policy if exists proposals_read_own on public.proposals;
create policy proposals_read_own on public.proposals for select to authenticated
  using (user_id = auth.uid());

drop policy if exists availability_read on public.availability;
create policy availability_read on public.availability for select to authenticated
  using (private.is_member(group_id));

drop policy if exists votes_read_own on public.votes;
create policy votes_read_own on public.votes for select to authenticated
  using (user_id = auth.uid());

drop policy if exists penalties_read_own on public.penalties;
create policy penalties_read_own on public.penalties for select to authenticated
  using (user_id = auth.uid());

drop policy if exists activity_read on public.activity_log;
create policy activity_read on public.activity_log for select to authenticated
  using (private.is_member(group_id));

-- Permessi: niente per gli anonimi, sola lettura per gli utenti autenticati.
revoke all on table public.groups, public.group_invites, public.members, public.rounds,
  public.proposals, public.availability, public.votes, public.penalties, public.activity_log
  from anon, authenticated;
grant select on table public.groups, public.group_invites, public.members, public.rounds,
  public.proposals, public.availability, public.votes, public.penalties, public.activity_log
  to authenticated;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_member(uuid), private.is_admin(uuid) to authenticated;

revoke all on function
  public.my_groups(), public.join_group(text), public.create_group(text), public.get_state(uuid),
  public.save_proposal(uuid, text, text, uuid), public.delete_proposal(uuid),
  public.save_availability(uuid, date[]), public.draw_round(uuid),
  public.undo_draw(uuid, boolean), public.set_dinner_date(uuid, date),
  public.open_voting_now(uuid), public.cast_vote(uuid, jsonb), public.close_round(uuid),
  public.tick(uuid), public.update_settings(uuid, text, jsonb),
  public.update_profile(uuid, text), public.rename_group(uuid, text), public.delete_group(uuid, text),
  public.set_member_role(uuid, uuid, text),
  public.remove_member(uuid, uuid), public.regenerate_invite(uuid)
  from public, anon;
grant execute on function
  public.my_groups(), public.join_group(text), public.create_group(text), public.get_state(uuid),
  public.save_proposal(uuid, text, text, uuid), public.delete_proposal(uuid),
  public.save_availability(uuid, date[]), public.draw_round(uuid),
  public.undo_draw(uuid, boolean), public.set_dinner_date(uuid, date),
  public.open_voting_now(uuid), public.cast_vote(uuid, jsonb), public.close_round(uuid),
  public.tick(uuid), public.update_settings(uuid, text, jsonb),
  public.update_profile(uuid, text), public.rename_group(uuid, text), public.delete_group(uuid, text),
  public.set_member_role(uuid, uuid, text),
  public.remove_member(uuid, uuid), public.regenerate_invite(uuid)
  to authenticated;

-- ---------------------------------------------------------------------
--  Aggiornamenti in tempo reale (Supabase Realtime)
-- ---------------------------------------------------------------------

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['groups', 'members', 'rounds', 'availability', 'activity_log'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public'
                        and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end
$$;

-- ---------------------------------------------------------------------
--  Primo avvio: crea il gruppo e il codice d'invito (solo se non esiste)
-- ---------------------------------------------------------------------

do $$
declare
  gid uuid;
begin
  if not exists (select 1 from public.groups) then
    insert into public.groups (name, settings)
    values ('Cena alla cieca', private.validate_rules(private.default_rules()))
    returning id into gid;
    insert into public.group_invites (group_id, code) values (gid, private.random_code(8));
  end if;
end
$$;

-- Il codice da usare per il primo accesso (chi entra per primo diventa organizzatore).
select g.name as gruppo, i.code as codice_invito
from public.groups g join public.group_invites i on i.group_id = g.id
order by g.created_at;
