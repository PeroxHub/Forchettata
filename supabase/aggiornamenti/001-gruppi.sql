-- =====================================================================
--  Aggiornamento 001: creare, rinominare ed eliminare i gruppi
--
--  Serve a chi ha creato il database con una versione di schema.sql
--  precedente al 19 novembre 2026. Si può eseguire anche più volte.
--  Supabase → SQL Editor → nuova query vuota → incolla tutto → Run.
--  (In alternativa si può rieseguire tutto supabase/schema.sql.)
-- =====================================================================

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

revoke all on function public.create_group(text), public.rename_group(uuid, text), public.delete_group(uuid, text)
  from public, anon;
grant execute on function public.create_group(text), public.rename_group(uuid, text), public.delete_group(uuid, text)
  to authenticated;

select 'Aggiornamento completato' as esito;
