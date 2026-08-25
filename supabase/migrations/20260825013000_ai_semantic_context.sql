-- Contexto semantico para IA: description + ai_keywords em categorias e entidades.
-- Backfill so preenche campos vazios. Nao apaga dados financeiros.

alter table public.categories
  add column if not exists description text,
  add column if not exists ai_keywords text[];

alter table public.financial_entities
  add column if not exists description text,
  add column if not exists ai_keywords text[];

alter table public.categories
  drop constraint if exists categories_description_len;
alter table public.categories
  add constraint categories_description_len
  check (description is null or char_length(description) <= 240);

alter table public.financial_entities
  drop constraint if exists financial_entities_description_len;
alter table public.financial_entities
  add constraint financial_entities_description_len
  check (description is null or char_length(description) <= 240);

comment on column public.categories.description is
  'Explicacao curta de quando usar a categoria. Usada pela IA e pelo parser local.';
comment on column public.categories.ai_keywords is
  'Palavras e exemplos que ajudam a classificar lancamentos. Nao e fonte de UUID.';
comment on column public.financial_entities.description is
  'Explicacao curta da entidade para interpretacao por IA.';
comment on column public.financial_entities.ai_keywords is
  'Palavras e exemplos da entidade. Nao e fonte de UUID.';

create or replace function public.sanitize_ai_keywords(p_keywords text[])
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(array(
    select left(btrim(k), 40)
    from unnest(coalesce(p_keywords, array[]::text[])) with ordinality as t(k, n)
    where length(btrim(k)) >= 2
    limit 16
  ), array[]::text[]);
$$;

-- Backfill independente: description vazia e keywords vazias, sem sobrescrever customizacao.
with seed(name, kind, description, keywords) as (
  values
    ('Vendas', 'income', 'Receitas provenientes da venda de produtos.', array['venda','cliente','pedido','produto','mercadoria','faturamento']::text[]),
    ('Serviços', 'income', 'Receitas pela prestação de serviços.', array['serviço','prestação','projeto','mensalidade','consultoria']::text[]),
    ('Comissões', 'income', 'Receitas de comissão por vendas, indicações ou intermediação.', array['comissão','indicação','percentual','intermediação']::text[]),
    ('Salário / Pró-labore', 'income', 'Remuneração pessoal, salário ou pró-labore.', array['salário','pro labore','pró-labore','retirada','remuneração']::text[]),
    ('Rendimentos', 'income', 'Rendimentos de aplicações, juros ou ganhos financeiros.', array['rendimento','juros','investimento','aplicação']::text[]),
    ('Reembolsos', 'income', 'Valores recebidos como devolução de gastos.', array['reembolso','devolução','ressarcimento']::text[]),
    ('Outras receitas', 'income', 'Receitas que não se encaixam nas demais categorias.', array['outra receita','entrada diversa','receita diversa']::text[]),
    ('Alimentação', 'expense', 'Gastos com refeições, comida e alimentação.', array['almoço','jantar','lanche','comida','restaurante','mercado']::text[]),
    ('Combustível', 'expense', 'Gastos com abastecimento de veículos.', array['gasolina','etanol','álcool','diesel','posto','combustível','abastecimento','abastecer']::text[]),
    ('Fornecedores', 'expense', 'Pagamentos a fornecedores e compra de mercadorias ou insumos.', array['fornecedor','mercadoria','matéria-prima','insumo','compra para estoque']::text[]),
    ('Funcionários', 'expense', 'Custos relacionados a funcionários e equipe.', array['salário','funcionário','folha','diária','vale','benefício','equipe']::text[]),
    ('Energia elétrica', 'expense', 'Contas e despesas com energia elétrica.', array['energia','conta de luz','cpfl','eletricidade']::text[]),
    ('Água', 'expense', 'Contas e despesas relacionadas ao consumo de água.', array['água','conta de água','saneamento']::text[]),
    ('Internet e telefone', 'expense', 'Internet, telefone fixo, celular e telecomunicações.', array['internet','telefone','celular','claro','vivo','tim','oi']::text[]),
    ('Software e assinaturas', 'expense', 'Softwares, plataformas e assinaturas digitais.', array['software','assinatura','mensalidade','saas','app','sistema','licença']::text[]),
    ('Impostos', 'expense', 'Tributos, impostos, taxas e obrigações fiscais.', array['imposto','das','mei','simples','iss','icms','taxa','tributo']::text[]),
    ('Veículo', 'expense', 'Gastos gerais relacionados a veículos que não sejam combustível ou manutenção.', array['veículo','carro','moto','documento','licenciamento','seguro','ipva']::text[]),
    ('Manutenção', 'expense', 'Consertos, revisões e manutenção de veículos, equipamentos ou estrutura.', array['manutenção','oficina','revisão','conserto','peça','pneu','óleo','reparo']::text[]),
    ('Saúde', 'expense', 'Gastos médicos, medicamentos, consultas e saúde.', array['médico','consulta','remédio','medicamento','farmácia','exame','saúde']::text[]),
    ('Moradia', 'expense', 'Despesas relacionadas à residência.', array['aluguel','condomínio','casa','residência','moradia']::text[]),
    ('Transporte', 'expense', 'Gastos de deslocamento que não sejam abastecimento próprio.', array['uber','taxi','táxi','ônibus','passagem','pedágio','estacionamento','frete']::text[]),
    ('Marketing / Publicidade', 'expense', 'Gastos para divulgação, anúncios e aquisição de clientes.', array['marketing','publicidade','anúncio','tráfego','meta ads','facebook ads','google ads','campanha']::text[]),
    ('Lazer', 'expense', 'Gastos pessoais com lazer, passeio e entretenimento.', array['lazer','passeio','cinema','viagem','diversão','entretenimento']::text[]),
    ('Educação', 'expense', 'Gastos com cursos, escola, faculdade e capacitação.', array['curso','escola','faculdade','mensalidade escolar','treinamento','educação']::text[]),
    ('Tarifas bancárias', 'expense', 'Taxas, tarifas e custos cobrados por bancos e meios de pagamento.', array['tarifa','taxa bancária','juros bancários','banco','maquininha']::text[]),
    ('Outras despesas', 'expense', 'Despesas que não se encaixam nas demais categorias.', array['outra despesa','despesa diversa','gasto diverso']::text[])
)
update public.categories c
   set description = case
         when c.description is null or btrim(c.description) = '' then s.description
         else c.description
       end,
       ai_keywords = case
         when c.ai_keywords is null or cardinality(c.ai_keywords) = 0 then s.keywords
         else c.ai_keywords
       end
  from seed s
 where c.is_demo = false
   and c.kind = s.kind
   and public.normalize_category_name(c.name) = public.normalize_category_name(s.name);

