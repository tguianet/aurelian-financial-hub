-- Memoria semantica do lancamento rapido / documentos.
-- Isolada por finance_space. Nao altera transactions existentes.

create table if not exists public.finance_semantic_rules (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.finance_spaces(id) on delete cascade,
  user_id uuid not null,
  rule_type text not null check (rule_type in ('entity', 'category', 'entity_category')),
  normalized_hint text not null,
  original_hint text,
  entity_id uuid references public.financial_entities(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  usage_count integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_semantic_rules_hint_len check (char_length(btrim(normalized_hint)) between 3 and 80),
  constraint finance_semantic_rules_target check (entity_id is not null or category_id is not null)
);

create unique index if not exists finance_semantic_rules_space_hint_uidx
  on public.finance_semantic_rules (space_id, normalized_hint);

create index if not exists finance_semantic_rules_space_active_idx
  on public.finance_semantic_rules (space_id, active);

drop trigger if exists finance_semantic_rules_touch_updated_at on public.finance_semantic_rules;
create trigger finance_semantic_rules_touch_updated_at
  before update on public.finance_semantic_rules
  for each row execute function public.touch_updated_at();

alter table public.finance_semantic_rules enable row level security;

drop policy if exists finance_semantic_rules_space_read on public.finance_semantic_rules;
create policy finance_semantic_rules_space_read
  on public.finance_semantic_rules
  for select to authenticated
  using (public.is_finance_space_member(space_id));

drop policy if exists finance_semantic_rules_space_write on public.finance_semantic_rules;
create policy finance_semantic_rules_space_write
  on public.finance_semantic_rules
  for all to authenticated
  using (public.can_write_finance_space(space_id))
  with check (public.can_write_finance_space(space_id));

revoke all on table public.finance_semantic_rules from public, anon;
grant select on table public.finance_semantic_rules to authenticated;
grant all on table public.finance_semantic_rules to service_role;

create or replace function public.normalize_finance_semantic_hint(p_text text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(
    btrim(regexp_replace(lower(btrim(coalesce(p_text, ''))), '\s+', ' ', 'g')),
    ''
  );
$$;

create or replace function public.derive_finance_semantic_rule_type(p_entity_id uuid, p_category_id uuid)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_entity_id is not null and p_category_id is not null then 'entity_category'
    when p_entity_id is not null then 'entity'
    when p_category_id is not null then 'category'
    else null
  end;
$$;

create or replace function public.upsert_finance_semantic_rule(
  p_normalized_hint text,
  p_original_hint text default null,
  p_entity_id uuid default null,
  p_category_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_hint text;
  v_entity uuid;
  v_category uuid;
  v_type text;
  v_id uuid;
begin
  if v_user is null then raise exception 'sessao invalida'; end if;
  v_space := public.current_finance_space_id();
  perform public.assert_writable_finance_space(v_space);

  v_hint := public.normalize_finance_semantic_hint(p_normalized_hint);
  if v_hint is null or char_length(v_hint) < 3 then
    raise exception 'hint invalido';
  end if;
  v_hint := left(v_hint, 80);

  v_entity := p_entity_id;
  v_category := p_category_id;

  if v_entity is not null then
    if not exists (
      select 1 from public.financial_entities e
      where e.id = v_entity and e.space_id = v_space and e.is_demo = false
    ) then
      raise exception 'entidade invalida';
    end if;
  end if;

  if v_category is not null then
    if not exists (
      select 1 from public.categories c
      where c.id = v_category and c.space_id = v_space and c.is_demo = false
    ) then
      raise exception 'categoria invalida';
    end if;
  end if;

  select id, entity_id, category_id
    into v_id, v_entity, v_category
    from public.finance_semantic_rules
   where space_id = v_space and normalized_hint = v_hint
   for update;

  if v_id is not null then
    v_entity := coalesce(p_entity_id, v_entity);
    v_category := coalesce(p_category_id, v_category);
    v_type := public.derive_finance_semantic_rule_type(v_entity, v_category);
    if v_type is null then raise exception 'informe entidade ou categoria'; end if;
    update public.finance_semantic_rules
       set user_id = v_user,
           original_hint = coalesce(nullif(left(btrim(coalesce(p_original_hint, '')), 80), ''), original_hint),
           entity_id = v_entity,
           category_id = v_category,
           rule_type = v_type,
           active = true
     where id = v_id;
    perform public.write_finance_audit(v_space, 'finance_semantic_rules', v_id, 'update',
      jsonb_build_object('hint', v_hint, 'rule_type', v_type));
    return v_id;
  end if;

  v_entity := p_entity_id;
  v_category := p_category_id;
  v_type := public.derive_finance_semantic_rule_type(v_entity, v_category);
  if v_type is null then raise exception 'informe entidade ou categoria'; end if;

  insert into public.finance_semantic_rules (
    space_id, user_id, rule_type, normalized_hint, original_hint, entity_id, category_id, active
  )
  values (
    v_space,
    v_user,
    v_type,
    v_hint,
    nullif(left(btrim(coalesce(p_original_hint, '')), 80), ''),
    v_entity,
    v_category,
    true
  )
  returning id into v_id;

  perform public.write_finance_audit(v_space, 'finance_semantic_rules', v_id, 'insert',
    jsonb_build_object('hint', v_hint, 'rule_type', v_type));
  return v_id;
end;
$$;

create or replace function public.update_finance_semantic_rule(
  p_id uuid,
  p_normalized_hint text default null,
  p_original_hint text default null,
  p_entity_id uuid default null,
  p_category_id uuid default null,
  p_active boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_hint text;
  v_entity uuid;
  v_category uuid;
  v_active boolean;
begin
  if v_user is null then raise exception 'sessao invalida'; end if;
  select space_id, normalized_hint, entity_id, category_id, active
    into v_space, v_hint, v_entity, v_category, v_active
    from public.finance_semantic_rules
   where id = p_id
   for update;
  if v_space is null then raise exception 'regra invalida'; end if;
  perform public.assert_writable_finance_space(v_space);

  if p_normalized_hint is not null then
    v_hint := public.normalize_finance_semantic_hint(p_normalized_hint);
    if v_hint is null or char_length(v_hint) < 3 then
      raise exception 'hint invalido';
    end if;
    v_hint := left(v_hint, 80);
  end if;

  if p_entity_id is not null then
    if not exists (
      select 1 from public.financial_entities e
      where e.id = p_entity_id and e.space_id = v_space and e.is_demo = false
    ) then
      raise exception 'entidade invalida';
    end if;
    v_entity := p_entity_id;
  end if;

  if p_category_id is not null then
    if not exists (
      select 1 from public.categories c
      where c.id = p_category_id and c.space_id = v_space and c.is_demo = false
    ) then
      raise exception 'categoria invalida';
    end if;
    v_category := p_category_id;
  end if;

  if p_active is not null then v_active := p_active; end if;
  if v_entity is null and v_category is null then
    raise exception 'informe entidade ou categoria';
  end if;

  update public.finance_semantic_rules
     set normalized_hint = v_hint,
         original_hint = case
           when p_original_hint is null then original_hint
           else nullif(left(btrim(p_original_hint), 80), '')
         end,
         entity_id = v_entity,
         category_id = v_category,
         rule_type = public.derive_finance_semantic_rule_type(v_entity, v_category),
         active = v_active,
         user_id = v_user
   where id = p_id;

  perform public.write_finance_audit(v_space, 'finance_semantic_rules', p_id, 'update',
    jsonb_build_object('hint', v_hint, 'active', v_active));
  return p_id;
end;
$$;

create or replace function public.toggle_finance_semantic_rule_active(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_active boolean;
begin
  if v_user is null then raise exception 'sessao invalida'; end if;
  select space_id, active into v_space, v_active
    from public.finance_semantic_rules
   where id = p_id
   for update;
  if v_space is null then raise exception 'regra invalida'; end if;
  perform public.assert_writable_finance_space(v_space);

  update public.finance_semantic_rules
     set active = not v_active,
         user_id = v_user
   where id = p_id;

  perform public.write_finance_audit(v_space, 'finance_semantic_rules', p_id,
    case when v_active then 'deactivate' else 'reactivate' end,
    jsonb_build_object('active', not v_active));
  return not v_active;
end;
$$;

create or replace function public.delete_finance_semantic_rule(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
begin
  if v_user is null then raise exception 'sessao invalida'; end if;
  select space_id into v_space from public.finance_semantic_rules where id = p_id for update;
  if v_space is null then raise exception 'regra invalida'; end if;
  perform public.assert_writable_finance_space(v_space);

  delete from public.finance_semantic_rules where id = p_id;

  perform public.write_finance_audit(v_space, 'finance_semantic_rules', p_id, 'delete', '{}'::jsonb);
  return p_id;
end;
$$;

create or replace function public.touch_finance_semantic_rule_usage(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_space uuid;
  v_count integer;
begin
  if auth.uid() is null then raise exception 'sessao invalida'; end if;
  select space_id, usage_count into v_space, v_count
    from public.finance_semantic_rules
   where id = p_id and active = true
   for update;
  if v_space is null then raise exception 'regra invalida'; end if;
  if not public.is_finance_space_member(v_space) then raise exception 'sem permissao'; end if;

  update public.finance_semantic_rules
     set usage_count = usage_count + 1
   where id = p_id
  returning usage_count into v_count;
  return v_count;
end;
$$;

revoke all on function public.normalize_finance_semantic_hint(text) from public, anon;
grant execute on function public.normalize_finance_semantic_hint(text) to authenticated;
revoke all on function public.derive_finance_semantic_rule_type(uuid, uuid) from public, anon;
grant execute on function public.derive_finance_semantic_rule_type(uuid, uuid) to authenticated;
revoke all on function public.upsert_finance_semantic_rule(text, text, uuid, uuid) from public, anon;
grant execute on function public.upsert_finance_semantic_rule(text, text, uuid, uuid) to authenticated;
revoke all on function public.update_finance_semantic_rule(uuid, text, text, uuid, uuid, boolean) from public, anon;
grant execute on function public.update_finance_semantic_rule(uuid, text, text, uuid, uuid, boolean) to authenticated;
revoke all on function public.toggle_finance_semantic_rule_active(uuid) from public, anon;
grant execute on function public.toggle_finance_semantic_rule_active(uuid) to authenticated;
revoke all on function public.delete_finance_semantic_rule(uuid) from public, anon;
grant execute on function public.delete_finance_semantic_rule(uuid) to authenticated;
revoke all on function public.touch_finance_semantic_rule_usage(uuid) from public, anon;
grant execute on function public.touch_finance_semantic_rule_usage(uuid) to authenticated;
