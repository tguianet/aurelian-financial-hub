-- Motor de recorrencias: definicao real, ocorrencias idempotentes, sem dupla contagem.
-- Autorizacao: space_id + can_write_finance_space. user_id = ator.
-- Nenhum dado real e apagado.

-- ---------------------------------------------------------------------------
-- Colunas da definicao
-- ---------------------------------------------------------------------------

alter table public.recurring_transactions
  add column if not exists weekday integer;

alter table public.recurring_transactions
  add column if not exists month_of_year integer;

alter table public.recurring_transactions
  add column if not exists starts_at date;

alter table public.recurring_transactions
  add column if not exists ends_at date;

alter table public.recurring_transactions
  add column if not exists payment_method text;

alter table public.recurring_transactions
  add column if not exists notes text;

alter table public.recurring_transactions
  add column if not exists updated_at timestamptz not null default now();

update public.recurring_transactions
   set starts_at = coalesce(starts_at, next_run, current_date),
       payment_method = coalesce(nullif(payment_method, ''), 'pix')
 where starts_at is null or payment_method is null;

update public.recurring_transactions
   set weekday = extract(isodow from coalesce(next_run, starts_at, current_date))::integer
 where frequency = 'weekly' and weekday is null and is_demo = false;

update public.recurring_transactions
   set day_of_month = extract(day from coalesce(next_run, starts_at, current_date))::integer
 where frequency = 'monthly' and day_of_month is null and is_demo = false;

update public.recurring_transactions
   set month_of_year = extract(month from coalesce(next_run, starts_at, current_date))::integer,
       day_of_month = coalesce(day_of_month, extract(day from coalesce(next_run, starts_at, current_date))::integer)
 where frequency = 'yearly' and is_demo = false
   and (month_of_year is null or day_of_month is null);

alter table public.recurring_transactions
  alter column starts_at set default current_date;

alter table public.recurring_transactions
  alter column starts_at set not null;

alter table public.recurring_transactions
  alter column payment_method set default 'pix';

alter table public.recurring_transactions
  alter column payment_method set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'recurring_transactions_payment_method_check'
  ) then
    alter table public.recurring_transactions
      add constraint recurring_transactions_payment_method_check
      check (payment_method in ('pix','cash','debit','credit','boleto','transfer','other'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'recurring_transactions_weekday_check'
  ) then
    alter table public.recurring_transactions
      add constraint recurring_transactions_weekday_check
      check (weekday is null or weekday between 1 and 7);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'recurring_transactions_month_of_year_check'
  ) then
    alter table public.recurring_transactions
      add constraint recurring_transactions_month_of_year_check
      check (month_of_year is null or month_of_year between 1 and 12);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'recurring_transactions_day_of_month_check'
  ) then
    alter table public.recurring_transactions
      add constraint recurring_transactions_day_of_month_check
      check (day_of_month is null or day_of_month between 1 and 31);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'recurring_transactions_ends_after_starts'
  ) then
    alter table public.recurring_transactions
      add constraint recurring_transactions_ends_after_starts
      check (ends_at is null or starts_at is null or ends_at >= starts_at);
  end if;
end $$;

comment on column public.recurring_transactions.weekday is 'ISO DOW 1=segunda ... 7=domingo. Usado em frequency=weekly.';
comment on column public.recurring_transactions.month_of_year is 'Mes 1-12 para frequency=yearly.';
comment on column public.recurring_transactions.starts_at is 'Inicio da serie. Nao reescreve historico ja materializado.';
comment on column public.recurring_transactions.ends_at is 'Ultima data permitida para gerar ocorrencias.';

create index if not exists recurring_transactions_due_idx
  on public.recurring_transactions (space_id, next_run)
  where is_demo = false and active = true;

-- ---------------------------------------------------------------------------
-- Chave de idempotencia nas ocorrencias
-- ---------------------------------------------------------------------------

alter table public.transactions
  add column if not exists recurring_transaction_id uuid;

