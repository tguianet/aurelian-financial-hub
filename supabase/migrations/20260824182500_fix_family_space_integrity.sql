-- Aurelian Finance
-- Correcao de integridade do espaco compartilhado/familia.
-- Autorizacao e pertencimento financeiro passam a ser por space_id.
-- user_id permanece como ator/criador do registro.
-- Nao altera dados existentes.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

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
  order by
    case when exists (
      select 1
      from public.finance_space_members other
      where other.space_id = m.space_id
        and other.user_id <> m.user_id
        and other.revoked_at is null
    ) then 0 else 1 end,
    case m.role when 'owner' then 0 when 'editor' then 1 else 2 end,
    m.joined_at
  limit 1;
$$;

create or replace function public.assert_writable_finance_space(p_space_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  if p_space_id is null then
    raise exception 'space_id obrigatorio';
  end if;
  if not public.can_write_finance_space(p_space_id, auth.uid()) then
    raise exception 'sem permissao de escrita no espaco financeiro';
  end if;
end;
$$;

create or replace function public.ensure_finance_space_for_user(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_space uuid;
  v_name text;
begin
  if p_user_id is null then
    return null;
  end if;

  select s.id into v_space
  from public.finance_spaces s
  where s.owner_user_id = p_user_id
  limit 1;

  if v_space is null then
    select coalesce(nullif(p.full_name, ''), 'Meu Aurelian')
      into v_name
    from public.profiles p
    where p.id = p_user_id;

    insert into public.finance_spaces(owner_user_id, name)
    values (p_user_id, coalesce(v_name, 'Meu Aurelian'))
    returning id into v_space;
  end if;

  insert into public.finance_space_members(space_id, user_id, role, added_by)
  values (v_space, p_user_id, 'owner', p_user_id)
  on conflict (space_id, user_id) do update
    set role = 'owner',
        revoked_at = null;

  return v_space;
end;
$$;

create or replace function public.infer_finance_space_id(p_table text, p_row jsonb)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_space uuid;
begin
  if p_table = 'credit_card_installments' and nullif(p_row->>'purchase_id', '') is not null then
    select space_id into v_space
    from public.credit_card_purchases
    where id = (p_row->>'purchase_id')::uuid;
    if v_space is not null then return v_space; end if;
  end if;

  if nullif(p_row->>'credit_card_id', '') is not null then
    select space_id into v_space
    from public.credit_cards
    where id = (p_row->>'credit_card_id')::uuid;
    if v_space is not null then return v_space; end if;
  end if;

  if nullif(p_row->>'account_id', '') is not null then
    select space_id into v_space
    from public.accounts
    where id = (p_row->>'account_id')::uuid;
    if v_space is not null then return v_space; end if;
  end if;

  if nullif(p_row->>'to_account_id', '') is not null then
    select space_id into v_space
    from public.accounts
    where id = (p_row->>'to_account_id')::uuid;
    if v_space is not null then return v_space; end if;
  end if;

  if nullif(p_row->>'entity_id', '') is not null then
    select space_id into v_space
    from public.financial_entities
    where id = (p_row->>'entity_id')::uuid;
    if v_space is not null then return v_space; end if;
  end if;

  if nullif(p_row->>'transaction_id', '') is not null then
    select space_id into v_space
    from public.transactions
    where id = (p_row->>'transaction_id')::uuid;
    if v_space is not null then return v_space; end if;
  end if;

  return null;
end;
$$;

create or replace function public.assign_finance_space_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb := to_jsonb(new);
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;

  -- Tabelas sem is_demo (audit_log, documents, whatsapp_settings) seguem o fluxo normal.
  if coalesce((v_row->>'is_demo')::boolean, false) then
    return new;
  end if;

  if new.space_id is null then
    new.space_id := public.infer_finance_space_id(tg_table_name, v_row);
  end if;

  if new.space_id is null then
    new.space_id := public.current_finance_space_id();
  end if;

  if new.space_id is null and new.user_id is not null then
    new.space_id := public.ensure_finance_space_for_user(new.user_id);
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Lancamentos: consistencia por space_id
-- ---------------------------------------------------------------------------

create or replace function public.validate_transaction_finance_links()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source_entity uuid;
  v_source_space uuid;
  v_target_entity uuid;
  v_target_space uuid;
  v_card_entity uuid;
  v_card_space uuid;
  v_category_kind text;
  v_category_space uuid;
  v_category_demo boolean;
  v_entity_space uuid;
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

  if new.amount <= 0 then
    raise exception 'valor deve ser maior que zero';
  end if;

  select e.space_id into v_entity_space
  from public.financial_entities e
  where e.id = new.entity_id and e.is_demo = false;

  if v_entity_space is null or v_entity_space is distinct from new.space_id then
    raise exception 'entidade nao pertence ao espaco financeiro';
  end if;

  if new.account_id is null then
    raise exception 'conta de origem obrigatoria';
  end if;

  select a.entity_id, a.space_id
    into v_source_entity, v_source_space
  from public.accounts a
  where a.id = new.account_id and a.is_demo = false;

  if v_source_space is null or v_source_space is distinct from new.space_id then
    raise exception 'conta de origem nao pertence ao espaco financeiro';
  end if;

  if v_source_entity is null or v_source_entity <> new.entity_id then
    raise exception 'conta de origem invalida para a entidade';
  end if;

  if new.category_id is not null then
    select c.kind, c.space_id, c.is_demo
      into v_category_kind, v_category_space, v_category_demo
    from public.categories c
    where c.id = new.category_id
    limit 1;

    if v_category_kind is null then
      raise exception 'categoria invalida';
    end if;

    if coalesce(v_category_demo, false) is false
       and v_category_space is distinct from new.space_id then
      raise exception 'categoria nao pertence ao espaco financeiro';
    end if;

    if new.kind in ('income','expense') and v_category_kind <> new.kind then
      raise exception 'categoria incompativel com o tipo do lancamento';
    end if;
  end if;

  if new.kind = 'transfer' then
    if new.to_account_id is null or new.to_account_id = new.account_id then
      raise exception 'conta de destino invalida';
    end if;

    select a.entity_id, a.space_id
      into v_target_entity, v_target_space
    from public.accounts a
    where a.id = new.to_account_id and a.is_demo = false;

    if v_target_space is null or v_target_space is distinct from new.space_id then
      raise exception 'conta de destino nao pertence ao espaco financeiro';
    end if;

    if v_target_entity is null then
      raise exception 'conta de destino invalida';
    end if;

    new.to_entity_id := v_target_entity;
    new.category_id := null;
    new.credit_card_id := null;
    new.payment_method := 'transfer';
  else
    new.to_account_id := null;
    new.to_entity_id := null;

    if new.credit_card_id is not null then
      select c.entity_id, c.space_id
        into v_card_entity, v_card_space
      from public.credit_cards c
      where c.id = new.credit_card_id and c.is_demo = false;

      if v_card_space is null or v_card_space is distinct from new.space_id then
        raise exception 'cartao nao pertence ao espaco financeiro';
      end if;

      if v_card_entity is null or v_card_entity <> new.entity_id then
        raise exception 'cartao invalido para a entidade';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Contas: entidade e espaco
-- ---------------------------------------------------------------------------

create or replace function public.validate_account_entity_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entity_space uuid;
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

  select e.space_id into v_entity_space
  from public.financial_entities e
  where e.id = new.entity_id and e.is_demo = false;

  if v_entity_space is null or v_entity_space is distinct from new.space_id then
    raise exception 'entidade da conta nao pertence ao espaco financeiro';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Cartoes: entidade, conta de pagamento e espaco
-- ---------------------------------------------------------------------------

create or replace function public.validate_card_entity_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entity_space uuid;
  v_account_entity uuid;
  v_account_space uuid;
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

  select e.space_id into v_entity_space
  from public.financial_entities e
  where e.id = new.entity_id and e.is_demo = false;

  if v_entity_space is null or v_entity_space is distinct from new.space_id then
    raise exception 'entidade do cartao nao pertence ao espaco financeiro';
  end if;

  if new.account_id is not null then
    select a.entity_id, a.space_id
      into v_account_entity, v_account_space
    from public.accounts a
    where a.id = new.account_id and a.is_demo = false;

    if v_account_space is null or v_account_space is distinct from new.space_id then
      raise exception 'conta de pagamento nao pertence ao espaco financeiro';
    end if;

    if v_account_entity is null or v_account_entity <> new.entity_id then
      raise exception 'conta de pagamento invalida para o cartao';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Compras no cartao
-- ---------------------------------------------------------------------------

create or replace function public.validate_card_purchase_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_card_entity uuid;
  v_card_space uuid;
  v_entity_space uuid;
  v_category_space uuid;
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

  select c.entity_id, c.space_id
    into v_card_entity, v_card_space
  from public.credit_cards c
  where c.id = new.credit_card_id and c.is_demo = false;

  if v_card_space is null or v_card_space is distinct from new.space_id then
    raise exception 'cartao nao pertence ao espaco financeiro';
  end if;

  if v_card_entity is null or v_card_entity <> new.entity_id then
    raise exception 'cartao e entidade inconsistentes';
  end if;

  select e.space_id into v_entity_space
  from public.financial_entities e
  where e.id = new.entity_id and e.is_demo = false;

  if v_entity_space is null or v_entity_space is distinct from new.space_id then
    raise exception 'entidade nao pertence ao espaco financeiro';
  end if;

  if new.category_id is not null then
    select c.space_id into v_category_space
    from public.categories c
    where c.id = new.category_id
      and c.is_demo = false
      and c.kind = 'expense';

    if v_category_space is null or v_category_space is distinct from new.space_id then
      raise exception 'categoria invalida';
    end if;
  end if;

  if new.total_amount <= 0 or new.installments < 1 or new.installments > 48 then
    raise exception 'compra invalida';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Parcelas
-- ---------------------------------------------------------------------------

create or replace function public.validate_card_installment_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_purchase_space uuid;
  v_purchase_card uuid;
  v_card_space uuid;
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

  select p.space_id, p.credit_card_id
    into v_purchase_space, v_purchase_card
  from public.credit_card_purchases p
  where p.id = new.purchase_id and p.is_demo = false;

  if v_purchase_space is null or v_purchase_space is distinct from new.space_id then
    raise exception 'parcela nao pertence ao espaco da compra';
  end if;

  if v_purchase_card is distinct from new.credit_card_id then
    raise exception 'parcela nao pertence ao cartao da compra';
  end if;

  select c.space_id into v_card_space
  from public.credit_cards c
  where c.id = new.credit_card_id and c.is_demo = false;

  if v_card_space is null or v_card_space is distinct from new.space_id then
    raise exception 'cartao da parcela nao pertence ao espaco financeiro';
  end if;

  if new.amount <= 0 then
    raise exception 'valor da parcela deve ser maior que zero';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. RPC atomica de compra parcelada
-- ---------------------------------------------------------------------------

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
-- Orcamento e reservas: mesmo criterio de espaco (editor precisa atualizar)
-- ---------------------------------------------------------------------------

create or replace function public.validate_budget_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entity_space uuid;
  v_category_space uuid;
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

  if new.planned_amount < 0 then
    raise exception 'orcamento nao pode ser negativo';
  end if;

  if date_trunc('month', new.month)::date <> new.month then
    new.month := date_trunc('month', new.month)::date;
  end if;

  select e.space_id into v_entity_space
  from public.financial_entities e
  where e.id = new.entity_id and e.is_demo = false;

  if v_entity_space is null or v_entity_space is distinct from new.space_id then
    raise exception 'entidade nao pertence ao espaco financeiro';
  end if;

  select c.space_id into v_category_space
  from public.categories c
  where c.id = new.category_id and c.is_demo = false and c.kind = 'expense';

  if v_category_space is null or v_category_space is distinct from new.space_id then
    raise exception 'categoria de despesa invalida';
  end if;

  return new;
end;
$$;

create or replace function public.validate_reserve_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entity_space uuid;
  v_account_entity uuid;
  v_account_space uuid;
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

  if new.target_amount < 0 or new.current_amount < 0 then
    raise exception 'valores de reserva nao podem ser negativos';
  end if;

  select e.space_id into v_entity_space
  from public.financial_entities e
  where e.id = new.entity_id and e.is_demo = false;

  if v_entity_space is null or v_entity_space is distinct from new.space_id then
    raise exception 'entidade nao pertence ao espaco financeiro';
  end if;

  if new.account_id is not null then
    select a.entity_id, a.space_id
      into v_account_entity, v_account_space
    from public.accounts a
    where a.id = new.account_id and a.is_demo = false;

    if v_account_space is null or v_account_space is distinct from new.space_id then
      raise exception 'conta da reserva nao pertence ao espaco financeiro';
    end if;

    if v_account_entity is null or v_account_entity <> new.entity_id then
      raise exception 'conta da reserva invalida para a entidade';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.validate_whatsapp_command_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tx_space uuid;
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

  if new.transaction_id is not null then
    select t.space_id into v_tx_space
    from public.transactions t
    where t.id = new.transaction_id and t.is_demo = false;

    if v_tx_space is null or v_tx_space is distinct from new.space_id then
      raise exception 'transacao do comando nao pertence ao espaco financeiro';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants minimos
-- ---------------------------------------------------------------------------

revoke all on function public.assert_writable_finance_space(uuid) from public, anon, authenticated;
revoke all on function public.ensure_finance_space_for_user(uuid) from public, anon, authenticated;
revoke all on function public.infer_finance_space_id(text, jsonb) from public, anon, authenticated;
revoke all on function public.assign_finance_space_on_insert() from public, anon;
revoke all on function public.validate_transaction_finance_links() from public, anon;
revoke all on function public.validate_account_entity_owner() from public, anon;
revoke all on function public.validate_card_entity_owner() from public, anon;
revoke all on function public.validate_card_purchase_owner() from public, anon;
revoke all on function public.validate_card_installment_owner() from public, anon;
revoke all on function public.validate_budget_owner() from public, anon;
revoke all on function public.validate_reserve_owner() from public, anon;
revoke all on function public.validate_whatsapp_command_owner() from public, anon;

grant execute on function public.assign_finance_space_on_insert() to authenticated;
grant execute on function public.validate_transaction_finance_links() to authenticated;
grant execute on function public.validate_account_entity_owner() to authenticated;
grant execute on function public.validate_card_entity_owner() to authenticated;
grant execute on function public.validate_card_purchase_owner() to authenticated;
grant execute on function public.validate_card_installment_owner() to authenticated;
grant execute on function public.validate_budget_owner() to authenticated;
grant execute on function public.validate_reserve_owner() to authenticated;
grant execute on function public.validate_whatsapp_command_owner() to authenticated;

revoke all on function public.current_finance_space_id() from public, anon;
grant execute on function public.current_finance_space_id() to authenticated;

revoke all on function public.create_credit_card_purchase(uuid, uuid, text, numeric, date, integer) from public, anon;
grant execute on function public.create_credit_card_purchase(uuid, uuid, text, numeric, date, integer) to authenticated;

revoke all on function public.can_write_finance_space(uuid, uuid) from public, anon;
grant execute on function public.can_write_finance_space(uuid, uuid) to authenticated;

revoke all on function public.is_finance_space_member(uuid, uuid) from public, anon;
grant execute on function public.is_finance_space_member(uuid, uuid) to authenticated;

revoke all on function public.is_finance_space_owner(uuid, uuid) from public, anon;
grant execute on function public.is_finance_space_owner(uuid, uuid) to authenticated;
