create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_space uuid;
begin
  insert into public.profiles(id,email,full_name)
  values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',new.email))
  on conflict(id) do nothing;

  if coalesce(new.is_anonymous, false) then
    return new;
  end if;

  v_space:=public.ensure_finance_space_for_user(new.id);
  perform public.ensure_finance_default_categories(v_space);
  perform public.ensure_finance_workspace(new.id);
  return new;
end; $$;