alter table public.transactions
  add column if not exists recurring_occurrence_date date;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_recurring_transaction_id_fkey'
  ) then
    alter table public.transactions
      add constraint transactions_recurring_transaction_id_fkey
      foreign key (recurring_transaction_id)
      references public.recurring_transactions(id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_recurring_occurrence_unique'
  ) then
    alter table public.transactions
      add constraint transactions_recurring_occurrence_unique
      unique (recurring_transaction_id, recurring_occurrence_date);
  end if;
end $$;

create index if not exists transactions_recurring_id_idx
  on public.transactions (recurring_transaction_id)
  where recurring_transaction_id is not null;

comment on column public.transactions.recurring_transaction_id is
  'Definicao de recorrencia que originou este lancamento. Nao duplicar com a soma da definicao na projecao.';
comment on column public.transactions.recurring_occurrence_date is
  'Data canonica da ocorrencia. Unique com recurring_transaction_id impede duplicacao.';

-- ---------------------------------------------------------------------------
-- Calendario: primeiro >= from, proximo = primeiro(from+1)
-- ---------------------------------------------------------------------------

create or replace function public.clamp_month_day(p_year integer, p_month integer, p_day integer)
returns date
language sql
immutable
as $$
  select make_date(
    p_year,
    p_month,
    least(
      p_day,
      extract(day from (date_trunc('month', make_date(p_year, p_month, 1)) + interval '1 month' - interval '1 day'))::integer
    )
  );
$$;

create or replace function public.first_recurring_occurrence_date(
  p_from date,
  p_frequency text,
  p_day_of_month integer,
  p_weekday integer,
  p_month_of_year integer
)
returns date
language plpgsql
immutable
as $$
declare
  v_from date := p_from;
  v_dow integer;
  v_target_dow integer;
  v_day integer;
  v_month integer;
  v_candidate date;
begin
  if v_from is null then
    raise exception 'data inicial obrigatoria';
  end if;

  if p_frequency = 'weekly' then
    v_dow := extract(isodow from v_from)::integer;
    v_target_dow := coalesce(p_weekday, v_dow);
    if v_target_dow < 1 or v_target_dow > 7 then
      raise exception 'weekday invalido';
    end if;
    return v_from + ((v_target_dow - v_dow + 7) % 7);
  elsif p_frequency = 'monthly' then
    v_day := coalesce(p_day_of_month, extract(day from v_from)::integer);
    v_candidate := public.clamp_month_day(extract(year from v_from)::integer, extract(month from v_from)::integer, v_day);
    if v_candidate < v_from then
      v_candidate := public.clamp_month_day(
        extract(year from (date_trunc('month', v_from) + interval '1 month'))::integer,
        extract(month from (date_trunc('month', v_from) + interval '1 month'))::integer,
        v_day
      );
    end if;
    return v_candidate;
  elsif p_frequency = 'yearly' then
    v_month := coalesce(p_month_of_year, extract(month from v_from)::integer);
    v_day := coalesce(p_day_of_month, extract(day from v_from)::integer);
    v_candidate := public.clamp_month_day(extract(year from v_from)::integer, v_month, v_day);
    if v_candidate < v_from then
      v_candidate := public.clamp_month_day(extract(year from v_from)::integer + 1, v_month, v_day);
    end if;
    return v_candidate;
  end if;

  raise exception 'frequencia invalida';
end;
$$;

create or replace function public.next_recurring_occurrence_date(
  p_from date,
  p_frequency text,
  p_day_of_month integer,
  p_weekday integer,
  p_month_of_year integer
)
returns date
language sql
immutable
as $$
  select public.first_recurring_occurrence_date(
    p_from + 1,
    p_frequency,
    p_day_of_month,
    p_weekday,
    p_month_of_year
  );
$$;

-- ---------------------------------------------------------------------------
-- Integridade da definicao
-- ---------------------------------------------------------------------------

