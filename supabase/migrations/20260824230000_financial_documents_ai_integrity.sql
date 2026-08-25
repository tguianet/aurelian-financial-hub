-- Documentos + IA: hash, lock, interpretacao persistida, confirmacao atomica.
-- Nao apaga dados reais. Nao reescreve historico.

-- ---------------------------------------------------------------------------
-- Colunas e estados
-- ---------------------------------------------------------------------------

alter table public.financial_documents
  add column if not exists content_hash text,
  add column if not exists interpretation_version integer not null default 0,
  add column if not exists interpreted_at timestamptz,
  add column if not exists interpretation_model text,
  add column if not exists interpretation_json jsonb,
  add column if not exists interpretation_error text,
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_by uuid,
  add column if not exists confirm_idempotency_key text,
  add column if not exists credit_card_purchase_id uuid references public.credit_card_purchases(id) on delete set null,
  add column if not exists possible_recurring boolean not null default false;

update public.financial_documents
   set status = 'interpreted'
 where status = 'processed';

update public.financial_documents
   set status = 'uploaded'
 where status = 'inbox';

alter table public.financial_documents
  drop constraint if exists financial_documents_status_check;

alter table public.financial_documents
  add constraint financial_documents_status_check
  check (status in (
    'uploaded','processing','interpreted','confirmed','linked','failed','archived'
  ));

create unique index if not exists financial_documents_space_hash_uidx
  on public.financial_documents (space_id, content_hash)
  where content_hash is not null and space_id is not null;

create index if not exists financial_documents_space_status_idx
  on public.financial_documents (space_id, status, created_at desc);

comment on column public.financial_documents.content_hash is
  'SHA-256 hex do arquivo. Unique por space evita duplicar o mesmo PDF.';
comment on column public.financial_documents.interpretation_json is
  'Sugestao sanitizada da IA. Sem URL, token ou conteudo bruto.';

-- ---------------------------------------------------------------------------
-- Register + duplicidade por hash
-- ---------------------------------------------------------------------------

drop function if exists public.register_financial_document(text, text, text, bigint, text);

