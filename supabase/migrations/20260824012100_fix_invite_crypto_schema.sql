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

  select m.space_id into v_space
  from public.finance_space_members m
  where m.user_id=auth.uid() and m.revoked_at is null and m.role='owner'
  order by m.joined_at limit 1;
  if v_space is null then raise exception 'owner_space_not_found'; end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_exp := now() + make_interval(hours => p_expires_hours);

  insert into public.finance_invites(space_id, created_by, recipient_name, role, token_hash, expires_at)
  values(v_space, auth.uid(), trim(p_recipient_name), p_role, extensions.digest(v_token,'sha256'), v_exp)
  returning id into v_id;

  return query select v_id, v_token, v_exp;
end;
$$;

create or replace function public.inspect_finance_invite(p_token text)
returns table(valid boolean, reason text, space_name text, recipient_name text, role text, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v public.finance_invites%rowtype;
  v_space_name text;
begin
  select * into v from public.finance_invites i where i.token_hash=extensions.digest(coalesce(p_token,''),'sha256') limit 1;
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
set search_path = public, extensions, pg_temp
as $$
declare
  v public.finance_invites%rowtype;
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'unauthorized'; end if;

  select * into v
  from public.finance_invites i
  where i.token_hash=extensions.digest(coalesce(p_token,''),'sha256')
  for update;

  if not found then raise exception 'invite_not_found'; end if;
  if v.revoked_at is not null then raise exception 'invite_revoked'; end if;
  if v.used_at is not null then raise exception 'invite_already_used'; end if;
  if v.expires_at <= now() then raise exception 'invite_expired'; end if;

  insert into public.finance_space_members(space_id,user_id,role,added_by)
  values(v.space_id,v_user,v.role,v.created_by)
  on conflict(space_id,user_id) do update set role=excluded.role, revoked_at=null, added_by=excluded.added_by;

  update public.finance_invites set used_at=now(), used_by=v_user where id=v.id;

  insert into public.profiles(id, full_name)
  values(v_user, v.recipient_name)
  on conflict(id) do update set full_name = case when coalesce(public.profiles.full_name,'')='' then excluded.full_name else public.profiles.full_name end;

  return v.space_id;
end;
$$;
