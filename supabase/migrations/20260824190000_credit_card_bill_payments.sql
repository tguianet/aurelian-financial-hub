-- Pagamento de fatura/parcela de cartao.
--
-- MODELO FINANCEIRO
-- A) Compra (`credit_card_purchases` + parcelas): despesa economica na purchase_date.
-- B) Pagamento da fatura/parcela: movimentacao de caixa (kind = transfer,
--    source in card_installment_payment / card_bill_payment). Debita a conta
--    bancaria, baixa parcelas e NAO entra em receita/despesa/orçamento.
--
-- Autorizacao: space_id + can_write_finance_space (owner/editor).
-- user_id = ator. Nunca autorizar por user_id = auth.uid() no registro.
-- Nenhum dado real e apagado.

-- ---------------------------------------------------------------------------
-- Colunas de pagamento na parcela
-- ---------------------------------------------------------------------------

alter table public.credit_card_installments
  add column if not exists paid_at date;

alter table public.credit_card_installments
  add column if not exists payment_transaction_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'credit_card_installments_payment_transaction_id_fkey'
  ) then
    alter table public.credit_card_installments
      add constraint credit_card_installments_payment_transaction_id_fkey
      foreign key (payment_transaction_id)
      references public.transactions(id)
      on delete restrict;
  end if;
end $$;

create index if not exists credit_card_installments_bill_idx
  on public.credit_card_installments (credit_card_id, due_date, status)
  where is_demo = false;

create index if not exists credit_card_installments_payment_tx_idx
  on public.credit_card_installments (payment_transaction_id)
  where payment_transaction_id is not null;

comment on column public.credit_card_installments.paid_at is
  'Data em que a parcela foi quitada. Nao gera despesa economica.';
comment on column public.credit_card_installments.payment_transaction_id is
  'Transferencia de caixa que quitou a parcela. kind=transfer; nao entra no resultado.';

-- ---------------------------------------------------------------------------
-- Lancamentos: permitir debito de caixa sem destino para pagamento de cartao
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
  v_is_card_cash boolean;
  v_allow_card_cash text;
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

  v_is_card_cash := new.source in ('card_installment_payment', 'card_bill_payment');

  -- Compra no credito nao pode ser um expense direto (evita dupla contagem).
  if tg_op = 'insert'
     and new.kind = 'expense'
     and new.payment_method = 'credit' then
    raise exception 'compra no credito deve ser lancada via create_credit_card_purchase';
  end if;

  if v_is_card_cash then
    v_allow_card_cash := current_setting('aurelian.allow_card_cash', true);
    if v_allow_card_cash is distinct from '1' then
      raise exception 'pagamento de fatura deve ser feito via RPC';
    end if;
    if new.kind is distinct from 'transfer' then
      raise exception 'pagamento de fatura deve ser transferencia de caixa';
    end if;
    if new.credit_card_id is null then
      raise exception 'cartao obrigatorio no pagamento da fatura';
    end if;
    if new.status is distinct from 'paid' or new.paid_at is null then
      raise exception 'pagamento de fatura deve estar liquidado';
    end if;
  end if;

  if tg_op = 'update'
     and old.source in ('card_installment_payment', 'card_bill_payment') then
    if new.status = 'cancelled'
       or new.kind is distinct from old.kind
       or new.amount is distinct from old.amount
       or new.source is distinct from old.source
       or new.account_id is distinct from old.account_id
       or new.credit_card_id is distinct from old.credit_card_id then
      raise exception 'pagamento de fatura nao pode ser alterado por este fluxo';
    end if;
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

  -- Pagamento de cartao: conta de qualquer entidade do mesmo space.
  if not v_is_card_cash
     and (v_source_entity is null or v_source_entity <> new.entity_id) then
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

  if v_is_card_cash then
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

    new.to_account_id := null;
    new.to_entity_id := null;
    new.category_id := null;
    new.payment_method := 'transfer';
  elsif new.kind = 'transfer' then
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
-- Parcela so pode ir para paid com transaction de caixa (exceto demo)
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

  if new.status = 'paid'
     and (tg_op = 'insert' or old.status is distinct from 'paid')
     and new.payment_transaction_id is null then
    raise exception 'parcela so pode ser paga via RPC';
  end if;

  if new.status = 'paid' and new.paid_at is null then
    raise exception 'paid_at obrigatorio na parcela paga';
  end if;

  if tg_op = 'update'
     and old.status in ('paid', 'cancelled')
     and new.status is distinct from old.status then
    raise exception 'parcela ja liquidada ou cancelada';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helper interno: cria a transferencia de caixa (nao e despesa)
-- ---------------------------------------------------------------------------

