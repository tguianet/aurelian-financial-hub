-- Integridade de dinheiro e datas financeiras.
-- Nao altera valores existentes. Nao apaga historico.
-- DATE continua DATE; created_at/updated_at continuam TIMESTAMPTZ.

create or replace function public.split_money_installments(p_total numeric, p_count integer)
returns numeric[]
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_cents bigint;
  v_base bigint;
  v_last bigint;
  v_out numeric[] := '{}';
  i integer;
begin
  if p_count is null or p_count < 1 then
    raise exception 'parcelas devem ser >= 1';
  end if;
  v_cents := round(coalesce(p_total, 0) * 100)::bigint;
  if v_cents <= 0 then
    raise exception 'valor deve ser maior que zero';
  end if;
  if v_cents < p_count then
    raise exception 'valor insuficiente para o numero de parcelas';
  end if;
  v_base := v_cents / p_count;
  v_last := v_cents - v_base * (p_count - 1);
  for i in 1..p_count loop
    v_out := v_out || round(((case when i = p_count then v_last else v_base end)::numeric / 100), 2);
  end loop;
  return v_out;
end;
$$;

create or replace function public.add_months_clamped(
  p_date date,
  p_months integer,
  p_desired_day integer default null
)
returns date
language sql
immutable
set search_path = public, pg_temp
as $$
  select public.clamp_month_day(
    extract(year from (date_trunc('month', p_date) + make_interval(months => p_months)))::integer,
    extract(month from (date_trunc('month', p_date) + make_interval(months => p_months)))::integer,
    coalesce(p_desired_day, extract(day from p_date)::integer)
  );
$$;

comment on function public.split_money_installments(numeric, integer) is
  'Divide valor em N parcelas em centavos. Resto na ultima. Soma = total.';
comment on function public.add_months_clamped(date, integer, integer) is
  'Soma meses preservando o dia desejado, com clamp no ultimo dia valido.';

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
  v_parts numeric[];
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

  v_parts := public.split_money_installments(_total_amount, _installments);

  insert into public.credit_card_purchases(
    user_id, space_id, is_demo, credit_card_id, entity_id, category_id,
    description, total_amount, purchase_date, installments
  ) values (
    v_user_id, v_space_id, false, _credit_card_id, v_entity_id, _category_id,
    btrim(_description), round(_total_amount, 2), _purchase_date, _installments
  ) returning id into v_purchase_id;

  v_first_month := date_trunc('month', _purchase_date)::date
    + case when extract(day from _purchase_date)::integer <= v_closing_day
        then interval '1 month' else interval '2 months' end;

  for i in 1.._installments loop
    v_due_date := public.card_due_date(
      public.add_months_clamped(v_first_month, i - 1, 1),
      v_due_day
    );
    insert into public.credit_card_installments(
      user_id, space_id, is_demo, purchase_id, credit_card_id, installment_no, amount, due_date, status
    ) values (
      v_user_id, v_space_id, false, v_purchase_id, _credit_card_id, i,
      v_parts[i],
      v_due_date, 'pending'
    );
  end loop;

  insert into public.audit_log(user_id, space_id, table_name, record_id, action, details)
  values (
    v_user_id, v_space_id, 'credit_card_purchases', v_purchase_id, 'insert',
    jsonb_build_object(
      'actor_id', v_user_id,
      'credit_card_id', _credit_card_id,
      'amount', round(_total_amount, 2),
      'installments', _installments,
      'purchase_date', _purchase_date
    )
  );

  return v_purchase_id;
end;
$$;

revoke all on function public.split_money_installments(numeric, integer) from public, anon;
grant execute on function public.split_money_installments(numeric, integer) to authenticated;

revoke all on function public.add_months_clamped(date, integer, integer) from public, anon;
grant execute on function public.add_months_clamped(date, integer, integer) to authenticated;

revoke all on function public.create_credit_card_purchase(uuid, uuid, text, numeric, date, integer) from public, anon;
grant execute on function public.create_credit_card_purchase(uuid, uuid, text, numeric, date, integer) to authenticated;
