create extension if not exists pgcrypto;

create table if not exists public.finance_spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Minha familia',
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_user_id)
);

create table if not exists public.finance_space_members (
  space_id uuid not null references public.finance_spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','editor','viewer')),
  joined_at timestamptz not null default now(),
  revoked_at timestamptz null,
  added_by uuid null references auth.users(id) on delete set null,
  primary key (space_id, user_id)
);

create table if not exists public.finance_invites (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.finance_spaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  recipient_name text not null,
  role text not null check (role in ('editor','viewer')),
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  used_at timestamptz null,
  used_by uuid null references auth.users(id) on delete set null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists finance_space_members_user_idx
  on public.finance_space_members(user_id) where revoked_at is null;
create index if not exists finance_invites_space_idx
  on public.finance_invites(space_id, created_at desc);

alter table public.finance_spaces enable row level security;
alter table public.finance_space_members enable row level security;
alter table public.finance_invites enable row level security;

insert into public.finance_spaces (owner_user_id, name)
select p.id,
       case
         when p.id = '6cc92453-6f23-4c96-a5a8-f564cb428a0d'::uuid then 'Familia Aurelian'
         else coalesce(nullif(p.full_name,''), 'Meu Aurelian')
       end
from public.profiles p
on conflict (owner_user_id) do nothing;

insert into public.finance_space_members (space_id, user_id, role, added_by)
select s.id, s.owner_user_id, 'owner', s.owner_user_id
from public.finance_spaces s
on conflict (space_id, user_id) do update
set role = 'owner', revoked_at = null;

create or replace function public.is_finance_space_member(p_space_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.finance_space_members m
    where m.space_id = p_space_id
      and m.user_id = p_user_id
      and m.revoked_at is null
  );
$$;

create or replace function public.can_write_finance_space(p_space_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.finance_space_members m
    where m.space_id = p_space_id
      and m.user_id = p_user_id
      and m.revoked_at is null
      and m.role in ('owner','editor')
  );
$$;

create or replace function public.is_finance_space_owner(p_space_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.finance_space_members m
    where m.space_id = p_space_id
      and m.user_id = p_user_id
      and m.revoked_at is null
      and m.role = 'owner'
  );
$$;

create or replace function public.current_finance_space_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.space_id
  from public.finance_space_members m
  where m.user_id = auth.uid()
    and m.revoked_at is null
  order by case m.role when 'owner' then 0 when 'editor' then 1 else 2 end, m.joined_at
  limit 1;
$$;

create or replace function public.shares_finance_space_with(p_other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.finance_space_members me
    join public.finance_space_members other on other.space_id = me.space_id
    where me.user_id = auth.uid()
      and me.revoked_at is null
      and other.user_id = p_other_user_id
      and other.revoked_at is null
  );
$$;

create or replace function public.can_manage_finance_user(p_other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.finance_space_members me
    join public.finance_space_members other on other.space_id = me.space_id
    where me.user_id = auth.uid()
      and me.revoked_at is null
      and me.role in ('owner','editor')
      and other.user_id = p_other_user_id
      and other.revoked_at is null
  );
$$;

grant execute on function public.is_finance_space_member(uuid, uuid) to authenticated;
grant execute on function public.can_write_finance_space(uuid, uuid) to authenticated;
grant execute on function public.is_finance_space_owner(uuid, uuid) to authenticated;
grant execute on function public.current_finance_space_id() to authenticated;
grant execute on function public.shares_finance_space_with(uuid) to authenticated;
grant execute on function public.can_manage_finance_user(uuid) to authenticated;

-- Add a shared-space key to every private financial dataset. Demo rows may remain null.
do $$
declare
  t text;
begin
  foreach t in array array[
    'financial_entities','accounts','categories','credit_cards','transactions',
    'credit_card_purchases','credit_card_installments','budgets','reserves',
    'recurring_transactions','ai_insights','financial_snapshots','whatsapp_commands',
    'whatsapp_settings','financial_documents','audit_log'
  ]
  loop
    execute format('alter table public.%I add column if not exists space_id uuid references public.finance_spaces(id) on delete cascade', t);
    execute format('create index if not exists %I on public.%I(space_id)', t || '_space_idx', t);
  end loop;
end $$;

-- Backfill existing rows into each owner's personal space.
do $$
declare
  t text;
begin
  foreach t in array array[
    'financial_entities','accounts','categories','credit_cards','transactions',
    'credit_card_purchases','credit_card_installments','budgets','reserves',
    'recurring_transactions','ai_insights','financial_snapshots','whatsapp_commands',
    'whatsapp_settings','financial_documents','audit_log'
  ]
  loop
    execute format(
      'update public.%I x set space_id = s.id from public.finance_spaces s where x.space_id is null and x.user_id = s.owner_user_id',
      t
    );
  end loop;
end $$;

create or replace function public.assign_finance_space_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  if new.space_id is null then
    new.space_id := public.current_finance_space_id();
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'financial_entities','accounts','categories','credit_cards','transactions',
    'credit_card_purchases','credit_card_installments','budgets','reserves',
    'recurring_transactions','ai_insights','financial_snapshots','whatsapp_commands',
    'financial_documents','audit_log'
  ]
  loop
    execute format('drop trigger if exists t_assign_finance_space on public.%I', t);
    execute format('create trigger t_assign_finance_space before insert on public.%I for each row execute function public.assign_finance_space_on_insert()', t);
  end loop;