create or replace function public.create_card_cash_movement(
  p_user_id uuid,
  p_space_id uuid,
  p_entity_id uuid,
  p_credit_card_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_paid_at date,
  p_source text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tx_id uuid;
begin
  if p_source not in ('card_installment_payment', 'card_bill_payment') then
    raise exception 'origem de caixa de cartao invalida';
  end if;

  perform set_config('aurelian.allow_card_cash', '1', true);

  insert into public.transactions (
    user_id, space_id, is_demo, entity_id, kind, description, amount,
    category_id, account_id, to_account_id, to_entity_id, credit_card_id,
    payment_method, competence_date, due_date, paid_at, status,
    recurrence, source, notes
  ) values (
    p_user_id, p_space_id, false, p_entity_id, 'transfer', p_description, p_amount,
    null, p_account_id, null, null, p_credit_card_id,
    'transfer', p_paid_at, p_paid_at, p_paid_at, 'paid',
    'none', p_source,
    'Movimentacao de caixa para quitar cartao. Nao conta como despesa economica.'
  ) returning id into v_tx_id;

  return v_tx_id;
end;
$$;

revoke all on function public.create_card_cash_movement(uuid, uuid, uuid, uuid, uuid, numeric, date, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Pagar uma parcela
-- ---------------------------------------------------------------------------

create or replace function public.pay_credit_card_installment(
  p_installment_id uuid,
  p_account_id uuid default null,
  p_paid_at date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_space_id uuid;
  v_card_id uuid;
  v_entity_id uuid;
  v_status text;
  v_amount numeric(14,2);
  v_installment_no integer;
  v_account_id uuid;
  v_account_space uuid;
  v_card_account uuid;
  v_tx_id uuid;
  v_purchase_desc text;
  v_purchase_total integer;
begin
  if v_user_id is null then
    raise exception 'sessao invalida';
  end if;

  select i.credit_card_id
    into v_card_id
  from public.credit_card_installments i
  where i.id = p_installment_id
    and i.is_demo = false;

  if v_card_id is null then
    raise exception 'parcela invalida';
  end if;

  -- Ordem de lock: cartao e depois parcela, para evitar deadlock com pay_bill.
  select c.space_id, c.entity_id, c.account_id
    into v_space_id, v_entity_id, v_card_account
  from public.credit_cards c
  where c.id = v_card_id
    and c.is_demo = false
  for update;

  if v_space_id is null or v_entity_id is null then
    raise exception 'cartao invalido';
  end if;

  if not public.can_write_finance_space(v_space_id, v_user_id) then
    raise exception 'sem permissao de escrita no espaco financeiro';
  end if;

  select i.status, i.amount, i.installment_no, p.description, p.installments
    into v_status, v_amount, v_installment_no, v_purchase_desc, v_purchase_total
  from public.credit_card_installments i
  join public.credit_card_purchases p on p.id = i.purchase_id
  where i.id = p_installment_id
    and i.is_demo = false
    and i.space_id = v_space_id
    and i.credit_card_id = v_card_id
  for update of i;

  if v_status is null then
    raise exception 'parcela invalida';
  end if;

  if v_status in ('paid', 'cancelled') then
    raise exception 'parcela ja paga ou cancelada';
  end if;

  if v_status not in ('pending', 'overdue') then
    raise exception 'parcela nao pode ser paga';
  end if;

  v_account_id := coalesce(p_account_id, v_card_account);
  if v_account_id is null then
    raise exception 'conta de pagamento obrigatoria';
  end if;

  select a.space_id into v_account_space
  from public.accounts a
  where a.id = v_account_id
    and a.is_demo = false
    and a.active = true;

  if v_account_space is null or v_account_space is distinct from v_space_id then
    raise exception 'conta nao pertence ao espaco financeiro';
  end if;

  v_tx_id := public.create_card_cash_movement(
    v_user_id,
    v_space_id,
    v_entity_id,
    v_card_id,
    v_account_id,
    v_amount,
    coalesce(p_paid_at, current_date),
    'card_installment_payment',
    format(
      'Pagamento parcela %s/%s — %s',
      v_installment_no,
      v_purchase_total,
      v_purchase_desc
    )
  );

  update public.credit_card_installments
     set status = 'paid',
         paid_at = coalesce(p_paid_at, current_date),
         payment_transaction_id = v_tx_id
   where id = p_installment_id;

  insert into public.audit_log(user_id, space_id, table_name, record_id, action, details)
  values (
    v_user_id, v_space_id, 'credit_card_installments', p_installment_id, 'pay',
    jsonb_build_object(
      'actor_id', v_user_id,
      'installment_id', p_installment_id,
      'credit_card_id', v_card_id,
      'account_id', v_account_id,
      'amount', v_amount,
      'paid_at', coalesce(p_paid_at, current_date),
      'transaction_id', v_tx_id
    )
  );

  return v_tx_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Pagar fatura do mes (todas as parcelas pending/overdue da competencia)
-- ---------------------------------------------------------------------------

create or replace function public.pay_credit_card_bill(
  p_credit_card_id uuid,
  p_reference_month date,
  p_account_id uuid default null,
  p_paid_at date default current_date
)
returns table (
  total_paid numeric,
  installment_count integer,
  transaction_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_space_id uuid;
  v_entity_id uuid;
  v_card_name text;
  v_card_account uuid;
  v_account_id uuid;
  v_account_space uuid;
  v_month date := date_trunc('month', coalesce(p_reference_month, current_date))::date;
  v_total numeric(14,2) := 0;
  v_count integer := 0;
  v_tx_id uuid;
  v_ids uuid[];
begin
  if v_user_id is null then
    raise exception 'sessao invalida';
  end if;

  select c.space_id, c.entity_id, c.name, c.account_id
    into v_space_id, v_entity_id, v_card_name, v_card_account
  from public.credit_cards c
  where c.id = p_credit_card_id
    and c.is_demo = false
  for update;

  if v_space_id is null then
    raise exception 'cartao invalido';
  end if;

  if not public.can_write_finance_space(v_space_id, v_user_id) then
    raise exception 'sem permissao de escrita no espaco financeiro';
  end if;

  with locked as (
    select i.id, i.amount
    from public.credit_card_installments i
    where i.credit_card_id = p_credit_card_id
      and i.space_id = v_space_id
      and i.is_demo = false
      and i.status in ('pending', 'overdue')
      and date_trunc('month', i.due_date)::date = v_month
    order by i.id
    for update
  )
  select coalesce(array_agg(id order by id), '{}'::uuid[]),
         coalesce(sum(amount), 0),
         count(*)::integer
    into v_ids, v_total, v_count
  from locked;

  if v_count = 0 or v_total <= 0 then
    raise exception 'fatura vazia ou ja paga';
  end if;

  v_account_id := coalesce(p_account_id, v_card_account);
  if v_account_id is null then
    raise exception 'conta de pagamento obrigatoria';
  end if;

  select a.space_id into v_account_space
  from public.accounts a
  where a.id = v_account_id
    and a.is_demo = false
    and a.active = true;

  if v_account_space is null or v_account_space is distinct from v_space_id then
    raise exception 'conta nao pertence ao espaco financeiro';
  end if;

  v_tx_id := public.create_card_cash_movement(
    v_user_id,
    v_space_id,
    v_entity_id,
    p_credit_card_id,
    v_account_id,
    v_total,
    coalesce(p_paid_at, current_date),
    'card_bill_payment',
    format(
      'Pagamento fatura %s — %s',
      to_char(v_month, 'MM/YYYY'),
      v_card_name
    )
  );

  update public.credit_card_installments
     set status = 'paid',
         paid_at = coalesce(p_paid_at, current_date),
         payment_transaction_id = v_tx_id
   where id = any (v_ids);

  insert into public.audit_log(user_id, space_id, table_name, record_id, action, details)
  values (
    v_user_id, v_space_id, 'credit_cards', p_credit_card_id, 'pay_bill',
    jsonb_build_object(
      'actor_id', v_user_id,
      'credit_card_id', p_credit_card_id,
      'reference_month', v_month,
      'account_id', v_account_id,
      'total', v_total,
      'installment_count', v_count,
      'transaction_id', v_tx_id
    )
  );

  total_paid := v_total;
  installment_count := v_count;
  transaction_id := v_tx_id;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Auditoria da compra: incluir cartao
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
    jsonb_build_object(
      'actor_id', v_user_id,
      'credit_card_id', _credit_card_id,
      'amount', _total_amount,
      'installments', _installments,
      'purchase_date', _purchase_date
    )
  );

  return v_purchase_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: owner/editor via can_write dentro da RPC; viewer e outro space bloqueados
-- ---------------------------------------------------------------------------

revoke all on function public.validate_transaction_finance_links() from public, anon;
grant execute on function public.validate_transaction_finance_links() to authenticated;

revoke all on function public.validate_card_installment_owner() from public, anon;
grant execute on function public.validate_card_installment_owner() to authenticated;

revoke all on function public.pay_credit_card_installment(uuid, uuid, date) from public, anon;
grant execute on function public.pay_credit_card_installment(uuid, uuid, date) to authenticated;

revoke all on function public.pay_credit_card_bill(uuid, date, uuid, date) from public, anon;
grant execute on function public.pay_credit_card_bill(uuid, date, uuid, date) to authenticated;

revoke all on function public.create_credit_card_purchase(uuid, uuid, text, numeric, date, integer) from public, anon;
grant execute on function public.create_credit_card_purchase(uuid, uuid, text, numeric, date, integer) to authenticated;