create or replace function public.register_financial_document(
  p_storage_path text,
  p_file_name text,
  p_mime_type text default null,
  p_size_bytes bigint default null,
  p_source text default 'upload',
  p_content_hash text default null
)
returns table(document_id uuid, is_duplicate boolean, status text, storage_path text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_id uuid;
  v_status text;
  v_path text;
  v_hash text := nullif(lower(btrim(coalesce(p_content_hash, ''))), '');
begin
  if v_user is null then raise exception 'sessao invalida'; end if;
  v_space := public.current_finance_space_id();
  perform public.assert_writable_finance_space(v_space);
  if btrim(coalesce(p_storage_path, '')) = '' then raise exception 'arquivo obrigatorio'; end if;

  if v_hash is not null then
    select d.id, d.status, d.storage_path into v_id, v_status, v_path
    from public.financial_documents d
    where d.space_id = v_space and d.content_hash = v_hash
    limit 1;
    if v_id is not null then
      perform public.write_finance_audit(v_space, 'financial_documents', v_id, 'update',
        jsonb_build_object('reason', 'duplicate_hash', 'file_name', p_file_name));
      document_id := v_id;
      is_duplicate := true;
      status := v_status;
      storage_path := v_path;
      return next;
      return;
    end if;
  end if;

  begin
    insert into public.financial_documents(
      user_id, space_id, file_name, storage_path, mime_type, size_bytes, source, status, content_hash
    ) values (
      v_user, v_space, coalesce(nullif(btrim(p_file_name), ''), 'documento'),
      p_storage_path, p_mime_type, p_size_bytes,
      case when p_source in ('camera','upload') then p_source else 'upload' end,
      'uploaded', v_hash
    )
    on conflict (storage_path) do update
      set file_name = excluded.file_name,
          mime_type = coalesce(excluded.mime_type, public.financial_documents.mime_type),
          size_bytes = coalesce(excluded.size_bytes, public.financial_documents.size_bytes),
          content_hash = coalesce(public.financial_documents.content_hash, excluded.content_hash),
          status = case
            when public.financial_documents.status = 'failed' then 'uploaded'
            else public.financial_documents.status
          end,
          updated_at = now()
    returning id, public.financial_documents.status into v_id, v_status;
  exception when unique_violation then
    select d.id, d.status, d.storage_path into v_id, v_status, v_path
    from public.financial_documents d
    where d.space_id = v_space and (d.content_hash = v_hash or d.storage_path = p_storage_path)
    limit 1;
    document_id := v_id;
    is_duplicate := true;
    status := v_status;
    storage_path := v_path;
    return next;
    return;
  end;

  perform public.write_finance_audit(v_space, 'financial_documents', v_id, 'insert',
    jsonb_build_object('file_name', p_file_name, 'status', 'uploaded', 'has_hash', v_hash is not null));
  document_id := v_id;
  is_duplicate := false;
  status := v_status;
  storage_path := p_storage_path;
  return next;
end;
$$;

create or replace function public.find_financial_document_by_hash(p_content_hash text)
returns table(document_id uuid, storage_path text, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_space uuid;
begin
  if auth.uid() is null then raise exception 'sessao invalida'; end if;
  v_space := public.current_finance_space_id();
  if v_space is null then raise exception 'espaco financeiro nao encontrado'; end if;
  if not public.is_finance_space_member(v_space) then raise exception 'sem permissao'; end if;

  return query
  select d.id, d.storage_path, d.status
  from public.financial_documents d
  where d.space_id = v_space
    and d.content_hash = nullif(lower(btrim(coalesce(p_content_hash, ''))), '')
  limit 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lock de processamento + timeout 10 min
-- ---------------------------------------------------------------------------

create or replace function public.claim_financial_document_processing(
  p_id uuid,
  p_force boolean default false
)
returns table(
  claimed boolean,
  already_interpreted boolean,
  status text,
  interpretation_json jsonb,
  interpretation_version integer,
  storage_path text,
  mime_type text,
  size_bytes bigint,
  file_name text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  r public.financial_documents%rowtype;
  v_stale boolean;
  v_claimed boolean := false;
begin
  if v_user is null then raise exception 'sessao invalida'; end if;

  select * into r from public.financial_documents where id = p_id for update;
  if r.id is null then raise exception 'documento invalido'; end if;
  v_space := r.space_id;
  perform public.assert_writable_finance_space(v_space);

  if r.status in ('linked','confirmed','archived') then
    raise exception 'documento ja vinculado ou arquivado';
  end if;

  v_stale := r.status = 'processing'
    and r.processing_started_at is not null
    and r.processing_started_at < now() - interval '10 minutes';

  if r.status = 'interpreted' and r.interpretation_json is not null and not coalesce(p_force, false) then
    claimed := false;
    already_interpreted := true;
    status := r.status;
    interpretation_json := r.interpretation_json;
    interpretation_version := r.interpretation_version;
    storage_path := r.storage_path;
    mime_type := r.mime_type;
    size_bytes := r.size_bytes;
    file_name := r.file_name;
    return next;
    return;
  end if;

  if r.status = 'processing' and not v_stale then
    claimed := false;
    already_interpreted := false;
    status := r.status;
    interpretation_json := r.interpretation_json;
    interpretation_version := r.interpretation_version;
    storage_path := r.storage_path;
    mime_type := r.mime_type;
    size_bytes := r.size_bytes;
    file_name := r.file_name;
    return next;
    return;
  end if;

  update public.financial_documents
     set status = 'processing',
         processing_started_at = now(),
         processing_by = v_user,
         interpretation_error = null,
         updated_at = now()
   where id = p_id;
  v_claimed := true;

  perform public.write_finance_audit(v_space, 'financial_documents', p_id, 'update',
    jsonb_build_object('status', 'processing', 'force', coalesce(p_force, false)));

  claimed := v_claimed;
  already_interpreted := false;
  status := 'processing';
  interpretation_json := r.interpretation_json;
  interpretation_version := r.interpretation_version;
  storage_path := r.storage_path;
  mime_type := r.mime_type;
  size_bytes := r.size_bytes;
  file_name := r.file_name;
  return next;
end;
$$;

create or replace function public.save_financial_document_interpretation(
  p_id uuid,
  p_json jsonb,
  p_model text,
  p_possible_recurring boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_status text;
  v_by uuid;
begin
  if v_user is null then raise exception 'sessao invalida'; end if;
  select space_id, status, processing_by into v_space, v_status, v_by
  from public.financial_documents where id = p_id for update;
  if v_space is null then raise exception 'documento invalido'; end if;
  perform public.assert_writable_finance_space(v_space);
  if v_status is distinct from 'processing' or v_by is distinct from v_user then
    raise exception 'documento nao esta em processamento por este usuario';
  end if;
  if p_json is null or jsonb_typeof(p_json) is distinct from 'object' then
    raise exception 'interpretacao invalida';
  end if;

  update public.financial_documents
     set status = 'interpreted',
         interpretation_json = p_json,
         interpretation_model = left(coalesce(p_model, ''), 80),
         interpretation_version = interpretation_version + 1,
         interpreted_at = now(),
         interpretation_error = null,
         possible_recurring = coalesce(p_possible_recurring, false),
         processing_started_at = null,
         updated_at = now()
   where id = p_id;

  perform public.write_finance_audit(v_space, 'financial_documents', p_id, 'update',
    jsonb_build_object('status', 'interpreted', 'model', left(coalesce(p_model, ''), 80)));
  return p_id;
end;
$$;

create or replace function public.fail_financial_document_interpretation(p_id uuid, p_error text)
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
  select space_id into v_space from public.financial_documents where id = p_id for update;
  if v_space is null then raise exception 'documento invalido'; end if;
  perform public.assert_writable_finance_space(v_space);

  update public.financial_documents
     set status = 'failed',
         interpretation_error = left(coalesce(p_error, 'falha na interpretacao'), 300),
         processing_started_at = null,
         updated_at = now()
   where id = p_id;

  perform public.write_finance_audit(v_space, 'financial_documents', p_id, 'update',
    jsonb_build_object('status', 'failed'));
  return p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Confirmacao atomica: transaction ou compra no cartao + link
-- ---------------------------------------------------------------------------

create or replace function public.confirm_financial_document_transaction(
  p_id uuid,
  p_entity_id uuid,
  p_kind text,
  p_description text,
  p_amount numeric,
  p_account_id uuid default null,
  p_category_id uuid default null,
  p_payment_method text default 'pix',
  p_competence_date date default current_date,
  p_due_date date default current_date,
  p_status text default 'pending',
  p_notes text default null,
  p_credit_card_id uuid default null,
  p_installments integer default 1
)
returns table(transaction_id uuid, credit_card_purchase_id uuid, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  r public.financial_documents%rowtype;
  v_key text;
  v_tx uuid;
  v_purchase uuid;
  v_method text;
begin
  if v_user is null then raise exception 'sessao invalida'; end if;
  select * into r from public.financial_documents where id = p_id for update;
  if r.id is null then raise exception 'documento invalido'; end if;
  perform public.assert_writable_finance_space(r.space_id);

  if r.status = 'archived' then raise exception 'documento arquivado'; end if;

  if r.status in ('linked','confirmed') and (r.transaction_id is not null or r.credit_card_purchase_id is not null) then
    transaction_id := r.transaction_id;
    credit_card_purchase_id := r.credit_card_purchase_id;
    status := r.status;
    return next;
    return;
  end if;

  if r.status is distinct from 'interpreted' then
    raise exception 'confirme apenas apos revisar a interpretacao';
  end if;

  v_method := coalesce(nullif(p_payment_method, ''), 'pix');
  v_key := coalesce(r.confirm_idempotency_key,
    'financial-document:' || r.id::text || ':confirm:v' || greatest(r.interpretation_version, 1)::text);

  if v_method = 'credit' then
    if p_kind is distinct from 'expense' then raise exception 'compra no cartao deve ser saida'; end if;
    if p_credit_card_id is null then raise exception 'selecione o cartao'; end if;
    if not exists (
      select 1 from public.credit_cards c
      join public.financial_entities e on e.id = c.entity_id
      where c.id = p_credit_card_id
        and e.space_id = r.space_id
        and c.entity_id = p_entity_id
        and c.active
    ) then
      raise exception 'cartao invalido para esta entidade';
    end if;
    v_purchase := public.create_credit_card_purchase(
      p_credit_card_id, p_category_id, p_description, p_amount, coalesce(p_competence_date, current_date),
      coalesce(nullif(p_installments, 0), 1)
    );
  else
    if p_account_id is null then raise exception 'selecione a conta'; end if;
    v_tx := public.create_transaction(
      p_entity_id, p_account_id, p_kind, p_description, p_amount,
      p_category_id, null, v_method, p_competence_date, p_due_date, p_status, p_notes,
      1, 'total', false, 'document_confirm', v_key
    );
  end if;

  update public.financial_documents
     set status = 'linked',
         transaction_id = v_tx,
         credit_card_purchase_id = v_purchase,
         confirm_idempotency_key = v_key,
         entity_id = p_entity_id,
         processing_started_at = null,
         updated_at = now()
   where id = p_id;

  perform public.write_finance_audit(r.space_id, 'financial_documents', p_id, 'update',
    jsonb_build_object(
      'status', 'linked',
      'transaction_id', v_tx,
      'credit_card_purchase_id', v_purchase,
      'kind', p_kind
    ));

  transaction_id := v_tx;
  credit_card_purchase_id := v_purchase;
  status := 'linked';
  return next;
end;
$$;

create or replace function public.archive_financial_document(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_status text;
  v_tx uuid;
begin
  if v_user is null then raise exception 'sessao invalida'; end if;
  select space_id, status, transaction_id into v_space, v_status, v_tx
  from public.financial_documents where id = p_id for update;
  if v_space is null then raise exception 'documento invalido'; end if;
  perform public.assert_writable_finance_space(v_space);

  if v_status = 'linked' or v_tx is not null then
    update public.financial_documents
       set status = 'archived', updated_at = now()
     where id = p_id;
    perform public.write_finance_audit(v_space, 'financial_documents', p_id, 'update',
      jsonb_build_object('status', 'archived', 'kept_transaction', true));
    return p_id;
  end if;

  update public.financial_documents
     set status = 'archived', updated_at = now()
   where id = p_id;
  perform public.write_finance_audit(v_space, 'financial_documents', p_id, 'update',
    jsonb_build_object('status', 'archived'));
  return p_id;
end;
$$;

create or replace function public.set_financial_document_status(p_id uuid, p_status text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status = 'archived' then
    return public.archive_financial_document(p_id);
  end if;
  raise exception 'use as RPCs de documento para alterar status';
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
  v_space uuid;
begin
  select document_id into v_id
  from public.register_financial_document(p_storage_path, p_file_name, null, null, 'upload', null)
  limit 1;
  if v_id is null then raise exception 'documento invalido'; end if;
  select space_id into v_space from public.financial_documents where id = v_id for update;
  perform public.assert_writable_finance_space(v_space);
  update public.financial_documents
     set status = 'failed',
         interpretation_error = 'catalogacao ou leitura falhou',
         processing_started_at = null,
         updated_at = now()
   where id = v_id
     and status not in ('linked','archived');
  perform public.write_finance_audit(v_space, 'financial_documents', v_id, 'update',
    jsonb_build_object('status', 'failed'));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reconciliacao (diagnostico, sem apagar)
-- ---------------------------------------------------------------------------

create or replace function public.reconcile_financial_documents()
returns table(issue text, document_id uuid, storage_path text, detail text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_space uuid;
begin
  if auth.uid() is null then raise exception 'sessao invalida'; end if;
  v_space := public.current_finance_space_id();
  perform public.assert_writable_finance_space(v_space);

  return query
  select 'processing_stale'::text, d.id, d.storage_path,
         'processing ha mais de 10 minutos'::text
  from public.financial_documents d
  where d.space_id = v_space
    and d.status = 'processing'
    and d.processing_started_at < now() - interval '10 minutes';

  return query
  select 'linked_without_target'::text, d.id, d.storage_path,
         'linked sem transaction nem compra'::text
  from public.financial_documents d
  where d.space_id = v_space
    and d.status = 'linked'
    and d.transaction_id is null
    and d.credit_card_purchase_id is null;

  return query
  select 'transaction_missing'::text, d.id, d.storage_path,
         'transaction_id nao existe'::text
  from public.financial_documents d
  where d.space_id = v_space
    and d.transaction_id is not null
    and not exists (select 1 from public.transactions t where t.id = d.transaction_id);

  return query
  select 'storage_orphan'::text, null::uuid, o.name,
         'arquivo no storage sem metadata'::text
  from storage.objects o
  where o.bucket_id = 'financial-documents'
    and split_part(o.name, '/', 1) in (
      select m.user_id::text from public.finance_space_members m
      where m.space_id = v_space and m.revoked_at is null
    )
    and not exists (
      select 1 from public.financial_documents d
      where d.space_id = v_space and d.storage_path = o.name
    );

  return query
  select 'metadata_without_file'::text, d.id, d.storage_path,
         'metadata sem objeto no storage'::text
  from public.financial_documents d
  where d.space_id = v_space
    and d.status not in ('archived')
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'financial-documents' and o.name = d.storage_path
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage: viewer le, so editor/owner escreve
-- ---------------------------------------------------------------------------

drop policy if exists financial_documents_storage_insert on storage.objects;
create policy financial_documents_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'financial-documents'
  and split_part(name, '/', 1) = auth.uid()::text
  and public.can_write_finance_space(public.current_finance_space_id())
);

drop policy if exists financial_documents_storage_update on storage.objects;
create policy financial_documents_storage_update on storage.objects
for update to authenticated
using (bucket_id = 'financial-documents' and public.can_manage_finance_document_path(name))
with check (bucket_id = 'financial-documents' and public.can_manage_finance_document_path(name));

drop policy if exists financial_documents_storage_delete on storage.objects;
create policy financial_documents_storage_delete on storage.objects
for delete to authenticated
using (bucket_id = 'financial-documents' and public.can_manage_finance_document_path(name));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.register_financial_document(text, text, text, bigint, text, text) from public, anon;
grant execute on function public.register_financial_document(text, text, text, bigint, text, text) to authenticated;
revoke all on function public.find_financial_document_by_hash(text) from public, anon;
grant execute on function public.find_financial_document_by_hash(text) to authenticated;
revoke all on function public.claim_financial_document_processing(uuid, boolean) from public, anon;
grant execute on function public.claim_financial_document_processing(uuid, boolean) to authenticated;
revoke all on function public.save_financial_document_interpretation(uuid, jsonb, text, boolean) from public, anon;
grant execute on function public.save_financial_document_interpretation(uuid, jsonb, text, boolean) to authenticated;
revoke all on function public.fail_financial_document_interpretation(uuid, text) from public, anon;
grant execute on function public.fail_financial_document_interpretation(uuid, text) to authenticated;
revoke all on function public.confirm_financial_document_transaction(uuid, uuid, text, text, numeric, uuid, uuid, text, date, date, text, text, uuid, integer) from public, anon;
grant execute on function public.confirm_financial_document_transaction(uuid, uuid, text, text, numeric, uuid, uuid, text, date, date, text, text, uuid, integer) to authenticated;
revoke all on function public.archive_financial_document(uuid) from public, anon;
grant execute on function public.archive_financial_document(uuid) to authenticated;
revoke all on function public.reconcile_financial_documents() from public, anon;
grant execute on function public.reconcile_financial_documents() to authenticated;
revoke all on function public.set_financial_document_status(uuid, text) from public, anon;
grant execute on function public.set_financial_document_status(uuid, text) to authenticated;
revoke all on function public.mark_financial_document_failed(text, text) from public, anon;
grant execute on function public.mark_financial_document_failed(text, text) to authenticated;