end $$;

-- whatsapp_settings has a non-null user_id and uses the same shared space, but remains owner-only below.
drop trigger if exists t_assign_finance_space on public.whatsapp_settings;
create trigger t_assign_finance_space
before insert on public.whatsapp_settings
for each row execute function public.assign_finance_space_on_insert();

-- Replace per-user RLS on the financial tables with shared-space RLS.
do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    'financial_entities','accounts','categories','credit_cards','transactions',
    'credit_card_purchases','credit_card_installments','budgets','reserves',
    'recurring_transactions','ai_insights','financial_snapshots','whatsapp_commands'
  ]
  loop
    for p in select policyname from pg_policies where schemaname='public' and tablename=t
    loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy %I on public.%I for select to authenticated using (is_demo or (space_id is not null and public.is_finance_space_member(space_id)))', t || '_space_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (not is_demo and user_id = auth.uid() and space_id is not null and public.can_write_finance_space(space_id))', t || '_space_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (not is_demo and space_id is not null and public.can_write_finance_space(space_id)) with check (not is_demo and space_id is not null and public.can_write_finance_space(space_id))', t || '_space_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (not is_demo and space_id is not null and public.can_write_finance_space(space_id))', t || '_space_delete', t);
  end loop;
end $$;

-- Documents: shared within the space, writes only by owner/editor.
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='financial_documents'
  loop execute format('drop policy if exists %I on public.financial_documents', p.policyname); end loop;
end $$;
create policy financial_documents_space_read on public.financial_documents
for select to authenticated using (space_id is not null and public.is_finance_space_member(space_id));
create policy financial_documents_space_insert on public.financial_documents
for insert to authenticated with check (user_id=auth.uid() and space_id is not null and public.can_write_finance_space(space_id));
create policy financial_documents_space_update on public.financial_documents
for update to authenticated using (space_id is not null and public.can_write_finance_space(space_id))
with check (space_id is not null and public.can_write_finance_space(space_id));
create policy financial_documents_space_delete on public.financial_documents
for delete to authenticated using (space_id is not null and public.can_write_finance_space(space_id));

-- Audit log: all members read, authenticated actor writes into a space they belong to.
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='audit_log'
  loop execute format('drop policy if exists %I on public.audit_log', p.policyname); end loop;
end $$;
create policy audit_space_read on public.audit_log
for select to authenticated using (space_id is not null and public.is_finance_space_member(space_id));
create policy audit_space_insert on public.audit_log
for insert to authenticated with check (user_id=auth.uid() and space_id is not null and public.is_finance_space_member(space_id));

-- WhatsApp credentials stay owner-only even when finances are shared.
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='whatsapp_settings'
  loop execute format('drop policy if exists %I on public.whatsapp_settings', p.policyname); end loop;
end $$;
create policy whatsapp_settings_owner_read on public.whatsapp_settings
for select to authenticated using (space_id is not null and public.is_finance_space_owner(space_id));
create policy whatsapp_settings_owner_insert on public.whatsapp_settings
for insert to authenticated with check (user_id=auth.uid() and space_id is not null and public.is_finance_space_owner(space_id));
create policy whatsapp_settings_owner_update on public.whatsapp_settings
for update to authenticated using (space_id is not null and public.is_finance_space_owner(space_id))
with check (space_id is not null and public.is_finance_space_owner(space_id));
create policy whatsapp_settings_owner_delete on public.whatsapp_settings
for delete to authenticated using (space_id is not null and public.is_finance_space_owner(space_id));

