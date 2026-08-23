
-- ============ profiles ============
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  email text,
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile" ON public.profiles FOR ALL TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ============ financial_entities ============
CREATE TABLE public.financial_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  is_demo boolean NOT NULL DEFAULT false,
  name text NOT NULL,
  slug text NOT NULL,
  kind text NOT NULL DEFAULT 'company' CHECK (kind IN ('personal','company')),
  color text NOT NULL DEFAULT '#E8B923',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  is_demo boolean NOT NULL DEFAULT false,
  entity_id uuid NOT NULL REFERENCES public.financial_entities(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'checking' CHECK (type IN ('checking','savings','cash','wallet','investment')),
  bank text,
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  is_demo boolean NOT NULL DEFAULT false,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'expense' CHECK (kind IN ('income','expense')),
  color text NOT NULL DEFAULT '#8A8A8A',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.credit_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  is_demo boolean NOT NULL DEFAULT false,
  entity_id uuid NOT NULL REFERENCES public.financial_entities(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  name text NOT NULL,
  brand text,
  credit_limit numeric(14,2) NOT NULL DEFAULT 0,
  closing_day int NOT NULL DEFAULT 25 CHECK (closing_day BETWEEN 1 AND 31),
  due_day int NOT NULL DEFAULT 5 CHECK (due_day BETWEEN 1 AND 31),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Ledger único: entrada / saída / transferência interna
CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  is_demo boolean NOT NULL DEFAULT false,
  entity_id uuid NOT NULL REFERENCES public.financial_entities(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('income','expense','transfer')),
  description text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  to_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  to_entity_id uuid REFERENCES public.financial_entities(id) ON DELETE SET NULL,
  credit_card_id uuid REFERENCES public.credit_cards(id) ON DELETE SET NULL,
  payment_method text NOT NULL DEFAULT 'pix' CHECK (payment_method IN ('pix','cash','debit','credit','boleto','transfer','other')),
  competence_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  paid_at date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','received','overdue','cancelled')),
  recurrence text NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none','monthly','weekly','yearly')),
  installment_no int,
  installment_total int,
  source text NOT NULL DEFAULT 'manual',
  notes text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX transactions_entity_idx ON public.transactions(entity_id, competence_date);
CREATE TRIGGER transactions_touch BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.credit_card_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  is_demo boolean NOT NULL DEFAULT false,
  credit_card_id uuid NOT NULL REFERENCES public.credit_cards(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES public.financial_entities(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  description text NOT NULL,
  total_amount numeric(14,2) NOT NULL,
  purchase_date date NOT NULL DEFAULT CURRENT_DATE,
  installments int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.credit_card_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  is_demo boolean NOT NULL DEFAULT false,
  purchase_id uuid NOT NULL REFERENCES public.credit_card_purchases(id) ON DELETE CASCADE,
  credit_card_id uuid NOT NULL REFERENCES public.credit_cards(id) ON DELETE CASCADE,
  installment_no int NOT NULL,
  amount numeric(14,2) NOT NULL,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','overdue','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  is_demo boolean NOT NULL DEFAULT false,
  entity_id uuid NOT NULL REFERENCES public.financial_entities(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  month date NOT NULL,
  planned_amount numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.reserves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  is_demo boolean NOT NULL DEFAULT false,
  entity_id uuid NOT NULL REFERENCES public.financial_entities(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  name text NOT NULL,
  target_amount numeric(14,2) NOT NULL DEFAULT 0,
  current_amount numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.recurring_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  is_demo boolean NOT NULL DEFAULT false,
  entity_id uuid NOT NULL REFERENCES public.financial_entities(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('income','expense')),
  description text NOT NULL,
  amount numeric(14,2) NOT NULL,
  frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly','weekly','yearly')),
  day_of_month int,
  next_run date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.financial_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  is_demo boolean NOT NULL DEFAULT false,
  entity_id uuid REFERENCES public.financial_entities(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  balance numeric(14,2) NOT NULL DEFAULT 0,
  free_cash numeric(14,2) NOT NULL DEFAULT 0,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.whatsapp_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  is_demo boolean NOT NULL DEFAULT false,
  phone text,
  raw_message text NOT NULL,
  parsed jsonb,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','parsed','applied','failed','ignored')),
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ai_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  is_demo boolean NOT NULL DEFAULT false,
  entity_id uuid REFERENCES public.financial_entities(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical','positive')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  table_name text NOT NULL,
  record_id uuid,
  action text NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit own read" ON public.audit_log FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "audit own write" ON public.audit_log FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- RLS padrão para todas as tabelas de dados
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['financial_entities','accounts','categories','credit_cards','transactions',
    'credit_card_purchases','credit_card_installments','budgets','reserves','recurring_transactions',
    'financial_snapshots','whatsapp_commands','ai_insights']
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "read own or demo" ON public.%I FOR SELECT TO authenticated USING (user_id = auth.uid() OR is_demo)', t);
    EXECUTE format('CREATE POLICY "insert own" ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND is_demo = false)', t);
    EXECUTE format('CREATE POLICY "update own" ON public.%I FOR UPDATE TO authenticated USING (user_id = auth.uid() AND is_demo = false) WITH CHECK (user_id = auth.uid() AND is_demo = false)', t);
    EXECUTE format('CREATE POLICY "delete own" ON public.%I FOR DELETE TO authenticated USING (user_id = auth.uid() AND is_demo = false)', t);
  END LOOP;
END $$;

-- ============ DADOS DE DEMONSTRAÇÃO (is_demo = true) ============
INSERT INTO public.financial_entities (id, is_demo, name, slug, kind, color) VALUES
 ('a0000000-0000-4000-8000-000000000001', true, 'Pessoal',      'pessoal',      'personal', '#E8B923'),
 ('a0000000-0000-4000-8000-000000000002', true, 'TGuiaNet',     'tguianet',     'company',  '#38BDF8'),
 ('a0000000-0000-4000-8000-000000000003', true, 'Softworks',    'softworks',    'company',  '#A78BFA'),
 ('a0000000-0000-4000-8000-000000000004', true, 'Restaurante',  'restaurante',  'company',  '#F97316'),
 ('a0000000-0000-4000-8000-000000000005', true, 'Buffet',       'buffet',       'company',  '#F43F5E'),
 ('a0000000-0000-4000-8000-000000000006', true, 'Energia',      'energia',      'company',  '#22C55E'),
 ('a0000000-0000-4000-8000-000000000007', true, 'Joias',        'joias',        'company',  '#EAB308');

INSERT INTO public.accounts (id, is_demo, entity_id, name, type, bank, opening_balance) VALUES
 ('b0000000-0000-4000-8000-000000000001', true, 'a0000000-0000-4000-8000-000000000001', 'Conta Corrente Pessoal', 'checking', 'Itaú', 42000.00),
 ('b0000000-0000-4000-8000-000000000002', true, 'a0000000-0000-4000-8000-000000000001', 'Carteira', 'cash', NULL, 1200.00),
 ('b0000000-0000-4000-8000-000000000003', true, 'a0000000-0000-4000-8000-000000000002', 'TGuiaNet PJ', 'checking', 'Inter', 88000.00),
 ('b0000000-0000-4000-8000-000000000004', true, 'a0000000-0000-4000-8000-000000000003', 'Softworks PJ', 'checking', 'Nubank', 61000.00),
 ('b0000000-0000-4000-8000-000000000005', true, 'a0000000-0000-4000-8000-000000000004', 'Restaurante Caixa', 'checking', 'Bradesco', 23500.00),
 ('b0000000-0000-4000-8000-000000000006', true, 'a0000000-0000-4000-8000-000000000005', 'Buffet PJ', 'checking', 'Santander', 17800.00),
 ('b0000000-0000-4000-8000-000000000007', true, 'a0000000-0000-4000-8000-000000000006', 'Energia PJ', 'checking', 'BTG', 96500.00),
 ('b0000000-0000-4000-8000-000000000008', true, 'a0000000-0000-4000-8000-000000000007', 'Joias PJ', 'checking', 'Itaú', 34200.00);

INSERT INTO public.categories (id, is_demo, name, kind, color) VALUES
 ('c0000000-0000-4000-8000-000000000001', true, 'Vendas',            'income',  '#22C55E'),
 ('c0000000-0000-4000-8000-000000000002', true, 'Serviços',          'income',  '#38BDF8'),
 ('c0000000-0000-4000-8000-000000000003', true, 'Pró-labore',        'income',  '#E8B923'),
 ('c0000000-0000-4000-8000-000000000004', true, 'Investimentos',     'income',  '#A78BFA'),
 ('c0000000-0000-4000-8000-000000000005', true, 'Folha de Pagamento','expense', '#F43F5E'),
 ('c0000000-0000-4000-8000-000000000006', true, 'Fornecedores',      'expense', '#F97316'),
 ('c0000000-0000-4000-8000-000000000007', true, 'Impostos',          'expense', '#EF4444'),
 ('c0000000-0000-4000-8000-000000000008', true, 'Aluguel',           'expense', '#8A8A8A'),
 ('c0000000-0000-4000-8000-000000000009', true, 'Marketing',         'expense', '#A78BFA'),
 ('c0000000-0000-4000-8000-00000000000a', true, 'Moradia',           'expense', '#64748B'),
 ('c0000000-0000-4000-8000-00000000000b', true, 'Alimentação',       'expense', '#FB923C'),
 ('c0000000-0000-4000-8000-00000000000c', true, 'Infraestrutura TI', 'expense', '#0EA5E9');

INSERT INTO public.credit_cards (id, is_demo, entity_id, account_id, name, brand, credit_limit, closing_day, due_day) VALUES
 ('d0000000-0000-4000-8000-000000000001', true, 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Itaú Black', 'Mastercard', 45000.00, 25, 5),
 ('d0000000-0000-4000-8000-000000000002', true, 'a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003', 'Inter Empresas', 'Visa', 30000.00, 20, 1),
 ('d0000000-0000-4000-8000-000000000003', true, 'a0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000005', 'Bradesco Corp', 'Visa', 18000.00, 28, 8);

-- Lançamentos realizados do mês
INSERT INTO public.transactions (is_demo, entity_id, kind, description, amount, category_id, account_id, payment_method, competence_date, due_date, paid_at, status) VALUES
 (true,'a0000000-0000-4000-8000-000000000002','income','Mensalidades de provedor - lote 1',48500.00,'c0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000003','pix',date_trunc('month',CURRENT_DATE)::date + 4, date_trunc('month',CURRENT_DATE)::date + 4, date_trunc('month',CURRENT_DATE)::date + 4,'received'),
 (true,'a0000000-0000-4000-8000-000000000002','expense','Folha de pagamento equipe',22300.00,'c0000000-0000-4000-8000-000000000005','b0000000-0000-4000-8000-000000000003','transfer',date_trunc('month',CURRENT_DATE)::date + 5, date_trunc('month',CURRENT_DATE)::date + 5, date_trunc('month',CURRENT_DATE)::date + 5,'paid'),
 (true,'a0000000-0000-4000-8000-000000000002','expense','Link dedicado / backbone',9800.00,'c0000000-0000-4000-8000-00000000000c','b0000000-0000-4000-8000-000000000003','boleto',date_trunc('month',CURRENT_DATE)::date + 8, date_trunc('month',CURRENT_DATE)::date + 8, date_trunc('month',CURRENT_DATE)::date + 8,'paid'),
 (true,'a0000000-0000-4000-8000-000000000003','income','Contrato SaaS - cliente corporativo',36700.00,'c0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000004','pix',date_trunc('month',CURRENT_DATE)::date + 3, date_trunc('month',CURRENT_DATE)::date + 3, date_trunc('month',CURRENT_DATE)::date + 3,'received'),
 (true,'a0000000-0000-4000-8000-000000000003','expense','Cloud e licenças',7450.00,'c0000000-0000-4000-8000-00000000000c','b0000000-0000-4000-8000-000000000004','credit',date_trunc('month',CURRENT_DATE)::date + 6, date_trunc('month',CURRENT_DATE)::date + 6, date_trunc('month',CURRENT_DATE)::date + 6,'paid'),
 (true,'a0000000-0000-4000-8000-000000000004','income','Faturamento salão + delivery',61200.00,'c0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000005','debit',date_trunc('month',CURRENT_DATE)::date + 10, date_trunc('month',CURRENT_DATE)::date + 10, date_trunc('month',CURRENT_DATE)::date + 10,'received'),
 (true,'a0000000-0000-4000-8000-000000000004','expense','Compra de insumos',28900.00,'c0000000-0000-4000-8000-000000000006','b0000000-0000-4000-8000-000000000005','boleto',date_trunc('month',CURRENT_DATE)::date + 9, date_trunc('month',CURRENT_DATE)::date + 9, date_trunc('month',CURRENT_DATE)::date + 9,'paid'),
 (true,'a0000000-0000-4000-8000-000000000004','expense','Aluguel do ponto',12500.00,'c0000000-0000-4000-8000-000000000008','b0000000-0000-4000-8000-000000000005','boleto',date_trunc('month',CURRENT_DATE)::date + 5, date_trunc('month',CURRENT_DATE)::date + 5, date_trunc('month',CURRENT_DATE)::date + 5,'paid'),
 (true,'a0000000-0000-4000-8000-000000000005','income','Eventos fechados no mês',43800.00,'c0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000006','pix',date_trunc('month',CURRENT_DATE)::date + 12, date_trunc('month',CURRENT_DATE)::date + 12, date_trunc('month',CURRENT_DATE)::date + 12,'received'),
 (true,'a0000000-0000-4000-8000-000000000005','expense','Equipe freelancer de eventos',15600.00,'c0000000-0000-4000-8000-000000000005','b0000000-0000-4000-8000-000000000006','pix',date_trunc('month',CURRENT_DATE)::date + 13, date_trunc('month',CURRENT_DATE)::date + 13, date_trunc('month',CURRENT_DATE)::date + 13,'paid'),
 (true,'a0000000-0000-4000-8000-000000000006','income','Contratos de geração distribuída',72400.00,'c0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000007','transfer',date_trunc('month',CURRENT_DATE)::date + 2, date_trunc('month',CURRENT_DATE)::date + 2, date_trunc('month',CURRENT_DATE)::date + 2,'received'),
 (true,'a0000000-0000-4000-8000-000000000006','expense','Impostos e taxas regulatórias',18900.00,'c0000000-0000-4000-8000-000000000007','b0000000-0000-4000-8000-000000000007','boleto',date_trunc('month',CURRENT_DATE)::date + 14, date_trunc('month',CURRENT_DATE)::date + 14, date_trunc('month',CURRENT_DATE)::date + 14,'paid'),
 (true,'a0000000-0000-4000-8000-000000000007','income','Venda de peças exclusivas',29600.00,'c0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000008','credit',date_trunc('month',CURRENT_DATE)::date + 7, date_trunc('month',CURRENT_DATE)::date + 7, date_trunc('month',CURRENT_DATE)::date + 7,'received'),
 (true,'a0000000-0000-4000-8000-000000000007','expense','Compra de matéria-prima (ouro)',19800.00,'c0000000-0000-4000-8000-000000000006','b0000000-0000-4000-8000-000000000008','transfer',date_trunc('month',CURRENT_DATE)::date + 11, date_trunc('month',CURRENT_DATE)::date + 11, date_trunc('month',CURRENT_DATE)::date + 11,'paid'),
 (true,'a0000000-0000-4000-8000-000000000001','income','Pró-labore mensal',25000.00,'c0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000001','transfer',date_trunc('month',CURRENT_DATE)::date + 5, date_trunc('month',CURRENT_DATE)::date + 5, date_trunc('month',CURRENT_DATE)::date + 5,'received'),
 (true,'a0000000-0000-4000-8000-000000000001','expense','Condomínio e moradia',6400.00,'c0000000-0000-4000-8000-00000000000a','b0000000-0000-4000-8000-000000000001','boleto',date_trunc('month',CURRENT_DATE)::date + 6, date_trunc('month',CURRENT_DATE)::date + 6, date_trunc('month',CURRENT_DATE)::date + 6,'paid'),
 (true,'a0000000-0000-4000-8000-000000000001','expense','Mercado e alimentação',3150.00,'c0000000-0000-4000-8000-00000000000b','b0000000-0000-4000-8000-000000000001','debit',date_trunc('month',CURRENT_DATE)::date + 9, date_trunc('month',CURRENT_DATE)::date + 9, date_trunc('month',CURRENT_DATE)::date + 9,'paid');

-- Transferências internas (não contam como receita/despesa)
INSERT INTO public.transactions (is_demo, entity_id, kind, description, amount, account_id, to_account_id, to_entity_id, payment_method, competence_date, paid_at, status) VALUES
 (true,'a0000000-0000-4000-8000-000000000002','transfer','Distribuição TGuiaNet -> Pessoal',25000.00,'b0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','transfer',date_trunc('month',CURRENT_DATE)::date + 5, date_trunc('month',CURRENT_DATE)::date + 5,'paid'),
 (true,'a0000000-0000-4000-8000-000000000006','transfer','Aporte Energia -> Joias',15000.00,'b0000000-0000-4000-8000-000000000007','b0000000-0000-4000-8000-000000000008','a0000000-0000-4000-8000-000000000007','transfer',date_trunc('month',CURRENT_DATE)::date + 12, date_trunc('month',CURRENT_DATE)::date + 12,'paid');

-- Contas a pagar / receber (pendentes e futuras)
INSERT INTO public.transactions (is_demo, entity_id, kind, description, amount, category_id, account_id, payment_method, competence_date, due_date, status) VALUES
 (true,'a0000000-0000-4000-8000-000000000002','income','Mensalidades - lote 2',51200.00,'c0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000003','pix',CURRENT_DATE + 6, CURRENT_DATE + 6,'pending'),
 (true,'a0000000-0000-4000-8000-000000000003','income','Renovação anual de contrato',82000.00,'c0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000004','boleto',CURRENT_DATE + 22, CURRENT_DATE + 22,'pending'),
 (true,'a0000000-0000-4000-8000-000000000005','income','Sinal de casamento - dez',18500.00,'c0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000006','pix',CURRENT_DATE + 40, CURRENT_DATE + 40,'pending'),
 (true,'a0000000-0000-4000-8000-000000000007','income','Encomenda coleção alta joalheria',46000.00,'c0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000008','transfer',CURRENT_DATE + 55, CURRENT_DATE + 55,'pending'),
 (true,'a0000000-0000-4000-8000-000000000006','income','Contrato usina solar - parcela',63000.00,'c0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000007','transfer',CURRENT_DATE + 12, CURRENT_DATE + 12,'pending'),
 (true,'a0000000-0000-4000-8000-000000000004','income','Repasse de aplicativos de delivery',14200.00,'c0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000005','transfer',CURRENT_DATE + 3, CURRENT_DATE + 3,'pending'),
 (true,'a0000000-0000-4000-8000-000000000002','expense','Impostos TGuiaNet',13400.00,'c0000000-0000-4000-8000-000000000007','b0000000-0000-4000-8000-000000000003','boleto',CURRENT_DATE + 8, CURRENT_DATE + 8,'pending'),
 (true,'a0000000-0000-4000-8000-000000000003','expense','Folha Softworks',19700.00,'c0000000-0000-4000-8000-000000000005','b0000000-0000-4000-8000-000000000004','transfer',CURRENT_DATE + 10, CURRENT_DATE + 10,'pending'),
 (true,'a0000000-0000-4000-8000-000000000004','expense','Fornecedor de bebidas',9600.00,'c0000000-0000-4000-8000-000000000006','b0000000-0000-4000-8000-000000000005','boleto',CURRENT_DATE + 4, CURRENT_DATE + 4,'pending'),
 (true,'a0000000-0000-4000-8000-000000000005','expense','Locação de estrutura para evento',11300.00,'c0000000-0000-4000-8000-000000000006','b0000000-0000-4000-8000-000000000006','boleto',CURRENT_DATE + 18, CURRENT_DATE + 18,'pending'),
 (true,'a0000000-0000-4000-8000-000000000006','expense','Manutenção de usinas',24500.00,'c0000000-0000-4000-8000-000000000006','b0000000-0000-4000-8000-000000000007','boleto',CURRENT_DATE + 26, CURRENT_DATE + 26,'pending'),
 (true,'a0000000-0000-4000-8000-000000000007','expense','Fornecedor de pedras',16800.00,'c0000000-0000-4000-8000-000000000006','b0000000-0000-4000-8000-000000000008','boleto',CURRENT_DATE + 35, CURRENT_DATE + 35,'pending'),
 (true,'a0000000-0000-4000-8000-000000000001','expense','IPTU parcela',2400.00,'c0000000-0000-4000-8000-00000000000a','b0000000-0000-4000-8000-000000000001','boleto',CURRENT_DATE + 14, CURRENT_DATE + 14,'pending'),
 (true,'a0000000-0000-4000-8000-000000000004','expense','Fornecedor de hortifruti (vencido)',3800.00,'c0000000-0000-4000-8000-000000000006','b0000000-0000-4000-8000-000000000005','boleto',CURRENT_DATE - 6, CURRENT_DATE - 6,'overdue'),
 (true,'a0000000-0000-4000-8000-000000000002','income','Cliente inadimplente (vencido)',7300.00,'c0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000003','boleto',CURRENT_DATE - 11, CURRENT_DATE - 11,'overdue');

-- Compras parceladas no cartão
INSERT INTO public.credit_card_purchases (id, is_demo, credit_card_id, entity_id, category_id, description, total_amount, purchase_date, installments) VALUES
 ('e0000000-0000-4000-8000-000000000001', true, 'd0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-00000000000a','Reforma do apartamento', 24000.00, CURRENT_DATE - 40, 12),
 ('e0000000-0000-4000-8000-000000000002', true, 'd0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-00000000000c','Servidores e switches', 18000.00, CURRENT_DATE - 20, 6),
 ('e0000000-0000-4000-8000-000000000003', true, 'd0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000006','Equipamento de cozinha', 9600.00, CURRENT_DATE - 10, 4);

INSERT INTO public.credit_card_installments (is_demo, purchase_id, credit_card_id, installment_no, amount, due_date, status)
SELECT true, p.id, p.credit_card_id, g,
       round(p.total_amount / p.installments, 2),
       (date_trunc('month', p.purchase_date)::date + ((g) || ' month')::interval)::date + 4,
       CASE WHEN (date_trunc('month', p.purchase_date)::date + ((g) || ' month')::interval)::date + 4 < CURRENT_DATE THEN 'paid' ELSE 'pending' END
FROM public.credit_card_purchases p, generate_series(1, 12) g
WHERE p.is_demo AND g <= p.installments;

INSERT INTO public.reserves (is_demo, entity_id, account_id, name, target_amount, current_amount, notes) VALUES
 (true,'a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','Reserva de emergência pessoal',120000.00,68000.00,'6 meses de custo de vida'),
 (true,'a0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000003','Caixa mínimo TGuiaNet',60000.00,40000.00,'Folha + infraestrutura'),
 (true,'a0000000-0000-4000-8000-000000000004','b0000000-0000-4000-8000-000000000005','Reserva do Restaurante',30000.00,12000.00,'Sazonalidade'),
 (true,'a0000000-0000-4000-8000-000000000006','b0000000-0000-4000-8000-000000000007','Expansão de usinas',250000.00,90000.00,'CAPEX 2026');

INSERT INTO public.budgets (is_demo, entity_id, category_id, month, planned_amount) VALUES
 (true,'a0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-00000000000a',date_trunc('month',CURRENT_DATE)::date, 8000.00),
 (true,'a0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-00000000000b',date_trunc('month',CURRENT_DATE)::date, 4000.00),
 (true,'a0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000005',date_trunc('month',CURRENT_DATE)::date, 24000.00),
 (true,'a0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-00000000000c',date_trunc('month',CURRENT_DATE)::date, 9000.00),
 (true,'a0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-00000000000c',date_trunc('month',CURRENT_DATE)::date, 8000.00),
 (true,'a0000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000006',date_trunc('month',CURRENT_DATE)::date, 26000.00),
 (true,'a0000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000008',date_trunc('month',CURRENT_DATE)::date, 12500.00),
 (true,'a0000000-0000-4000-8000-000000000005','c0000000-0000-4000-8000-000000000005',date_trunc('month',CURRENT_DATE)::date, 14000.00),
 (true,'a0000000-0000-4000-8000-000000000006','c0000000-0000-4000-8000-000000000007',date_trunc('month',CURRENT_DATE)::date, 20000.00),
 (true,'a0000000-0000-4000-8000-000000000007','c0000000-0000-4000-8000-000000000006',date_trunc('month',CURRENT_DATE)::date, 18000.00);

INSERT INTO public.recurring_transactions (is_demo, entity_id, category_id, account_id, kind, description, amount, frequency, day_of_month, next_run) VALUES
 (true,'a0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000001','income','Pró-labore mensal',25000.00,'monthly',5,(date_trunc('month',CURRENT_DATE)+interval '1 month')::date + 4),
 (true,'a0000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000008','b0000000-0000-4000-8000-000000000005','expense','Aluguel do ponto',12500.00,'monthly',5,(date_trunc('month',CURRENT_DATE)+interval '1 month')::date + 4),
 (true,'a0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-00000000000c','b0000000-0000-4000-8000-000000000003','expense','Link dedicado / backbone',9800.00,'monthly',8,(date_trunc('month',CURRENT_DATE)+interval '1 month')::date + 7);

INSERT INTO public.ai_insights (is_demo, entity_id, title, body, severity) VALUES
 (true,'a0000000-0000-4000-8000-000000000004','Margem do Restaurante sob pressão','Insumos representam 47% da receita do mês. Acima da média histórica de 39%.','warning'),
 (true,'a0000000-0000-4000-8000-000000000006','Energia é o motor do consolidado','Energia responde pela maior geração de caixa livre do grupo neste mês.','positive'),
 (true,NULL,'Concentração de vencimentos','Há um bloco relevante de contas a pagar concentrado nos próximos 10 dias.','info');
