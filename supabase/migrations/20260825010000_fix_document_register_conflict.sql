-- Fix PL/pgSQL ambiguity in register_financial_document.
-- The function returns an output column named storage_path, so ON CONFLICT(storage_path)
-- can be ambiguous. Target the named unique constraint explicitly.

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
    on conflict on constraint financial_documents_storage_path_key do update
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
    where d.space_id = v_space
      and (d.content_hash = v_hash or d.storage_path = p_storage_path)
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

revoke all on function public.register_financial_document(text, text, text, bigint, text, text) from public, anon;
grant execute on function public.register_financial_document(text, text, text, bigint, text, text) to authenticated;