create or replace function public.ensure_finance_default_categories(p_space_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_creator uuid;
  v_inserted integer := 0;
  r record;
begin
  if p_space_id is null then raise exception 'space_id obrigatorio'; end if;
  if not exists (select 1 from public.finance_spaces s where s.id = p_space_id) then
    raise exception 'espaco financeiro nao encontrado';
  end if;
  if auth.uid() is not null
     and not public.can_write_finance_space(p_space_id, auth.uid())
     and not exists (select 1 from public.finance_spaces s where s.id = p_space_id and s.owner_user_id = auth.uid()) then
    raise exception 'sem permissao de escrita no espaco financeiro';
  end if;

  select s.owner_user_id into v_creator from public.finance_spaces s where s.id = p_space_id;
  v_creator := coalesce(auth.uid(), v_creator);
  if v_creator is null then raise exception 'criador da categoria obrigatorio'; end if;

  for r in
    select * from (values
      ('Vendas', 'income', '#22C55E', 'Receitas provenientes da venda de produtos.', array['venda','cliente','pedido','produto','mercadoria','faturamento']::text[]),
      ('Serviços', 'income', '#38BDF8', 'Receitas pela prestação de serviços.', array['serviço','prestação','projeto','mensalidade','consultoria']::text[]),
      ('Comissões', 'income', '#E8B923', 'Receitas de comissão por vendas, indicações ou intermediação.', array['comissão','indicação','percentual','intermediação']::text[]),
      ('Salário / Pró-labore', 'income', '#A78BFA', 'Remuneração pessoal, salário ou pró-labore.', array['salário','pro labore','pró-labore','retirada','remuneração']::text[]),
      ('Rendimentos', 'income', '#14B8A6', 'Rendimentos de aplicações, juros ou ganhos financeiros.', array['rendimento','juros','investimento','aplicação']::text[]),
      ('Reembolsos', 'income', '#818CF8', 'Valores recebidos como devolução de gastos.', array['reembolso','devolução','ressarcimento']::text[]),
      ('Outras receitas', 'income', '#94A3B8', 'Receitas que não se encaixam nas demais categorias.', array['outra receita','entrada diversa','receita diversa']::text[]),
      ('Alimentação', 'expense', '#F59E0B', 'Gastos com refeições, comida e alimentação.', array['almoço','jantar','lanche','comida','restaurante','mercado']::text[]),
      ('Combustível', 'expense', '#F97316', 'Gastos com abastecimento de veículos.', array['gasolina','etanol','álcool','diesel','posto','combustível','abastecimento','abastecer']::text[]),
      ('Fornecedores', 'expense', '#FB7185', 'Pagamentos a fornecedores e compra de mercadorias ou insumos.', array['fornecedor','mercadoria','matéria-prima','insumo','compra para estoque']::text[]),
      ('Funcionários', 'expense', '#F43F5E', 'Custos relacionados a funcionários e equipe.', array['salário','funcionário','folha','diária','vale','benefício','equipe']::text[]),
      ('Energia elétrica', 'expense', '#EAB308', 'Contas e despesas com energia elétrica.', array['energia','conta de luz','cpfl','eletricidade']::text[]),
      ('Água', 'expense', '#06B6D4', 'Contas e despesas relacionadas ao consumo de água.', array['água','conta de água','saneamento']::text[]),
      ('Internet e telefone', 'expense', '#38BDF8', 'Internet, telefone fixo, celular e telecomunicações.', array['internet','telefone','celular','claro','vivo','tim','oi']::text[]),
      ('Software e assinaturas', 'expense', '#A78BFA', 'Softwares, plataformas e assinaturas digitais.', array['software','assinatura','mensalidade','saas','app','sistema','licença']::text[]),
      ('Impostos', 'expense', '#EF4444', 'Tributos, impostos, taxas e obrigações fiscais.', array['imposto','das','mei','simples','iss','icms','taxa','tributo']::text[]),
      ('Veículo', 'expense', '#64748B', 'Gastos gerais relacionados a veículos que não sejam combustível ou manutenção.', array['veículo','carro','moto','documento','licenciamento','seguro','ipva']::text[]),
      ('Manutenção', 'expense', '#78716C', 'Consertos, revisões e manutenção de veículos, equipamentos ou estrutura.', array['manutenção','oficina','revisão','conserto','peça','pneu','óleo','reparo']::text[]),
      ('Saúde', 'expense', '#10B981', 'Gastos médicos, medicamentos, consultas e saúde.', array['médico','consulta','remédio','medicamento','farmácia','exame','saúde']::text[]),
      ('Moradia', 'expense', '#64748B', 'Despesas relacionadas à residência.', array['aluguel','condomínio','casa','residência','moradia']::text[]),
      ('Transporte', 'expense', '#0EA5E9', 'Gastos de deslocamento que não sejam abastecimento próprio.', array['uber','taxi','táxi','ônibus','passagem','pedágio','estacionamento','frete']::text[]),
      ('Marketing / Publicidade', 'expense', '#D946EF', 'Gastos para divulgação, anúncios e aquisição de clientes.', array['marketing','publicidade','anúncio','tráfego','meta ads','facebook ads','google ads','campanha']::text[]),
      ('Lazer', 'expense', '#EC4899', 'Gastos pessoais com lazer, passeio e entretenimento.', array['lazer','passeio','cinema','viagem','diversão','entretenimento']::text[]),
      ('Educação', 'expense', '#6366F1', 'Gastos com cursos, escola, faculdade e capacitação.', array['curso','escola','faculdade','mensalidade escolar','treinamento','educação']::text[]),
      ('Tarifas bancárias', 'expense', '#8B5CF6', 'Taxas, tarifas e custos cobrados por bancos e meios de pagamento.', array['tarifa','taxa bancária','juros bancários','banco','maquininha']::text[]),
      ('Outras despesas', 'expense', '#8A8A8A', 'Despesas que não se encaixam nas demais categorias.', array['outra despesa','despesa diversa','gasto diverso']::text[])
    ) as seed(name, kind, color, description, keywords)
  loop
    if exists (
      select 1 from public.categories c
      where c.space_id = p_space_id and c.is_demo = false and c.kind = r.kind
        and public.normalize_category_name(c.name) = public.normalize_category_name(r.name)
    ) then
      update public.categories c
         set description = case when c.description is null or btrim(c.description) = '' then r.description else c.description end,
             ai_keywords = case when c.ai_keywords is null or cardinality(c.ai_keywords) = 0 then r.keywords else c.ai_keywords end
       where c.space_id = p_space_id and c.is_demo = false and c.kind = r.kind
         and public.normalize_category_name(c.name) = public.normalize_category_name(r.name);
      continue;
    end if;

    insert into public.categories(user_id, space_id, is_demo, name, kind, color, active, description, ai_keywords)
    values (v_creator, p_space_id, false, r.name, r.kind, r.color, true, r.description, r.keywords);
    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$$;

drop function if exists public.create_category(text, text, text);
create or replace function public.create_category(
  p_name text,
  p_kind text,
  p_color text,
  p_description text default null,
  p_ai_keywords text[] default null
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
  if p_kind not in ('income','expense') then raise exception 'tipo invalido'; end if;

  insert into public.categories(user_id, space_id, is_demo, name, kind, color, active, description, ai_keywords)
  values (
    v_user, v_space, false, btrim(p_name), p_kind, coalesce(nullif(p_color,''), '#8A8A8A'), true,
    left(nullif(btrim(coalesce(p_description, '')), ''), 240),
    public.sanitize_ai_keywords(p_ai_keywords)
  )
  returning id into v_id;

  perform public.write_finance_audit(v_space, 'categories', v_id, 'insert',
    jsonb_build_object('name', btrim(p_name), 'kind', p_kind));
  return v_id;
end;
$$;

drop function if exists public.update_category(uuid, text, text, text);
create or replace function public.update_category(
  p_id uuid,
  p_name text,
  p_kind text,
  p_color text,
  p_description text default null,
  p_ai_keywords text[] default null
)
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
    if v_used then raise exception 'nao e permitido alterar o tipo de categoria ja utilizada'; end if;
  end if;

  update public.categories
     set name = btrim(p_name),
         kind = p_kind,
         color = coalesce(nullif(p_color,''), color),
         description = left(nullif(btrim(coalesce(p_description, '')), ''), 240),
         ai_keywords = public.sanitize_ai_keywords(p_ai_keywords),
         user_id = v_user
   where id = p_id;
  perform public.write_finance_audit(v_space, 'categories', p_id, 'update',
    jsonb_build_object('name', btrim(p_name), 'kind', p_kind));
  return p_id;
end;
$$;

create or replace function public.update_financial_entity(
  p_id uuid,
  p_name text,
  p_color text,
  p_description text default null,
  p_ai_keywords text[] default null
)
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
  select space_id into v_space from public.financial_entities where id = p_id and is_demo = false for update;
  if v_space is null then raise exception 'entidade invalida'; end if;
  perform public.assert_writable_finance_space(v_space);
  if btrim(coalesce(p_name, '')) = '' then raise exception 'nome obrigatorio'; end if;

  update public.financial_entities
     set name = btrim(p_name),
         color = coalesce(nullif(p_color, ''), color),
         description = left(nullif(btrim(coalesce(p_description, '')), ''), 240),
         ai_keywords = public.sanitize_ai_keywords(p_ai_keywords),
         user_id = v_user
   where id = p_id;

  perform public.write_finance_audit(v_space, 'financial_entities', p_id, 'update',
    jsonb_build_object('name', btrim(p_name)));
  return p_id;
end;
$$;

revoke all on function public.sanitize_ai_keywords(text[]) from public, anon;
grant execute on function public.sanitize_ai_keywords(text[]) to authenticated;
revoke all on function public.create_category(text, text, text, text, text[]) from public, anon;
grant execute on function public.create_category(text, text, text, text, text[]) to authenticated;
revoke all on function public.update_category(uuid, text, text, text, text, text[]) from public, anon;
grant execute on function public.update_category(uuid, text, text, text, text, text[]) to authenticated;
revoke all on function public.update_financial_entity(uuid, text, text, text, text[]) from public, anon;
grant execute on function public.update_financial_entity(uuid, text, text, text, text[]) to authenticated;
revoke all on function public.ensure_finance_default_categories(uuid) from public, anon;
grant execute on function public.ensure_finance_default_categories(uuid) to authenticated;