create or replace function public.validate_recurring_transaction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entity_space uuid;
  v_account_entity uuid;
  v_account_space uuid;
  v_category_kind text;
  v_category_space uuid;
  v_category_active boolean;
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

  if new.amount is null or new.amount <= 0 then
    raise exception 'valor deve ser maior que zero';
  end if;

  if new.kind not in ('income', 'expense') then
    raise exception 'tipo invalido';
  end if;

  if new.frequency not in ('weekly', 'monthly', 'yearly') then
    raise exception 'frequencia invalida';
  end if;

  if btrim(coalesce(new.description, '')) = '' then
    raise exception 'descricao obrigatoria';
  end if;

  if new.account_id is null then
    raise exception 'conta obrigatoria';
  end if;

  if new.category_id is null then
    raise exception 'categoria obrigatoria';
  end if;

  select e.space_id into v_entity_space
  from public.financial_entities e
  where e.id = new.entity_id and e.is_demo = false;

  if v_entity_space is null or v_entity_space is distinct from new.space_id then
    raise exception 'entidade nao pertence ao espaco financeiro';
  end if;

  select a.entity_id, a.space_id
    into v_account_entity, v_account_space
  from public.accounts a
  where a.id = new.account_id and a.is_demo = false;

  if v_account_space is null or v_account_space is distinct from new.space_id then
    raise exception 'conta nao pertence ao espaco financeiro';
  end if;

  if v_account_entity is distinct from new.entity_id then
    raise exception 'conta invalida para a entidade';
  end if;

  select c.kind, c.space_id, c.active
    into v_category_kind, v_category_space, v_category_active
  from public.categories c
  where c.id = new.category_id and c.is_demo = false;

  if v_category_space is null or v_category_space is distinct from new.space_id then
    raise exception 'categoria nao pertence ao espaco financeiro';
  end if;

  if v_category_kind is distinct from new.kind then
    raise exception 'categoria incompativel com o tipo';
  end if;

  if tg_op = 'insert' or new.category_id is distinct from old.category_id then
    if v_category_active is not true then
      raise exception 'categoria inativa';
    end if;
  end if;

  if new.frequency = 'weekly' then
    new.weekday := coalesce(new.weekday, extract(isodow from new.starts_at)::integer);
    new.day_of_month := null;
    new.month_of_year := null;
  elsif new.frequency = 'monthly' then
    new.day_of_month := coalesce(new.day_of_month, extract(day from new.starts_at)::integer);
    new.weekday := null;
    new.month_of_year := null;
  else
    new.month_of_year := coalesce(new.month_of_year, extract(month from new.starts_at)::integer);
    new.day_of_month := coalesce(new.day_of_month, extract(day from new.starts_at)::integer);
    new.weekday := null;
  end if;

  if new.next_run is null then
    new.next_run := public.first_recurring_occurrence_date(
      new.starts_at, new.frequency, new.day_of_month, new.weekday, new.month_of_year
    );
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists validate_recurring_transaction on public.recurring_transactions;
create trigger validate_recurring_transaction
before insert or update on public.recurring_transactions
for each row execute function public.validate_recurring_transaction();

-- Ocorrencias geradas pela definicao podem repetir categoria mesmo se ela ficar inativa.
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
  if tg_table_name = 'transactions'
     and coalesce(new.source, '') = 'recurring' then
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

-- ---------------------------------------------------------------------------
-- Geracao idempotente
-- ---------------------------------------------------------------------------

