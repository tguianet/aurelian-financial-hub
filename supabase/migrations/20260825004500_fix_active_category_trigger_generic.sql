-- Fix generic category-active trigger on tables without a source column.
-- Keeps migrations immutable and fixes credit-card/budget/recurrence inserts.

create or replace function public.require_active_category_on_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb := to_jsonb(new);
begin
  if coalesce((v_row->>'is_demo')::boolean, false) then
    return new;
  end if;

  if new.category_id is null then
    return new;
  end if;

  if tg_op = 'update' and new.category_id is not distinct from old.category_id then
    return new;
  end if;

  if tg_table_name = 'transactions'
     and coalesce(v_row->>'source', '') = 'recurring' then
    return new;
  end if;

  if exists (
    select 1
    from public.categories c
    where c.id = new.category_id
      and c.is_demo = false
      and c.active = false
  ) then
    raise exception 'categoria inativa';
  end if;

  return new;
end;
$$;

revoke all on function public.require_active_category_on_change() from public, anon;
grant execute on function public.require_active_category_on_change() to authenticated;
