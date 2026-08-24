create table if not exists public.financial_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_id uuid null references public.financial_entities(id) on delete set null,
  transaction_id uuid null references public.transactions(id) on delete set null,
  file_name text not null,
  storage_path text not null unique,
  mime_type text null,
  size_bytes bigint null check (size_bytes is null or size_bytes >= 0),
  source text not null default 'upload' check (source in ('camera','upload')),
  status text not null default 'inbox' check (status in ('inbox','linked','archived')),
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists financial_documents_user_created_idx
  on public.financial_documents(user_id, created_at desc);
create index if not exists financial_documents_transaction_idx
  on public.financial_documents(transaction_id)
  where transaction_id is not null;

alter table public.financial_documents enable row level security;

drop policy if exists "financial_documents_select_own" on public.financial_documents;
create policy "financial_documents_select_own"
on public.financial_documents for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "financial_documents_insert_own" on public.financial_documents;
create policy "financial_documents_insert_own"
on public.financial_documents for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "financial_documents_update_own" on public.financial_documents;
create policy "financial_documents_update_own"
on public.financial_documents for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "financial_documents_delete_own" on public.financial_documents;
create policy "financial_documents_delete_own"
on public.financial_documents for delete
to authenticated
using (user_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'financial-documents',
  'financial-documents',
  false,
  20971520,
  array[
    'image/jpeg','image/png','image/webp','image/heic','image/heif',
    'application/pdf',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "financial_documents_storage_select" on storage.objects;
create policy "financial_documents_storage_select"
on storage.objects for select
to authenticated
using (
  bucket_id = 'financial-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "financial_documents_storage_insert" on storage.objects;
create policy "financial_documents_storage_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'financial-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "financial_documents_storage_update" on storage.objects;
create policy "financial_documents_storage_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'financial-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'financial-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "financial_documents_storage_delete" on storage.objects;
create policy "financial_documents_storage_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'financial-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);
