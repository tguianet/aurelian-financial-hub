-- Consistencia transacional + trilha de auditoria imutavel.
-- Nao apaga dados reais. Nao reescreve historico.

-- ---------------------------------------------------------------------------
-- Helper de audit (somente RPCs SECURITY DEFINER)
-- ---------------------------------------------------------------------------

create or replace function public.write_finance_audit(
  p_space_id uuid,
  p_table_name text,
  p_record_id uuid,
  p_action text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_space_id is null then
    raise exception 'space_id obrigatorio para auditoria';
  end if;
  if coalesce(btrim(p_table_name), '') = '' or coalesce(btrim(p_action), '') = '' then
    raise exception 'auditoria invalida';
  end if;

  insert into public.audit_log(user_id, space_id, table_name, record_id, action, details)
  values (
    auth.uid(),
    p_space_id,
    p_table_name,
    p_record_id,
    p_action,
    coalesce(p_details, '{}'::jsonb) || jsonb_build_object('actor_id', auth.uid())
  );
end;
$$;

revoke all on function public.write_finance_audit(uuid, text, uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.protect_audit_log_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'audit_log imutavel';
end;
$$;

drop trigger if exists protect_audit_log_immutable on public.audit_log;
create trigger protect_audit_log_immutable
before update or delete on public.audit_log
for each row execute function public.protect_audit_log_immutable();

drop policy if exists audit_space_insert on public.audit_log;
revoke insert, update, delete on public.audit_log from authenticated;
grant select on public.audit_log to authenticated;

-- ---------------------------------------------------------------------------
-- Idempotencia e documentos recuperaveis
-- ---------------------------------------------------------------------------

alter table public.transactions
  add column if not exists idempotency_key text;

create unique index if not exists transactions_space_idempotency_uidx
  on public.transactions (space_id, idempotency_key)
  where is_demo = false and idempotency_key is not null;

comment on column public.transactions.idempotency_key is
  'Chave de retry. Unique por space impede despesa duplicada em clique duplo.';

alter table public.financial_documents
  drop constraint if exists financial_documents_status_check;

alter table public.financial_documents
  add constraint financial_documents_status_check
  check (status in ('inbox','uploaded','processing','processed','failed','linked','archived'));

create unique index if not exists budgets_space_entity_category_month_uidx
  on public.budgets (space_id, entity_id, category_id, month)
  where is_demo = false and space_id is not null;

create unique index if not exists financial_entities_space_slug_uidx
  on public.financial_entities (space_id, slug)
  where is_demo = false and space_id is not null;

-- ---------------------------------------------------------------------------
-- Campos imutaveis
-- ---------------------------------------------------------------------------

create or replace function public.protect_transaction_immutable_cols()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'id imutavel';
  end if;
  if new.space_id is distinct from old.space_id then
    raise exception 'space_id imutavel';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at imutavel';
  end if;
  if old.recurring_transaction_id is not null
     and new.recurring_transaction_id is distinct from old.recurring_transaction_id then
    raise exception 'recurring_transaction_id imutavel';
  end if;
  if old.idempotency_key is not null
     and new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'idempotency_key imutavel';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_transaction_immutable_cols on public.transactions;
create trigger protect_transaction_immutable_cols
before update on public.transactions
for each row execute function public.protect_transaction_immutable_cols();

create or replace function public.protect_installment_immutable_cols()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.space_id is distinct from old.space_id then
    raise exception 'space_id imutavel';
  end if;
  if old.payment_transaction_id is not null
     and new.payment_transaction_id is distinct from old.payment_transaction_id then
    raise exception 'payment_transaction_id imutavel';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_installment_immutable_cols on public.credit_card_installments;
create trigger protect_installment_immutable_cols
before update on public.credit_card_installments
for each row execute function public.protect_installment_immutable_cols();

-- ---------------------------------------------------------------------------
-- Entidade + conta principal
-- ---------------------------------------------------------------------------

create or replace function public.create_financial_entity(
  p_name text,
  p_kind text,
  p_color text,
  p_slug text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_id uuid;
  v_account uuid;
begin
  if v_user is null then raise exception 'sessao invalida'; end if;
  v_space := public.current_finance_space_id();
  if v_space is null then raise exception 'espaco financeiro nao encontrado'; end if;
  perform public.assert_writable_finance_space(v_space);
  if btrim(coalesce(p_name, '')) = '' then raise exception 'nome obrigatorio'; end if;
  if p_kind not in ('personal', 'company') then raise exception 'tipo de entidade invalido'; end if;
  if btrim(coalesce(p_slug, '')) = '' then raise exception 'slug invalido'; end if;

  insert into public.financial_entities(user_id, space_id, is_demo, name, slug, kind, color, active)
  values (v_user, v_space, false, btrim(p_name), btrim(p_slug), p_kind, coalesce(nullif(p_color, ''), '#E8B923'), true)
  returning id into v_id;

  insert into public.accounts(user_id, space_id, is_demo, entity_id, name, type, opening_balance, active)
  values (v_user, v_space, false, v_id, 'Conta principal', 'checking', 0, true)
  returning id into v_account;

  perform public.write_finance_audit(v_space, 'financial_entities', v_id, 'insert',
    jsonb_build_object('name', btrim(p_name), 'kind', p_kind, 'account_id', v_account));
  perform public.write_finance_audit(v_space, 'accounts', v_account, 'insert',
    jsonb_build_object('name', 'Conta principal', 'entity_id', v_id, 'opening_balance', 0));

  return v_id;
end;
$$;

create or replace function public.toggle_financial_entity_active(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_active boolean;
  v_name text;
begin
  if v_user is null then raise exception 'sessao invalida'; end if;
  select space_id, active, name into v_space, v_active, v_name
  from public.financial_entities where id = p_id and is_demo = false for update;
  if v_space is null then raise exception 'entidade invalida'; end if;
  perform public.assert_writable_finance_space(v_space);
  update public.financial_entities set active = not v_active, user_id = v_user where id = p_id;
  perform public.write_finance_audit(v_space, 'financial_entities', p_id,
    case when v_active then 'deactivate' else 'reactivate' end,
    jsonb_build_object('name', v_name));
  return not v_active;
end;
$$;

-- ---------------------------------------------------------------------------
-- Contas
-- ---------------------------------------------------------------------------

create or replace function public.create_account(
  p_entity_id uuid,
  p_name text,
  p_type text,
  p_bank text,
  p_opening_balance numeric
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_id uuid;
begin
  if v_user is null then raise exception 'sessao invalida'; end if;
  v_space := public.current_finance_space_id();
  perform public.assert_writable_finance_space(v_space);
  if not exists (
    select 1 from public.financial_entities e
    where e.id = p_entity_id and e.space_id = v_space and e.is_demo = false
  ) then
    raise exception 'entidade invalida';
  end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'nome obrigatorio'; end if;
  if p_type not in ('checking','savings','cash','wallet','investment') then raise exception 'tipo de conta invalido'; end if;
  if p_opening_balance is null then raise exception 'saldo inicial invalido'; end if;

  insert into public.accounts(user_id, space_id, is_demo, entity_id, name, type, bank, opening_balance, active)
  values (v_user, v_space, false, p_entity_id, btrim(p_name), p_type, nullif(btrim(coalesce(p_bank,'')), ''), round(p_opening_balance, 2), true)
  returning id into v_id;

  perform public.write_finance_audit(v_space, 'accounts', v_id, 'insert',
    jsonb_build_object('name', btrim(p_name), 'entity_id', p_entity_id, 'opening_balance', round(p_opening_balance, 2)));
  return v_id;
end;
$$;

create or replace function public.toggle_account_active(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_active boolean;
  v_name text;
begin
  if v_user is null then raise exception 'sessao invalida'; end if;
  select space_id, active, name into v_space, v_active, v_name
  from public.accounts where id = p_id and is_demo = false for update;
  if v_space is null then raise exception 'conta invalida'; end if;
  perform public.assert_writable_finance_space(v_space);
  update public.accounts set active = not v_active, user_id = v_user where id = p_id;
  perform public.write_finance_audit(v_space, 'accounts', p_id,
    case when v_active then 'deactivate' else 'reactivate' end,
    jsonb_build_object('name', v_name));
  return not v_active;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lancamentos
-- ---------------------------------------------------------------------------

create or replace function public.create_transaction(
  p_entity_id uuid,
  p_account_id uuid,
  p_kind text,
  p_description text,
  p_amount numeric,
  p_category_id uuid default null,
  p_to_account_id uuid default null,
  p_payment_method text default 'pix',
  p_competence_date date default current_date,
  p_due_date date default current_date,
  p_status text default 'pending',
  p_notes text default null,
  p_installments integer default 1,
  p_amount_mode text default 'total',
  p_shift_competence boolean default false,
  p_source text default 'manual',
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_first uuid;
  v_existing uuid;
  v_n integer;
  v_parts numeric[];
  v_status text;
  v_due date;
  v_comp date;
  v_day integer;
  v_id uuid;
  i integer;
  v_settled boolean;
begin
  if v_user is null then raise exception 'sessao invalida'; end if;
  v_space := public.current_finance_space_id();
  perform public.assert_writable_finance_space(v_space);

  if p_idempotency_key is not null then
    select id into v_existing
    from public.transactions
    where space_id = v_space and idempotency_key = p_idempotency_key and is_demo = false
    limit 1;
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  if not exists (
    select 1 from public.financial_entities e
    where e.id = p_entity_id and e.space_id = v_space and e.is_demo = false
  ) then
    raise exception 'entidade invalida';
  end if;
  if not exists (
    select 1 from public.accounts a
    where a.id = p_account_id and a.space_id = v_space and a.entity_id = p_entity_id and a.is_demo = false
  ) then
    raise exception 'conta invalida';
  end if;
  if p_kind = 'transfer' then
    if p_to_account_id is null or p_to_account_id = p_account_id then
      raise exception 'conta de destino invalida';
    end if;
    if not exists (
      select 1 from public.accounts a
      where a.id = p_to_account_id and a.space_id = v_space and a.is_demo = false
    ) then
      raise exception 'conta de destino invalida';
    end if;
  elsif p_category_id is not null then
    if not exists (
      select 1 from public.categories c
      where c.id = p_category_id and c.space_id = v_space and c.kind = p_kind and c.is_demo = false
    ) then
      raise exception 'categoria invalida';
    end if;
  end if;

  v_n := coalesce(p_installments, 1);
  if v_n < 1 or v_n > 48 then raise exception 'parcelas devem estar entre 1 e 48'; end if;
  if p_kind not in ('income','expense','transfer') then raise exception 'tipo invalido'; end if;
  if btrim(coalesce(p_description, '')) = '' then raise exception 'descricao obrigatoria'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'valor deve ser maior que zero'; end if;
  if p_amount_mode not in ('total','each') then raise exception 'modo de valor invalido'; end if;

  v_status := coalesce(p_status, 'pending');
  if p_kind = 'income' and v_status = 'paid' then v_status := 'received'; end if;
  if p_kind = 'transfer' and v_status not in ('pending','paid') then v_status := 'paid'; end if;
  if v_status not in ('pending','paid','received','overdue') then raise exception 'status invalido'; end if;

  if p_amount_mode = 'each' then
    v_parts := array_fill(round(p_amount, 2), array[v_n]);
  else
    v_parts := public.split_money_installments(p_amount, v_n);
  end if;

  v_day := extract(day from coalesce(p_due_date, p_competence_date, current_date))::integer;

  begin
  for i in 1..v_n loop
    v_due := public.add_months_clamped(coalesce(p_due_date, p_competence_date, current_date), i - 1, v_day);
    v_comp := case when p_shift_competence
      then public.add_months_clamped(coalesce(p_competence_date, current_date), i - 1, extract(day from coalesce(p_competence_date, current_date))::integer)
      else coalesce(p_competence_date, current_date)
    end;
    v_settled := (i = 1 and v_status in ('paid','received'));

    insert into public.transactions(
      user_id, space_id, is_demo, entity_id, kind, description, amount,
      category_id, account_id, to_account_id, payment_method,
      competence_date, due_date, paid_at, status, recurrence, installment_no, installment_total,
      source, notes, idempotency_key
    ) values (
      v_user, v_space, false, p_entity_id, p_kind,
      case when v_n > 1 then btrim(p_description) || ' (' || i || '/' || v_n || ')' else btrim(p_description) end,
      v_parts[i],
      p_category_id, p_account_id, p_to_account_id, coalesce(p_payment_method, 'pix'),
      v_comp, v_due,
      case when v_settled then v_comp else null end,
      case when i = 1 then v_status else 'pending' end,
      'none',
      case when v_n > 1 then i else null end,
      case when v_n > 1 then v_n else null end,
      coalesce(nullif(p_source, ''), 'manual'),
      nullif(btrim(coalesce(p_notes, '')), ''),
      case when i = 1 then p_idempotency_key else null end
    ) returning id into v_id;

    if v_first is null then v_first := v_id; end if;
  end loop;
  exception when unique_violation then
    if p_idempotency_key is not null then
      select id into v_existing
      from public.transactions
      where space_id = v_space and idempotency_key = p_idempotency_key and is_demo = false
      limit 1;
      if v_existing is not null then
        return v_existing;
      end if;
    end if;
    raise;
  end;

  perform public.write_finance_audit(v_space, 'transactions', v_first, 'insert',
    jsonb_build_object(
      'description', btrim(p_description),
      'amount', round(p_amount, 2),
      'kind', p_kind,
      'entity_id', p_entity_id,
      'installments', v_n,
      'idempotency_key', p_idempotency_key
    ));
  return v_first;
end;
$$;

create or replace function public.cancel_transaction(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_status text;
  v_source text;
  v_kind text;
begin
  if v_user is null then raise exception 'sessao invalida'; end if;
  select space_id, status, source, kind into v_space, v_status, v_source, v_kind
  from public.transactions where id = p_id and is_demo = false and deleted_at is null for update;
  if v_space is null then raise exception 'lancamento invalido'; end if;
  perform public.assert_writable_finance_space(v_space);
  if v_kind = 'transfer' and v_source in ('card_installment_payment','card_bill_payment') then
    raise exception 'pagamento de fatura nao pode ser cancelado por este fluxo';
  end if;
  if v_status = 'cancelled' then return p_id; end if;

  update public.transactions set status = 'cancelled', user_id = v_user where id = p_id;
  perform public.write_finance_audit(v_space, 'transactions', p_id, 'cancel',
    jsonb_build_object('previous_status', v_status));
  return p_id;
end;
$$;

create or replace function public.settle_transaction(p_id uuid, p_paid_at date default current_date)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_status text;
  v_kind text;
  v_next text;
begin
  if v_user is null then raise exception 'sessao invalida'; end if;
  select space_id, status, kind into v_space, v_status, v_kind
  from public.transactions where id = p_id and is_demo = false and deleted_at is null for update;
  if v_space is null then raise exception 'lancamento invalido'; end if;
  perform public.assert_writable_finance_space(v_space);
  if v_status = 'cancelled' then raise exception 'lancamento cancelado nao pode ser liquidado'; end if;
  if v_status in ('paid','received') then return p_id; end if;

  v_next := case when v_kind = 'income' then 'received' else 'paid' end;
  update public.transactions
     set status = v_next, paid_at = coalesce(p_paid_at, current_date), user_id = v_user
   where id = p_id;
  perform public.write_finance_audit(v_space, 'transactions', p_id, 'settle',
    jsonb_build_object('previous_status', v_status, 'paid_at', coalesce(p_paid_at, current_date)));
  return p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Orcamento / reservas / categorias / cartao
-- ---------------------------------------------------------------------------

create or replace function public.upsert_budget(
  p_entity_id uuid,
  p_category_id uuid,
  p_month date,
  p_planned_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_id uuid;
  v_month date;
  v_action text;
begin
  if v_user is null then raise exception 'sessao invalida'; end if;
  v_space := public.current_finance_space_id();
  perform public.assert_writable_finance_space(v_space);
  if p_planned_amount is null or p_planned_amount < 0 then raise exception 'valor invalido'; end if;
  if not exists (
    select 1 from public.financial_entities e
    where e.id = p_entity_id and e.space_id = v_space and e.is_demo = false
  ) then
    raise exception 'entidade invalida';
  end if;
  if not exists (
    select 1 from public.categories c
    where c.id = p_category_id and c.space_id = v_space and c.kind = 'expense' and c.is_demo = false
  ) then
    raise exception 'categoria de saida invalida';
  end if;
  v_month := date_trunc('month', coalesce(p_month, current_date))::date;

  select id into v_id
  from public.budgets
  where space_id = v_space and entity_id = p_entity_id and category_id = p_category_id
    and month = v_month and is_demo = false
  for update;

  if v_id is null then
    begin
      insert into public.budgets(user_id, space_id, is_demo, entity_id, category_id, month, planned_amount)
      values (v_user, v_space, false, p_entity_id, p_category_id, v_month, round(p_planned_amount, 2))
      returning id into v_id;
      v_action := 'insert';
    exception when unique_violation then
      select id into v_id
      from public.budgets
      where space_id = v_space and entity_id = p_entity_id and category_id = p_category_id
        and month = v_month and is_demo = false
      for update;
      update public.budgets set planned_amount = round(p_planned_amount, 2), user_id = v_user where id = v_id;
      v_action := 'update';
    end;
  else
    update public.budgets set planned_amount = round(p_planned_amount, 2), user_id = v_user where id = v_id;
    v_action := 'update';
  end if;

  perform public.write_finance_audit(v_space, 'budgets', v_id, v_action,
    jsonb_build_object('entity_id', p_entity_id, 'category_id', p_category_id, 'month', v_month, 'planned_amount', round(p_planned_amount, 2)));
  return v_id;
end;
$$;

create or replace function public.delete_budget(p_id uuid)
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
  select space_id into v_space from public.budgets where id = p_id and is_demo = false for update;
  if v_space is null then raise exception 'orcamento invalido'; end if;
  perform public.assert_writable_finance_space(v_space);
  delete from public.budgets where id = p_id;
  perform public.write_finance_audit(v_space, 'budgets', p_id, 'delete', '{}'::jsonb);
  return p_id;
end;
$$;

create or replace function public.create_reserve(
  p_entity_id uuid,
  p_name text,
  p_target_amount numeric,
  p_current_amount numeric,
  p_account_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_id uuid;
begin
  if v_user is null then raise exception 'sessao invalida'; end if;
  v_space := public.current_finance_space_id();
  perform public.assert_writable_finance_space(v_space);
  if btrim(coalesce(p_name, '')) = '' then raise exception 'nome obrigatorio'; end if;
  if not exists (
    select 1 from public.financial_entities e
    where e.id = p_entity_id and e.space_id = v_space and e.is_demo = false
  ) then
    raise exception 'entidade invalida';
  end if;
  if p_account_id is not null and not exists (
    select 1 from public.accounts a
    where a.id = p_account_id and a.space_id = v_space and a.entity_id = p_entity_id and a.is_demo = false
  ) then
    raise exception 'conta invalida';
  end if;

  insert into public.reserves(user_id, space_id, is_demo, entity_id, account_id, name, target_amount, current_amount, notes)
  values (v_user, v_space, false, p_entity_id, p_account_id, btrim(p_name), round(coalesce(p_target_amount,0),2), round(coalesce(p_current_amount,0),2), nullif(btrim(coalesce(p_notes,'')), ''))
  returning id into v_id;

  perform public.write_finance_audit(v_space, 'reserves', v_id, 'insert',
    jsonb_build_object('entity_id', p_entity_id, 'name', btrim(p_name), 'target_amount', round(coalesce(p_target_amount,0),2), 'current_amount', round(coalesce(p_current_amount,0),2)));
  return v_id;
end;
$$;

create or replace function public.update_reserve_amount(p_id uuid, p_current_amount numeric)
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
  if p_current_amount is null or p_current_amount < 0 then raise exception 'valor invalido'; end if;
  select space_id into v_space from public.reserves where id = p_id and is_demo = false for update;
  if v_space is null then raise exception 'reserva invalida'; end if;
  perform public.assert_writable_finance_space(v_space);
  update public.reserves set current_amount = round(p_current_amount, 2), user_id = v_user where id = p_id;
  perform public.write_finance_audit(v_space, 'reserves', p_id, 'update',
    jsonb_build_object('current_amount', round(p_current_amount, 2)));
  return p_id;
end;
$$;

create or replace function public.delete_reserve(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_name text;
begin
  if v_user is null then raise exception 'sessao invalida'; end if;
  select space_id, name into v_space, v_name from public.reserves where id = p_id and is_demo = false for update;
  if v_space is null then raise exception 'reserva invalida'; end if;
  perform public.assert_writable_finance_space(v_space);
  delete from public.reserves where id = p_id;
  perform public.write_finance_audit(v_space, 'reserves', p_id, 'delete', jsonb_build_object('name', v_name));
  return p_id;
end;
$$;

create or replace function public.create_category(p_name text, p_kind text, p_color text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_id uuid;
begin
  if v_user is null then raise exception 'sessao invalida'; end if;
  v_space := public.current_finance_space_id();
  perform public.assert_writable_finance_space(v_space);
  if btrim(coalesce(p_name, '')) = '' then raise exception 'nome obrigatorio'; end if;
  if p_kind not in ('income','expense') then raise exception 'tipo invalido'; end if;

  insert into public.categories(user_id, space_id, is_demo, name, kind, color, active)
  values (v_user, v_space, false, btrim(p_name), p_kind, coalesce(nullif(p_color,''), '#8A8A8A'), true)
  returning id into v_id;

  perform public.write_finance_audit(v_space, 'categories', v_id, 'insert',
    jsonb_build_object('name', btrim(p_name), 'kind', p_kind, 'color', coalesce(nullif(p_color,''), '#8A8A8A')));
  return v_id;
end;
$$;

create or replace function public.update_category(p_id uuid, p_name text, p_kind text, p_color text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_kind text;
  v_used boolean;
begin
  if v_user is null then raise exception 'sessao invalida'; end if;
  select space_id, kind into v_space, v_kind from public.categories where id = p_id and is_demo = false for update;
  if v_space is null then raise exception 'categoria invalida'; end if;
  perform public.assert_writable_finance_space(v_space);
  if btrim(coalesce(p_name, '')) = '' then raise exception 'nome obrigatorio'; end if;
  if p_kind not in ('income','expense') then raise exception 'tipo invalido'; end if;

  if p_kind is distinct from v_kind then
    select exists (
      select 1 from public.transactions t where t.category_id = p_id and t.is_demo = false
      union all
      select 1 from public.credit_card_purchases p where p.category_id = p_id and p.is_demo = false
      union all
      select 1 from public.recurring_transactions r where r.category_id = p_id and r.is_demo = false
      union all
      select 1 from public.budgets b where b.category_id = p_id and b.is_demo = false
    ) into v_used;
    if v_used then
      raise exception 'nao e permitido alterar o tipo de categoria ja utilizada';
    end if;
  end if;

  update public.categories
     set name = btrim(p_name), kind = p_kind, color = coalesce(nullif(p_color,''), color), user_id = v_user
   where id = p_id;
  perform public.write_finance_audit(v_space, 'categories', p_id, 'update',
    jsonb_build_object('name', btrim(p_name), 'kind', p_kind, 'color', p_color));
  return p_id;
end;
$$;

create or replace function public.toggle_category_active(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_active boolean;
  v_name text;
begin
  if v_user is null then raise exception 'sessao invalida'; end if;
  select space_id, coalesce(active, true), name into v_space, v_active, v_name
  from public.categories where id = p_id and is_demo = false for update;
  if v_space is null then raise exception 'categoria invalida'; end if;
  perform public.assert_writable_finance_space(v_space);
  update public.categories set active = not v_active, user_id = v_user where id = p_id;
  perform public.write_finance_audit(v_space, 'categories', p_id,
    case when v_active then 'deactivate' else 'reactivate' end,
    jsonb_build_object('name', v_name));
  return not v_active;
end;
$$;

create or replace function public.create_credit_card(
  p_entity_id uuid,
  p_name text,
  p_credit_limit numeric,
  p_closing_day integer,
  p_due_day integer,
  p_account_id uuid default null,
  p_brand text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_id uuid;
begin
  if v_user is null then raise exception 'sessao invalida'; end if;
  v_space := public.current_finance_space_id();
  perform public.assert_writable_finance_space(v_space);
  if btrim(coalesce(p_name, '')) = '' then raise exception 'nome obrigatorio'; end if;
  if p_closing_day is null or p_closing_day < 1 or p_closing_day > 31 then raise exception 'dia de fechamento invalido'; end if;
  if p_due_day is null or p_due_day < 1 or p_due_day > 31 then raise exception 'dia de vencimento invalido'; end if;
  if not exists (
    select 1 from public.financial_entities e
    where e.id = p_entity_id and e.space_id = v_space and e.is_demo = false
  ) then
    raise exception 'entidade invalida';
  end if;
  if p_account_id is not null and not exists (
    select 1 from public.accounts a
    where a.id = p_account_id and a.space_id = v_space and a.entity_id = p_entity_id and a.is_demo = false
  ) then
    raise exception 'conta invalida';
  end if;

  insert into public.credit_cards(
    user_id, space_id, is_demo, entity_id, account_id, name, brand, credit_limit, closing_day, due_day, active
  ) values (
    v_user, v_space, false, p_entity_id, p_account_id, btrim(p_name), nullif(btrim(coalesce(p_brand,'')), ''),
    round(coalesce(p_credit_limit, 0), 2), p_closing_day, p_due_day, true
  ) returning id into v_id;

  perform public.write_finance_audit(v_space, 'credit_cards', v_id, 'insert',
    jsonb_build_object('name', btrim(p_name), 'entity_id', p_entity_id, 'credit_limit', round(coalesce(p_credit_limit,0),2)));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Documentos: catalogo reconciliavel (Storage + metadata nao sao a mesma TX)
-- ---------------------------------------------------------------------------

create or replace function public.register_financial_document(
  p_storage_path text,
  p_file_name text,
  p_mime_type text default null,
  p_size_bytes bigint default null,
  p_source text default 'upload'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_id uuid;
begin
  if v_user is null then raise exception 'sessao invalida'; end if;
  v_space := public.current_finance_space_id();
  perform public.assert_writable_finance_space(v_space);
  if btrim(coalesce(p_storage_path, '')) = '' then raise exception 'arquivo obrigatorio'; end if;

  insert into public.financial_documents(
    user_id, space_id, file_name, storage_path, mime_type, size_bytes, source, status
  ) values (
    v_user, v_space, coalesce(nullif(btrim(p_file_name), ''), 'documento'),
    p_storage_path, p_mime_type, p_size_bytes,
    case when p_source in ('camera','upload') then p_source else 'upload' end,
    'uploaded'
  )
  on conflict (storage_path) do update
    set status = case when public.financial_documents.status = 'failed' then 'uploaded' else public.financial_documents.status end,
        file_name = excluded.file_name,
        mime_type = coalesce(excluded.mime_type, public.financial_documents.mime_type),
        size_bytes = coalesce(excluded.size_bytes, public.financial_documents.size_bytes),
        updated_at = now()
  returning id into v_id;

  perform public.write_finance_audit(v_space, 'financial_documents', v_id, 'insert',
    jsonb_build_object('file_name', p_file_name, 'status', 'uploaded'));
  return v_id;
end;
$$;

create or replace function public.set_financial_document_status(p_id uuid, p_status text)
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
  if p_status not in ('uploaded','processing','processed','failed','linked','archived') then
    raise exception 'status de documento invalido';
  end if;
  select space_id into v_space from public.financial_documents where id = p_id for update;
  if v_space is null then raise exception 'documento invalido'; end if;
  perform public.assert_writable_finance_space(v_space);
  update public.financial_documents set status = p_status, updated_at = now() where id = p_id;
  perform public.write_finance_audit(v_space, 'financial_documents', p_id, 'update',
    jsonb_build_object('status', p_status));
  return p_id;
end;
$$;

create or replace function public.link_financial_document(p_id uuid, p_transaction_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_tx_space uuid;
begin
  if v_user is null then raise exception 'sessao invalida'; end if;
  select space_id into v_space from public.financial_documents where id = p_id for update;
  if v_space is null then raise exception 'documento invalido'; end if;
  perform public.assert_writable_finance_space(v_space);
  select space_id into v_tx_space from public.transactions where id = p_transaction_id and is_demo = false;
  if v_tx_space is null or v_tx_space is distinct from v_space then
    raise exception 'lancamento invalido para o documento';
  end if;
  update public.financial_documents
     set transaction_id = p_transaction_id, status = 'linked', updated_at = now()
   where id = p_id;
  perform public.write_finance_audit(v_space, 'financial_documents', p_id, 'update',
    jsonb_build_object('status', 'linked', 'transaction_id', p_transaction_id));
  return p_id;
end;
$$;

create or replace function public.mark_financial_document_failed(p_storage_path text, p_file_name text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  v_id := public.register_financial_document(p_storage_path, p_file_name, null, null, 'upload');
  perform public.set_financial_document_status(v_id, 'failed');
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.create_financial_entity(text, text, text, text) from public, anon;
grant execute on function public.create_financial_entity(text, text, text, text) to authenticated;
revoke all on function public.toggle_financial_entity_active(uuid) from public, anon;
grant execute on function public.toggle_financial_entity_active(uuid) to authenticated;
revoke all on function public.create_account(uuid, text, text, text, numeric) from public, anon;
grant execute on function public.create_account(uuid, text, text, text, numeric) to authenticated;
revoke all on function public.toggle_account_active(uuid) from public, anon;
grant execute on function public.toggle_account_active(uuid) to authenticated;
revoke all on function public.create_transaction(uuid, uuid, text, text, numeric, uuid, uuid, text, date, date, text, text, integer, text, boolean, text, text) from public, anon;
grant execute on function public.create_transaction(uuid, uuid, text, text, numeric, uuid, uuid, text, date, date, text, text, integer, text, boolean, text, text) to authenticated;
revoke all on function public.cancel_transaction(uuid) from public, anon;
grant execute on function public.cancel_transaction(uuid) to authenticated;
revoke all on function public.settle_transaction(uuid, date) from public, anon;
grant execute on function public.settle_transaction(uuid, date) to authenticated;
revoke all on function public.upsert_budget(uuid, uuid, date, numeric) from public, anon;
grant execute on function public.upsert_budget(uuid, uuid, date, numeric) to authenticated;
revoke all on function public.delete_budget(uuid) from public, anon;
grant execute on function public.delete_budget(uuid) to authenticated;
revoke all on function public.create_reserve(uuid, text, numeric, numeric, uuid, text) from public, anon;
grant execute on function public.create_reserve(uuid, text, numeric, numeric, uuid, text) to authenticated;
revoke all on function public.update_reserve_amount(uuid, numeric) from public, anon;
grant execute on function public.update_reserve_amount(uuid, numeric) to authenticated;
revoke all on function public.delete_reserve(uuid) from public, anon;
grant execute on function public.delete_reserve(uuid) to authenticated;
revoke all on function public.create_category(text, text, text) from public, anon;
grant execute on function public.create_category(text, text, text) to authenticated;
revoke all on function public.update_category(uuid, text, text, text) from public, anon;
grant execute on function public.update_category(uuid, text, text, text) to authenticated;
revoke all on function public.toggle_category_active(uuid) from public, anon;
grant execute on function public.toggle_category_active(uuid) to authenticated;
revoke all on function public.create_credit_card(uuid, text, numeric, integer, integer, uuid, text) from public, anon;
grant execute on function public.create_credit_card(uuid, text, numeric, integer, integer, uuid, text) to authenticated;
revoke all on function public.register_financial_document(text, text, text, bigint, text) from public, anon;
grant execute on function public.register_financial_document(text, text, text, bigint, text) to authenticated;
revoke all on function public.set_financial_document_status(uuid, text) from public, anon;
grant execute on function public.set_financial_document_status(uuid, text) to authenticated;
revoke all on function public.link_financial_document(uuid, uuid) from public, anon;
grant execute on function public.link_financial_document(uuid, uuid) to authenticated;
revoke all on function public.mark_financial_document_failed(text, text) from public, anon;
grant execute on function public.mark_financial_document_failed(text, text) to authenticated;

-- Cliente nao escreve tabelas financeiras diretamente. Mutations passam pelas RPCs.
revoke insert, update, delete on public.transactions from authenticated;
revoke insert, update, delete on public.financial_entities from authenticated;
revoke insert, update, delete on public.accounts from authenticated;
revoke insert, update, delete on public.budgets from authenticated;
revoke insert, update, delete on public.reserves from authenticated;
revoke insert, update, delete on public.categories from authenticated;
revoke insert, update, delete on public.credit_cards from authenticated;
revoke insert, update, delete on public.financial_documents from authenticated;
grant select on public.transactions, public.financial_entities, public.accounts,
  public.budgets, public.reserves, public.categories, public.credit_cards,
  public.financial_documents to authenticated;

create or replace function public.protect_finance_identity_cols()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id then raise exception 'id imutavel'; end if;
  if new.space_id is distinct from old.space_id then raise exception 'space_id imutavel'; end if;
  return new;
end;
$$;

drop trigger if exists protect_entity_identity on public.financial_entities;
create trigger protect_entity_identity
before update on public.financial_entities
for each row execute function public.protect_finance_identity_cols();

drop trigger if exists protect_account_identity on public.accounts;
create trigger protect_account_identity
before update on public.accounts
for each row execute function public.protect_finance_identity_cols();

drop trigger if exists protect_category_identity on public.categories;
create trigger protect_category_identity
before update on public.categories
for each row execute function public.protect_finance_identity_cols();

drop trigger if exists protect_budget_identity on public.budgets;
create trigger protect_budget_identity
before update on public.budgets
for each row execute function public.protect_finance_identity_cols();

drop trigger if exists protect_reserve_identity on public.reserves;
create trigger protect_reserve_identity
before update on public.reserves
for each row execute function public.protect_finance_identity_cols();

drop trigger if exists protect_card_identity on public.credit_cards;
create trigger protect_card_identity
before update on public.credit_cards
for each row execute function public.protect_finance_identity_cols();

drop trigger if exists protect_document_identity on public.financial_documents;
create trigger protect_document_identity
before update on public.financial_documents
for each row execute function public.protect_finance_identity_cols();

-- T1-T11: ver src/lib/audit-integrity.check.ts (contrato) e comentarios abaixo.
-- T1 entidade+conta: uma funcao; exception na conta reverte entidade e audit.
-- T2 transaction+audit: write_finance_audit na mesma TX; falha de audit reverte o insert.
-- T3 cancel: um update + um audit; replay de cancelled nao gera segundo audit.
-- T4 idempotency_key unique por space; replay devolve o id existente.
-- T5 budgets unique (space, entity, category, month).
-- T6 viewer: assert_writable_finance_space bloqueia.
-- T7 editor: audit.user_id = auth.uid().
-- T8 outro space: objeto nao encontrado ou can_write false.
-- T9/T10 audit_log: revoke + trigger imutavel.
-- T11 storage e postgres nao sao a mesma TX; status uploaded/failed/linked e reconciliavel.