create or replace function public.generate_due_recurring_transactions(p_until date default current_date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_actor uuid := auth.uid();
  v_until date := coalesce(p_until, current_date);
  v_created integer := 0;
  v_occurrence date;
  v_next date;
  v_guard integer;
  v_inserted uuid;
begin
  for r in
    select *
    from public.recurring_transactions
    where is_demo = false
      and active = true
      and next_run is not null
      and next_run <= v_until
      and (v_actor is null or public.can_write_finance_space(space_id, v_actor))
    order by id
    for update skip locked
  loop
    v_occurrence := r.next_run;
    v_guard := 0;

    while v_occurrence is not null
      and v_occurrence <= v_until
      and (r.ends_at is null or v_occurrence <= r.ends_at)
      and v_guard < 1200
    loop
      v_guard := v_guard + 1;
      v_inserted := null;

      insert into public.transactions (
        user_id, space_id, is_demo, entity_id, kind, description, amount,
        category_id, account_id, to_account_id, to_entity_id, credit_card_id,
        payment_method, competence_date, due_date, paid_at, status,
        recurrence, source, notes,
        recurring_transaction_id, recurring_occurrence_date
      ) values (
        coalesce(v_actor, r.user_id), r.space_id, false, r.entity_id, r.kind, r.description, r.amount,
        r.category_id, r.account_id, null, null, null,
        r.payment_method, v_occurrence, v_occurrence, null, 'pending',
        'none', 'recurring', r.notes,
        r.id, v_occurrence
      )
      on conflict on constraint transactions_recurring_occurrence_unique
      do nothing
      returning id into v_inserted;

      if v_inserted is not null then
        v_created := v_created + 1;
        insert into public.audit_log(user_id, space_id, table_name, record_id, action, details)
        values (
          coalesce(v_actor, r.user_id), r.space_id, 'transactions', v_inserted, 'recurring_generate',
          jsonb_build_object(
            'recurring_transaction_id', r.id,
            'occurrence_date', v_occurrence,
            'amount', r.amount,
            'actor_id', v_actor
          )
        );
        v_inserted := null;
      end if;

      v_next := public.next_recurring_occurrence_date(
        v_occurrence, r.frequency, r.day_of_month, r.weekday, r.month_of_year
      );
      if v_next is null or v_next <= v_occurrence then
        raise exception 'falha ao avancar next_run';
      end if;
      v_occurrence := v_next;
    end loop;

    update public.recurring_transactions
       set next_run = v_occurrence,
           updated_at = now()
     where id = r.id;
  end loop;

  return v_created;
end;
$$;

-- ---------------------------------------------------------------------------
-- CRUD operacional
-- ---------------------------------------------------------------------------

create or replace function public.create_recurring_transaction(
  p_entity_id uuid,
  p_account_id uuid,
  p_category_id uuid,
  p_kind text,
  p_description text,
  p_amount numeric,
  p_frequency text,
  p_starts_at date,
  p_day_of_month integer default null,
  p_weekday integer default null,
  p_month_of_year integer default null,
  p_ends_at date default null,
  p_payment_method text default 'pix',
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_space_id uuid;
  v_id uuid;
  v_next date;
begin
  if v_user_id is null then
    raise exception 'sessao invalida';
  end if;

  select e.space_id into v_space_id
  from public.financial_entities e
  where e.id = p_entity_id and e.is_demo = false;

  if v_space_id is null then
    raise exception 'entidade invalida';
  end if;

  if not public.can_write_finance_space(v_space_id, v_user_id) then
    raise exception 'sem permissao de escrita no espaco financeiro';
  end if;

  v_next := public.first_recurring_occurrence_date(
    coalesce(p_starts_at, current_date),
    p_frequency,
    p_day_of_month,
    p_weekday,
    p_month_of_year
  );

  insert into public.recurring_transactions (
    user_id, space_id, is_demo, entity_id, account_id, category_id,
    kind, description, amount, frequency, day_of_month, weekday, month_of_year,
    starts_at, ends_at, next_run, active, payment_method, notes
  ) values (
    v_user_id, v_space_id, false, p_entity_id, p_account_id, p_category_id,
    p_kind, btrim(p_description), p_amount, p_frequency, p_day_of_month, p_weekday, p_month_of_year,
    coalesce(p_starts_at, current_date), p_ends_at, v_next, true,
    coalesce(p_payment_method, 'pix'), nullif(btrim(coalesce(p_notes, '')), '')
  ) returning id into v_id;

  insert into public.audit_log(user_id, space_id, table_name, record_id, action, details)
  values (
    v_user_id, v_space_id, 'recurring_transactions', v_id, 'insert',
    jsonb_build_object(
      'actor_id', v_user_id,
      'amount', p_amount,
      'frequency', p_frequency,
      'next_run', v_next
    )
  );

  perform public.generate_due_recurring_transactions(current_date);
  return v_id;
end;
$$;

create or replace function public.update_recurring_transaction(
  p_id uuid,
  p_entity_id uuid,
  p_account_id uuid,
  p_category_id uuid,
  p_kind text,
  p_description text,
  p_amount numeric,
  p_frequency text,
  p_starts_at date,
  p_day_of_month integer default null,
  p_weekday integer default null,
  p_month_of_year integer default null,
  p_ends_at date default null,
  p_payment_method text default 'pix',
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_space_id uuid;
  v_next date;
begin
  if v_user_id is null then
    raise exception 'sessao invalida';
  end if;

  select space_id into v_space_id
  from public.recurring_transactions
  where id = p_id and is_demo = false
  for update;

  if v_space_id is null then
    raise exception 'recorrencia invalida';
  end if;

  if not public.can_write_finance_space(v_space_id, v_user_id) then
    raise exception 'sem permissao de escrita no espaco financeiro';
  end if;

  v_next := public.first_recurring_occurrence_date(
    greatest(coalesce(p_starts_at, current_date), current_date),
    p_frequency,
    p_day_of_month,
    p_weekday,
    p_month_of_year
  );

  update public.recurring_transactions
     set entity_id = p_entity_id,
         account_id = p_account_id,
         category_id = p_category_id,
         kind = p_kind,
         description = btrim(p_description),
         amount = p_amount,
         frequency = p_frequency,
         day_of_month = p_day_of_month,
         weekday = p_weekday,
         month_of_year = p_month_of_year,
         starts_at = coalesce(p_starts_at, starts_at),
         ends_at = p_ends_at,
         next_run = v_next,
         payment_method = coalesce(p_payment_method, payment_method),
         notes = nullif(btrim(coalesce(p_notes, '')), ''),
         user_id = v_user_id
   where id = p_id;

  insert into public.audit_log(user_id, space_id, table_name, record_id, action, details)
  values (
    v_user_id, v_space_id, 'recurring_transactions', p_id, 'update',
    jsonb_build_object(
      'actor_id', v_user_id,
      'next_run', v_next,
      'note', 'alteracao vale so para ocorrencias ainda nao materializadas'
    )
  );

  return p_id;
end;
$$;

create or replace function public.pause_recurring_transaction(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_space_id uuid;
begin
  if v_user_id is null then raise exception 'sessao invalida'; end if;

  select space_id into v_space_id
  from public.recurring_transactions
  where id = p_id and is_demo = false
  for update;

  if v_space_id is null then raise exception 'recorrencia invalida'; end if;
  if not public.can_write_finance_space(v_space_id, v_user_id) then
    raise exception 'sem permissao de escrita no espaco financeiro';
  end if;

  update public.recurring_transactions
     set active = false, user_id = v_user_id
   where id = p_id;

  insert into public.audit_log(user_id, space_id, table_name, record_id, action, details)
  values (
    v_user_id, v_space_id, 'recurring_transactions', p_id, 'pause',
    jsonb_build_object('actor_id', v_user_id)
  );
  return true;
end;
$$;

create or replace function public.resume_recurring_transaction(p_id uuid)
returns date
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_space_id uuid;
  v_ends date;
  v_freq text;
  v_day integer;
  v_weekday integer;
  v_month integer;
  v_starts date;
  v_next date;
begin
  if v_user_id is null then raise exception 'sessao invalida'; end if;

  select space_id, ends_at, frequency, day_of_month, weekday, month_of_year, starts_at
    into v_space_id, v_ends, v_freq, v_day, v_weekday, v_month, v_starts
  from public.recurring_transactions
  where id = p_id and is_demo = false
  for update;

  if v_space_id is null then raise exception 'recorrencia invalida'; end if;
  if not public.can_write_finance_space(v_space_id, v_user_id) then
    raise exception 'sem permissao de escrita no espaco financeiro';
  end if;

  if v_ends is not null and v_ends < current_date then
    raise exception 'recorrencia encerrada';
  end if;

  v_next := public.first_recurring_occurrence_date(
    current_date, v_freq, v_day, v_weekday, v_month
  );

  if v_ends is not null and v_next > v_ends then
    raise exception 'recorrencia encerrada';
  end if;

  update public.recurring_transactions
     set active = true,
         next_run = v_next,
         user_id = v_user_id
   where id = p_id;

  insert into public.audit_log(user_id, space_id, table_name, record_id, action, details)
  values (
    v_user_id, v_space_id, 'recurring_transactions', p_id, 'resume',
    jsonb_build_object('actor_id', v_user_id, 'next_run', v_next)
  );

  perform public.generate_due_recurring_transactions(current_date);
  return v_next;
end;
$$;

create or replace function public.end_recurring_transaction(p_id uuid, p_ends_at date default current_date)
returns date
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_space_id uuid;
  v_starts date;
  v_end date := coalesce(p_ends_at, current_date);
begin
  if v_user_id is null then raise exception 'sessao invalida'; end if;

  select space_id, starts_at into v_space_id, v_starts
  from public.recurring_transactions
  where id = p_id and is_demo = false
  for update;

  if v_space_id is null then raise exception 'recorrencia invalida'; end if;
  if not public.can_write_finance_space(v_space_id, v_user_id) then
    raise exception 'sem permissao de escrita no espaco financeiro';
  end if;

  if v_starts is not null and v_end < v_starts then
    v_end := v_starts;
  end if;

  update public.recurring_transactions
     set active = false,
         ends_at = v_end,
         user_id = v_user_id
   where id = p_id;

  insert into public.audit_log(user_id, space_id, table_name, record_id, action, details)
  values (
    v_user_id, v_space_id, 'recurring_transactions', p_id, 'end',
    jsonb_build_object('actor_id', v_user_id, 'ends_at', v_end)
  );

  return v_end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.clamp_month_day(integer, integer, integer) from public, anon;
grant execute on function public.clamp_month_day(integer, integer, integer) to authenticated;

revoke all on function public.first_recurring_occurrence_date(date, text, integer, integer, integer) from public, anon;
grant execute on function public.first_recurring_occurrence_date(date, text, integer, integer, integer) to authenticated;

revoke all on function public.next_recurring_occurrence_date(date, text, integer, integer, integer) from public, anon;
grant execute on function public.next_recurring_occurrence_date(date, text, integer, integer, integer) to authenticated;

revoke all on function public.validate_recurring_transaction() from public, anon;
grant execute on function public.validate_recurring_transaction() to authenticated;

revoke all on function public.require_active_category_on_change() from public, anon;
grant execute on function public.require_active_category_on_change() to authenticated;

revoke all on function public.generate_due_recurring_transactions(date) from public, anon;
grant execute on function public.generate_due_recurring_transactions(date) to authenticated;

revoke all on function public.create_recurring_transaction(uuid, uuid, uuid, text, text, numeric, text, date, integer, integer, integer, date, text, text) from public, anon;
grant execute on function public.create_recurring_transaction(uuid, uuid, uuid, text, text, numeric, text, date, integer, integer, integer, date, text, text) to authenticated;

revoke all on function public.update_recurring_transaction(uuid, uuid, uuid, text, text, numeric, text, date, integer, integer, integer, date, text, text) from public, anon;
grant execute on function public.update_recurring_transaction(uuid, uuid, uuid, text, text, numeric, text, date, integer, integer, integer, date, text, text) to authenticated;

revoke all on function public.pause_recurring_transaction(uuid) from public, anon;
grant execute on function public.pause_recurring_transaction(uuid) to authenticated;

revoke all on function public.resume_recurring_transaction(uuid) from public, anon;
grant execute on function public.resume_recurring_transaction(uuid) to authenticated;

revoke all on function public.end_recurring_transaction(uuid, date) from public, anon;
grant execute on function public.end_recurring_transaction(uuid, date) to authenticated;
