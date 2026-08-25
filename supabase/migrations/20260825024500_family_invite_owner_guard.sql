-- Protect the canonical finance-space owner and prevent a logged-in member
-- from consuming an invite intended for another person/device.

-- Repair any owner membership that was accidentally downgraded/revoked.
insert into public.finance_space_members(space_id, user_id, role, added_by)
select s.id, s.owner_user_id, 'owner', s.owner_user_id
from public.finance_spaces s
on conflict(space_id, user_id) do update
set role = 'owner',
    revoked_at = null,
    added_by = excluded.added_by;

create or replace function public.protect_finance_space_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  select s.owner_user_id
    into v_owner
  from public.finance_spaces s
  where s.id = old.space_id;

  if old.user_id = v_owner then
    if tg_op = 'DELETE' then
      raise exception 'cannot_remove_finance_space_owner';
    end if;

    if new.space_id is distinct from old.space_id
       or new.user_id is distinct from old.user_id
       or new.role <> 'owner'
       or new.revoked_at is not null then
      raise exception 'cannot_modify_finance_space_owner';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists t_protect_finance_space_owner_membership on public.finance_space_members;
create trigger t_protect_finance_space_owner_membership
before update or delete on public.finance_space_members
for each row execute function public.protect_finance_space_owner_membership();

create or replace function public.is_finance_space_owner(p_space_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.finance_spaces s
    join public.finance_space_members m
      on m.space_id = s.id
     and m.user_id = s.owner_user_id
     and m.revoked_at is null
     and m.role = 'owner'
    where s.id = p_space_id
      and s.owner_user_id = p_user_id
  );
$$;

create or replace function public.create_finance_invite(
  p_recipient_name text,
  p_role text default 'editor',
  p_expires_hours integer default 168
)
returns table(invite_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
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

  select s.id into v_space
  from public.finance_spaces s
  where s.owner_user_id = auth.uid()
  order by s.created_at
  limit 1;

  if v_space is null then raise exception 'owner_space_not_found'; end if;

  insert into public.finance_space_members(space_id,user_id,role,added_by)
  values(v_space,auth.uid(),'owner',auth.uid())
  on conflict(space_id,user_id) do update
  set role='owner', revoked_at=null, added_by=excluded.added_by;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_exp := now() + make_interval(hours => p_expires_hours);

  insert into public.finance_invites(space_id, created_by, recipient_name, role, token_hash, expires_at)
  values(v_space, auth.uid(), trim(p_recipient_name), p_role, extensions.digest(v_token,'sha256'), v_exp)
  returning id into v_id;

  return query select v_id, v_token, v_exp;
end;
$$;

create or replace function public.consume_finance_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v public.finance_invites%rowtype;
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'unauthorized'; end if;

  select * into v
  from public.finance_invites i
  where i.token_hash = extensions.digest(coalesce(p_token,''),'sha256')
  for update;

  if not found then raise exception 'invite_not_found'; end if;
  if v.revoked_at is not null then raise exception 'invite_revoked'; end if;
  if v.used_at is not null then raise exception 'invite_already_used'; end if;
  if v.expires_at <= now() then raise exception 'invite_expired'; end if;

  if exists (
    select 1 from public.finance_spaces s
    where s.id = v.space_id and s.owner_user_id = v_user
  ) then
    raise exception 'owner_cannot_consume_invite';
  end if;

  if exists (
    select 1 from public.finance_space_members m
    where m.space_id = v.space_id
      and m.user_id = v_user
      and m.revoked_at is null
  ) then
    raise exception 'already_member';
  end if;

  insert into public.finance_space_members(space_id,user_id,role,added_by)
  values(v.space_id,v_user,v.role,v.created_by)
  on conflict(space_id,user_id) do update
  set role=excluded.role,
      revoked_at=null,
      added_by=excluded.added_by;

  update public.finance_invites
  set used_at=now(), used_by=v_user
  where id=v.id;

  insert into public.profiles(id,full_name)
  values(v_user,v.recipient_name)
  on conflict(id) do update
  set full_name = case
    when coalesce(public.profiles.full_name,'')='' then excluded.full_name
    else public.profiles.full_name
  end;

  perform public.ensure_finance_default_categories(v.space_id);

  -- Do not revoke a personal owner membership here. current_finance_space_id()
  -- already prefers a shared space when one exists, and owner memberships are canonical.
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
    select s.id as space_id
    from public.finance_spaces s
    where s.owner_user_id = auth.uid()
    order by s.created_at
    limit 1
  )
  select m.user_id,p.full_name,p.email,m.role,m.joined_at,m.revoked_at,(m.user_id=auth.uid())
  from public.finance_space_members m
  join owner_space os on os.space_id=m.space_id
  left join public.profiles p on p.id=m.user_id
  order by case m.role when 'owner' then 0 when 'editor' then 1 else 2 end, m.joined_at;
$$;

create or replace function public.revoke_finance_member(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_space uuid;
begin
  select s.id into v_space
  from public.finance_spaces s
  where s.owner_user_id=auth.uid()
  order by s.created_at
  limit 1;

  if v_space is null then raise exception 'owner_space_not_found'; end if;
  if p_user_id=auth.uid() then raise exception 'cannot_revoke_owner'; end if;

  update public.finance_space_members
  set revoked_at=now()
  where space_id=v_space
    and user_id=p_user_id
    and role<>'owner'
    and revoked_at is null;

  return found;
end;
$$;

revoke all on function public.protect_finance_space_owner_membership() from public, anon, authenticated;
revoke all on function public.create_finance_invite(text,text,integer) from public, anon;
grant execute on function public.create_finance_invite(text,text,integer) to authenticated;
revoke all on function public.consume_finance_invite(text) from public, anon;
grant execute on function public.consume_finance_invite(text) to authenticated;
grant execute on function public.is_finance_space_owner(uuid,uuid) to authenticated;
grant execute on function public.list_finance_family() to authenticated;
grant execute on function public.revoke_finance_member(uuid) to authenticated;
