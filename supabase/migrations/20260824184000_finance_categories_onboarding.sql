-- Aurelian Finance
-- Onboarding e gestao de categorias por finance_space.
-- Nao edita migrations antigas. Nao apaga nem altera lancamentos reais.

-- ---------------------------------------------------------------------------
-- Coluna active + normalizacao
-- ---------------------------------------------------------------------------

alter table public.categories
  add column if not exists active boolean not null default true;

create or replace function public.normalize_category_name(p_name text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select lower(trim(both from regexp_replace(
    translate(
      coalesce(p_name, ''),
      'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç',
      'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'
    ),
    '\s+',
    ' ',
    'g'
  )));
$$;

-- ---------------------------------------------------------------------------
-- Categorias padrao (idempotente por space_id + nome normalizado + kind)
-- ---------------------------------------------------------------------------

create or replace function public.ensure_finance_default_categories(p_space_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_creator uuid;
  v_inserted integer := 0;
  r record;
begin
  if p_space_id is null then
    raise exception 'space_id obrigatorio';
  end if;

  if not exists (select 1 from public.finance_spaces s where s.id = p_space_id) then
    raise exception 'espaco financeiro nao encontrado';
  end if;

  if auth.uid() is not null
     and not public.can_write_finance_space(p_space_id, auth.uid())
     and not exists (
       select 1 from public.finance_spaces s
       where s.id = p_space_id and s.owner_user_id = auth.uid()
     ) then
    raise exception 'sem permissao de escrita no espaco financeiro';
  end if;

  select s.owner_user_id into v_creator
  from public.finance_spaces s
  where s.id = p_space_id;

  v_creator := coalesce(auth.uid(), v_creator);
  if v_creator is null then
    raise exception 'criador da categoria obrigatorio';
  end if;

  for r in
    select * from (values
      ('Vendas', 'income', '#22C55E'),
      ('Serviços', 'income', '#38BDF8'),
      ('Comissões', 'income', '#E8B923'),
      ('Salário / Pró-labore', 'income', '#A78BFA'),
      ('Rendimentos', 'income', '#14B8A6'),
      ('Reembolsos', 'income', '#818CF8'),
      ('Outras receitas', 'income', '#94A3B8'),
      ('Alimentação', 'expense', '#F59E0B'),
      ('Combustível', 'expense', '#F97316'),
      ('Fornecedores', 'expense', '#FB7185'),
      ('Funcionários', 'expense', '#F43F5E'),
      ('Energia elétrica', 'expense', '#EAB308'),
      ('Água', 'expense', '#06B6D4'),
      ('Internet e telefone', 'expense', '#38BDF8'),
      ('Software e assinaturas', 'expense', '#A78BFA'),
      ('Impostos', 'expense', '#EF4444'),
      ('Veículo', 'expense', '#64748B'),
      ('Manutenção', 'expense', '#78716C'),
      ('Saúde', 'expense', '#10B981'),
      ('Moradia', 'expense', '#64748B'),
      ('Transporte', 'expense', '#0EA5E9'),
      ('Marketing / Publicidade', 'expense', '#D946EF'),
      ('Lazer', 'expense', '#EC4899'),
      ('Educação', 'expense', '#6366F1'),
      ('Tarifas bancárias', 'expense', '#8B5CF6'),
      ('Outras despesas', 'expense', '#8A8A8A')
    ) as seed(name, kind, color)
  loop
    if exists (
      select 1
      from public.categories c
      where c.space_id = p_space_id
        and c.is_demo = false
        and c.kind = r.kind
        and public.normalize_category_name(c.name) = public.normalize_category_name(r.name)
    ) then
      continue;
    end if;

    insert into public.categories(user_id, space_id, is_demo, name, kind, color, active)
    values (v_creator, p_space_id, false, r.name, r.kind, r.color, true);
    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$$;

create or replace function public.seed_finance_space_categories()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.ensure_finance_default_categories(new.id);
  return new;
end;
$$;

drop trigger if exists t_seed_finance_space_categories on public.finance_spaces;
create trigger t_seed_finance_space_categories
after insert on public.finance_spaces
for each row execute function public.seed_finance_space_categories();

-- ---------------------------------------------------------------------------
-- Integridade da tabela categories (autorizacao por space_id)
-- ---------------------------------------------------------------------------

create or replace function public.validate_category_space()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_demo then return new; end if;

  if new.user_id is null then
    raise exception 'user_id obrigatorio';
  end if;

  if new.space_id is null then
    raise exception 'space_id obrigatorio';
  end if;

  if tg_op = 'update' and new.space_id is distinct from old.space_id then
    raise exception 'space_id imutavel';
  end if;

  perform public.assert_writable_finance_space(new.space_id);

  new.name := trim(both from coalesce(new.name, ''));
  if new.name = '' then
    raise exception 'nome da categoria obrigatorio';
  end if;

  if new.kind not in ('income', 'expense') then
    raise exception 'tipo de categoria invalido';
  end if;

  if exists (
    select 1
    from public.categories c
    where c.space_id = new.space_id
      and c.is_demo = false
      and c.kind = new.kind
      and c.id is distinct from new.id
      and public.normalize_category_name(c.name) = public.normalize_category_name(new.name)
  ) then
    raise exception 'ja existe uma categoria com esse nome neste espaco';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_category_space on public.categories;
create trigger validate_category_space
before insert or update on public.categories
for each row execute function public.validate_category_space();

create or replace function public.prevent_used_category_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.is_demo then return old; end if;

  if exists (select 1 from public.transactions t where t.category_id = old.id)
     or exists (select 1 from public.budgets b where b.category_id = old.id)
     or exists (select 1 from public.credit_card_purchases p where p.category_id = old.id)
     or exists (select 1 from public.recurring_transactions r where r.category_id = old.id) then
    raise exception 'categoria em uso; desative em vez de excluir';
  end if;

  return old;
end;
$$;

drop trigger if exists prevent_used_category_delete on public.categories;
create trigger prevent_used_category_delete
before delete on public.categories
for each row execute function public.prevent_used_category_delete();

-- Novos vinculos nao podem usar categoria inativa. Historico (mesmo id) continua valido.
create or replace function public.require_active_category_on_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb := to_jsonb(new);
begin
  if coalesce((v_row->>'is_demo')::boolean, false) then return new; end if;
  if new.category_id is null then return new; end if;
  if tg_op = 'update' and new.category_id is not distinct from old.category_id then
    return new;
  end if;

  if exists (
    select 1 from public.categories c
    where c.id = new.category_id
      and c.is_demo = false
      and c.active = false
  ) then
    raise exception 'categoria inativa';
  end if;

  return new;
end;
$$;

drop trigger if exists require_active_category_on_change on public.transactions;
create trigger require_active_category_on_change
before insert or update on public.transactions
for each row execute function public.require_active_category_on_change();

drop trigger if exists require_active_category_on_change on public.budgets;
create trigger require_active_category_on_change
before insert or update on public.budgets
for each row execute function public.require_active_category_on_change();

drop trigger if exists require_active_category_on_change on public.credit_card_purchases;
create trigger require_active_category_on_change
before insert or update on public.credit_card_purchases
for each row execute function public.require_active_category_on_change();

drop trigger if exists require_active_category_on_change on public.recurring_transactions;
create trigger require_active_category_on_change
before insert or update on public.recurring_transactions
for each row execute function public.require_active_category_on_change();

-- RPC de compra: categoria ativa do mesmo espaco.
create or replace function public.create_credit_card_purchase(
  _credit_card_id uuid,
  _category_id uuid,
  _description text,
  _total_amount numeric,
  _purchase_date date,
  _installments integer default 1
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_space_id uuid;
  v_entity_id uuid;
  v_closing_day integer;
  v_due_day integer;
  v_purchase_id uuid;
  v_first_month date;
  v_due_date date;
  v_base_amount numeric(14,2);
  v_last_amount numeric(14,2);
  i integer;
begin
  if v_user_id is null then raise exception 'sessao invalida'; end if;
  if _total_amount is null or _total_amount <= 0 then raise exception 'valor deve ser maior que zero'; end if;
  if _installments < 1 or _installments > 48 then raise exception 'parcelas devem estar entre 1 e 48'; end if;
  if btrim(coalesce(_description, '')) = '' then raise exception 'descricao obrigatoria'; end if;

  select c.entity_id, c.closing_day, c.due_day, c.space_id
    into v_entity_id, v_closing_day, v_due_day, v_space_id
  from public.credit_cards c
  where c.id = _credit_card_id
    and c.is_demo = false
    and c.active = true;

  if v_entity_id is null or v_space_id is null then
    raise exception 'cartao invalido';
  end if;

  if not public.can_write_finance_space(v_space_id, v_user_id) then
    raise exception 'sem permissao de escrita no espaco financeiro';
  end if;

  if _category_id is not null and not exists (
    select 1
    from public.categories cat
    where cat.id = _category_id
      and cat.kind = 'expense'
      and cat.is_demo = false
      and cat.active = true
      and cat.space_id = v_space_id
  ) then
    raise exception 'categoria de despesa invalida';
  end if;

  insert into public.credit_card_purchases(
    user_id, space_id, is_demo, credit_card_id, entity_id, category_id,
    description, total_amount, purchase_date, installments
  ) values (
    v_user_id, v_space_id, false, _credit_card_id, v_entity_id, _category_id,
    btrim(_description), _total_amount, _purchase_date, _installments
  ) returning id into v_purchase_id;

  v_first_month := date_trunc('month', _purchase_date)::date
    + case when extract(day from _purchase_date)::integer <= v_closing_day
        then interval '1 month' else interval '2 months' end;

  v_base_amount := trunc((_total_amount / _installments)::numeric, 2);
  v_last_amount := _total_amount - (v_base_amount * (_installments - 1));

  for i in 1.._installments loop
    v_due_date := public.card_due_date((v_first_month + ((i - 1) || ' month')::interval)::date, v_due_day);
    insert into public.credit_card_installments(
      user_id, space_id, is_demo, purchase_id, credit_card_id, installment_no, amount, due_date, status
    ) values (
      v_user_id, v_space_id, false, v_purchase_id, _credit_card_id, i,
      case when i = _installments then v_last_amount else v_base_amount end,
      v_due_date, 'pending'
    );
  end loop;

  insert into public.audit_log(user_id, space_id, table_name, record_id, action, details)
  values (
    v_user_id, v_space_id, 'credit_card_purchases', v_purchase_id, 'insert',
    jsonb_build_object('description', btrim(_description), 'amount', _total_amount, 'installments', _installments)
  );

  return v_purchase_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Unique por espaco, se nao houver duplicatas atuais
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from (
      select space_id, public.normalize_category_name(name) as nname, kind
      from public.categories
      where space_id is not null and is_demo = false
      group by 1, 2, 3
      having count(*) > 1
    ) d
  ) then
    execute $idx$
      create unique index if not exists categories_space_normalized_name_kind_unique
      on public.categories (space_id, public.normalize_category_name(name), kind)
      where space_id is not null and is_demo = false
    $idx$;
  end if;
end $$;

create index if not exists categories_space_active_idx
  on public.categories(space_id, kind, active)
  where is_demo = false;

-- ---------------------------------------------------------------------------
-- Onboarding: profile + space + owner + categorias, sem space_id NULL
-- ---------------------------------------------------------------------------

create or replace function public.ensure_finance_workspace(_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_entity_id uuid;
  v_space uuid;
begin
  if _user_id is null then
    raise exception 'user_id obrigatorio';
  end if;

  v_space := public.ensure_finance_space_for_user(_user_id);
  if v_space is null then
    raise exception 'nao foi possivel criar o espaco financeiro';
  end if;

  perform public.ensure_finance_default_categories(v_space);

  for r in
    select * from (values
      ('pessoal', 'Pessoal', 'personal', '#E8B923'),
      ('tguianet', 'TGuiaNet', 'company', '#38BDF8'),
      ('softworks', 'Softworks', 'company', '#A78BFA'),
      ('restaurante', 'Restaurante', 'company', '#F97316'),
      ('buffet', 'Buffet', 'company', '#F43F5E'),
      ('energia', 'Energia', 'company', '#22C55E'),
      ('joias', 'Joias', 'company', '#EAB308')
    ) as seed(slug, name, kind, color)
  loop
    insert into public.financial_entities(user_id, space_id, is_demo, name, slug, kind, color, active)
    values (_user_id, v_space, false, r.name, r.slug, r.kind, r.color, true)
    on conflict (user_id, slug) where user_id is not null and is_demo = false
    do update set
      name = excluded.name,
      kind = excluded.kind,
      color = excluded.color,
      active = true,
      space_id = coalesce(public.financial_entities.space_id, excluded.space_id);

    select id into v_entity_id
    from public.financial_entities
    where user_id = _user_id and slug = r.slug and is_demo = false
    limit 1;

    if not exists (
      select 1 from public.accounts
      where user_id = _user_id and entity_id = v_entity_id and is_demo = false
    ) then
      insert into public.accounts(user_id, space_id, is_demo, entity_id, name, type, opening_balance, active)
      values (_user_id, v_space, false, v_entity_id, 'Conta principal', 'checking', 0, true);
    else
      update public.accounts a
      set space_id = coalesce(a.space_id, v_space)
      where a.user_id = _user_id
        and a.entity_id = v_entity_id
        and a.is_demo = false
        and a.space_id is null;
    end if;
  end loop;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_space uuid;
begin
  insert into public.profiles(id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;

  v_space := public.ensure_finance_space_for_user(new.id);
  perform public.ensure_finance_default_categories(v_space);
  perform public.ensure_finance_workspace(new.id);
  return new;
end;
$$;

-- Convite: garantir categorias do espaco da familia e nao operar o espaco pessoal vazio.
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
  where i.token_hash = extensions.digest(coalesce(p_token, ''), 'sha256')
  for update;

  if not found then raise exception 'invite_not_found'; end if;
  if v.revoked_at is not null then raise exception 'invite_revoked'; end if;
  if v.used_at is not null then raise exception 'invite_already_used'; end if;
  if v.expires_at <= now() then raise exception 'invite_expired'; end if;

  insert into public.finance_space_members(space_id, user_id, role, added_by)
  values (v.space_id, v_user, v.role, v.created_by)
  on conflict (space_id, user_id) do update
    set role = excluded.role, revoked_at = null, added_by = excluded.added_by;

  update public.finance_invites
  set used_at = now(), used_by = v_user
  where id = v.id;

  insert into public.profiles(id, full_name)
  values (v_user, v.recipient_name)
  on conflict (id) do update
    set full_name = case
      when coalesce(public.profiles.full_name, '') = '' then excluded.full_name
      else public.profiles.full_name
    end;

  perform public.ensure_finance_default_categories(v.space_id);

  -- Se o convidado tiver um espaco pessoal sem outros membros, deixa de usa-lo.
  update public.finance_space_members m
  set revoked_at = now()
  where m.user_id = v_user
    and m.space_id <> v.space_id
    and m.role = 'owner'
    and m.revoked_at is null
    and not exists (
      select 1
      from public.finance_space_members o
      where o.space_id = m.space_id
        and o.user_id <> v_user
        and o.revoked_at is null
    );

  return v.space_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill: preencher space_id NULL em categorias privadas e semear espacos vazios
-- ---------------------------------------------------------------------------

update public.categories c
set space_id = s.id
from public.finance_spaces s
where c.space_id is null
  and c.is_demo = false
  and c.user_id = s.owner_user_id;

do $$
declare
  r record;
begin
  for r in select id from public.finance_spaces
  loop
    perform public.ensure_finance_default_categories(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.normalize_category_name(text) from public, anon;
grant execute on function public.normalize_category_name(text) to authenticated;

revoke all on function public.ensure_finance_default_categories(uuid) from public, anon;
grant execute on function public.ensure_finance_default_categories(uuid) to authenticated;

revoke all on function public.seed_finance_space_categories() from public, anon;
grant execute on function public.seed_finance_space_categories() to authenticated;

revoke all on function public.validate_category_space() from public, anon;
grant execute on function public.validate_category_space() to authenticated;

revoke all on function public.prevent_used_category_delete() from public, anon;
grant execute on function public.prevent_used_category_delete() to authenticated;

revoke all on function public.require_active_category_on_change() from public, anon;
grant execute on function public.require_active_category_on_change() to authenticated;

revoke all on function public.create_credit_card_purchase(uuid, uuid, text, numeric, date, integer) from public, anon;
grant execute on function public.create_credit_card_purchase(uuid, uuid, text, numeric, date, integer) to authenticated;

revoke execute on function public.ensure_finance_workspace(uuid) from public, anon, authenticated;
grant execute on function public.ensure_finance_workspace(uuid) to service_role;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

revoke all on function public.consume_finance_invite(text) from public, anon;
grant execute on function public.consume_finance_invite(text) to authenticated;