-- Membership and space metadata policies.
drop policy if exists finance_spaces_read on public.finance_spaces;
drop policy if exists finance_spaces_owner_update on public.finance_spaces;
create policy finance_spaces_read on public.finance_spaces
for select to authenticated using (public.is_finance_space_member(id));
create policy finance_spaces_owner_update on public.finance_spaces
for update to authenticated using (public.is_finance_space_owner(id))
with check (public.is_finance_space_owner(id));

drop policy if exists finance_members_read on public.finance_space_members;
create policy finance_members_read on public.finance_space_members
for select to authenticated using (public.is_finance_space_member(space_id));

drop policy if exists finance_invites_owner_read on public.finance_invites;
create policy finance_invites_owner_read on public.finance_invites
for select to authenticated using (public.is_finance_space_owner(space_id));

create or replace function public.create_finance_invite(
  p_recipient_name text,
  p_role text default 'editor',
  p_expires_hours integer default 168
)
returns table(invite_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_space uuid;
  v_token text;
  v_id uuid;
  v_exp timestamptz;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if trim(coalesce(p_recipient_name,'')) = '' then raise exception 'recipient_name_required'; end if;
  if p_role not in ('editor','viewer') then raise exception 'invalid_role'; end if;
  if p_expires_hours < 1 or p_expires_hours > 720 then raise exception 'invalid_expiration'; end if;

  select m.space_id into v_space
  from public.finance_space_members m
  where m.user_id=auth.uid() and m.revoked_at is null and m.role='owner'
  order by m.joined_at limit 1;
  if v_space is null then raise exception 'owner_space_not_found'; end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_exp := now() + make_interval(hours => p_expires_hours);

  insert into public.finance_invites(space_id, created_by, recipient_name, role, token_hash, expires_at)
  values(v_space, auth.uid(), trim(p_recipient_name), p_role, digest(v_token,'sha256'), v_exp)
  returning id into v_id;

  return query select v_id, v_token, v_exp;
end;
$$;

create or replace function public.inspect_finance_invite(p_token text)
returns table(valid boolean, reason text, space_name text, recipient_name text, role text, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v public.finance_invites%rowtype;
  v_space_name text;
begin
  select * into v from public.finance_invites i where i.token_hash=digest(coalesce(p_token,''),'sha256') limit 1;
  if not found then return query select false,'not_found',null::text,null::text,null::text,null::timestamptz; return; end if;
  select s.name into v_space_name from public.finance_spaces s where s.id=v.space_id;
  if v.revoked_at is not null then return query select false,'revoked',v_space_name,v.recipient_name,v.role,v.expires_at; return; end if;
  if v.used_at is not null then return query select false,'used',v_space_name,v.recipient_name,v.role,v.expires_at; return; end if;
  if v.expires_at <= now() then return query select false,'expired',v_space_name,v.recipient_name,v.role,v.expires_at; return; end if;
  return query select true,'ok',v_space_name,v.recipient_name,v.role,v.expires_at;
end;
$$;

create or replace function public.consume_finance_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.finance_invites%rowtype;
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'unauthorized'; end if;

  select * into v
  from public.finance_invites i
  where i.token_hash=digest(coalesce(p_token,''),'sha256')
  for update;

  if not found then raise exception 'invite_not_found'; end if;
  if v.revoked_at is not null then raise exception 'invite_revoked'; end if;
  if v.used_at is not null then raise exception 'invite_already_used'; end if;
  if v.expires_at <= now() then raise exception 'invite_expired'; end if;

  insert into public.finance_space_members(space_id,user_id,role,added_by)
  values(v.space_id,v_user,v.role,v.created_by)
  on conflict(space_id,user_id) do update set role=excluded.role, revoked_at=null, added_by=excluded.added_by;

  update public.finance_invites
  set used_at=now(), used_by=v_user
  where id=v.id;

  insert into public.profiles(id, full_name)
  values(v_user, v.recipient_name)
  on conflict(id) do update
    set full_name = case when coalesce(public.profiles.full_name,'')='' then excluded.full_name else public.profiles.full_name end;

  return v.space_id;
end;
$$;

create or replace function public.list_finance_family()
returns table(user_id uuid, full_name text, email text, role text, joined_at timestamptz, revoked_at timestamptz, is_self boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with owner_space as (
    select m.space_id
    from public.finance_space_members m
    where m.user_id=auth.uid() and m.revoked_at is null and m.role='owner'
    order by m.joined_at limit 1
  )
  select m.user_id,p.full_name,p.email,m.role,m.joined_at,m.revoked_at,(m.user_id=auth.uid())
  from public.finance_space_members m
  join owner_space os on os.space_id=m.space_id
  left join public.profiles p on p.id=m.user_id
  order by case m.role when 'owner' then 0 when 'editor' then 1 else 2 end, m.joined_at;
$$;

create or replace function public.list_finance_invites()
returns table(id uuid, recipient_name text, role text, expires_at timestamptz, used_at timestamptz, revoked_at timestamptz, created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.id,i.recipient_name,i.role,i.expires_at,i.used_at,i.revoked_at,i.created_at
  from public.finance_invites i
  where public.is_finance_space_owner(i.space_id)
  order by i.created_at desc;
$$;

create or replace function public.revoke_finance_member(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_space uuid;
begin
  select m.space_id into v_space
  from public.finance_space_members m
  where m.user_id=auth.uid() and m.revoked_at is null and m.role='owner'
  order by m.joined_at limit 1;
  if v_space is null then raise exception 'owner_space_not_found'; end if;
  if p_user_id=auth.uid() then raise exception 'cannot_revoke_owner'; end if;
  update public.finance_space_members
  set revoked_at=now()
  where space_id=v_space and user_id=p_user_id and role<>'owner' and revoked_at is null;
  return found;
end;
$$;

create or replace function public.revoke_finance_invite(p_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.finance_invites i
  set revoked_at=now()
  where i.id=p_invite_id
    and i.used_at is null
    and i.revoked_at is null
    and public.is_finance_space_owner(i.space_id);
  return found;
end;
$$;

grant execute on function public.create_finance_invite(text,text,integer) to authenticated;
grant execute on function public.inspect_finance_invite(text) to anon, authenticated;
grant execute on function public.consume_finance_invite(text) to authenticated;
grant execute on function public.list_finance_family() to authenticated;
grant execute on function public.list_finance_invites() to authenticated;
grant execute on function public.revoke_finance_member(uuid) to authenticated;
grant execute on function public.revoke_finance_invite(uuid) to authenticated;

-- Private storage remains private. A user may upload only inside their own folder,
-- while active members of the same finance space may read/manage shared files.
create or replace function public.can_read_finance_document_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_owner_text text; v_owner uuid;
begin
  v_owner_text := split_part(p_name,'/',1);
  if v_owner_text !~ '^[0-9a-fA-F-]{36}$' then return false; end if;
  v_owner := v_owner_text::uuid;
  return v_owner=auth.uid() or public.shares_finance_space_with(v_owner);
exception when others then return false;
end;
$$;

create or replace function public.can_manage_finance_document_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_owner_text text; v_owner uuid;
begin
  v_owner_text := split_part(p_name,'/',1);
  if v_owner_text !~ '^[0-9a-fA-F-]{36}$' then return false; end if;
  v_owner := v_owner_text::uuid;
  return v_owner=auth.uid() or public.can_manage_finance_user(v_owner);
exception when others then return false;
end;
$$;

grant execute on function public.can_read_finance_document_path(text) to authenticated;
grant execute on function public.can_manage_finance_document_path(text) to authenticated;

drop policy if exists financial_documents_storage_select on storage.objects;
drop policy if exists financial_documents_storage_insert on storage.objects;
drop policy if exists financial_documents_storage_update on storage.objects;
drop policy if exists financial_documents_storage_delete on storage.objects;

create policy financial_documents_storage_select on storage.objects
for select to authenticated
using (bucket_id='financial-documents' and public.can_read_finance_document_path(name));

create policy financial_documents_storage_insert on storage.objects
for insert to authenticated
with check (bucket_id='financial-documents' and split_part(name,'/',1)=auth.uid()::text and public.can_write_finance_space(public.current_finance_space_id()));

create policy financial_documents_storage_update on storage.objects
for update to authenticated
using (bucket_id='financial-documents' and public.can_manage_finance_document_path(name))
with check (bucket_id='financial-documents' and public.can_manage_finance_document_path(name));

create policy financial_documents_storage_delete on storage.objects
for delete to authenticated
using (bucket_id='financial-documents' and public.can_manage_finance_document_path(name));
