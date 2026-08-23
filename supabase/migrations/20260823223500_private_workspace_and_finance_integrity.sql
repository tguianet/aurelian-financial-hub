-- Aurelian Finance
-- Private workspace bootstrap + ownership/integrity hardening.

CREATE UNIQUE INDEX IF NOT EXISTS financial_entities_user_slug_unique
  ON public.financial_entities(user_id, slug)
  WHERE user_id IS NOT NULL AND is_demo = false;

CREATE OR REPLACE FUNCTION public.ensure_finance_workspace(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_entity_id uuid;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user_id obrigatorio';
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('pessoal', 'Pessoal', 'personal', '#E8B923'),
      ('tguianet', 'TGuiaNet', 'company', '#38BDF8'),
      ('softworks', 'Softworks', 'company', '#A78BFA'),
      ('restaurante', 'Restaurante', 'company', '#F97316'),
      ('buffet', 'Buffet', 'company', '#F43F5E'),
      ('energia', 'Energia', 'company', '#22C55E'),
      ('joias', 'Joias', 'company', '#EAB308')
    ) AS seed(slug, name, kind, color)
  LOOP
    INSERT INTO public.financial_entities(user_id, is_demo, name, slug, kind, color, active)
    VALUES (_user_id, false, r.name, r.slug, r.kind, r.color, true)
    ON CONFLICT (user_id, slug) WHERE user_id IS NOT NULL AND is_demo = false
    DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, color = EXCLUDED.color, active = true;

    SELECT id INTO v_entity_id
    FROM public.financial_entities
    WHERE user_id = _user_id AND slug = r.slug AND is_demo = false
    LIMIT 1;

    IF NOT EXISTS (
      SELECT 1 FROM public.accounts
      WHERE user_id = _user_id AND entity_id = v_entity_id AND is_demo = false
    ) THEN
      INSERT INTO public.accounts(user_id, is_demo, entity_id, name, type, opening_balance, active)
      VALUES (_user_id, false, v_entity_id, 'Conta principal', 'checking', 0, true);
    END IF;
  END LOOP;

  -- Categorias reais iniciais do usuario. Podem ser ampliadas pela interface depois.
  IF NOT EXISTS (SELECT 1 FROM public.categories WHERE user_id = _user_id AND is_demo = false) THEN
    INSERT INTO public.categories(user_id, is_demo, name, kind, color) VALUES
      (_user_id, false, 'Vendas', 'income', '#22C55E'),
      (_user_id, false, 'Servicos', 'income', '#38BDF8'),
      (_user_id, false, 'Comissoes', 'income', '#E8B923'),
      (_user_id, false, 'Outras receitas', 'income', '#A78BFA'),
      (_user_id, false, 'Combustivel', 'expense', '#F97316'),
      (_user_id, false, 'Alimentacao', 'expense', '#F59E0B'),
      (_user_id, false, 'Funcionarios', 'expense', '#F43F5E'),
      (_user_id, false, 'Fornecedores', 'expense', '#FB7185'),
      (_user_id, false, 'Energia eletrica', 'expense', '#EAB308'),
      (_user_id, false, 'Impostos', 'expense', '#EF4444'),
      (_user_id, false, 'Internet e telefone', 'expense', '#38BDF8'),
      (_user_id, false, 'Software', 'expense', '#A78BFA'),
      (_user_id, false, 'Veiculo', 'expense', '#64748B'),
      (_user_id, false, 'Saude', 'expense', '#10B981'),
      (_user_id, false, 'Lazer', 'expense', '#EC4899'),
      (_user_id, false, 'Outras despesas', 'expense', '#8A8A8A');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_finance_workspace(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_finance_workspace(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles(id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;

  PERFORM public.ensure_finance_workspace(NEW.id);
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE u record;
BEGIN
  FOR u IN SELECT id FROM public.profiles LOOP
    PERFORM public.ensure_finance_workspace(u.id);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.validate_transaction_finance_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source_entity uuid;
  v_target_entity uuid;
  v_card_entity uuid;
  v_category_kind text;
BEGIN
  IF NEW.is_demo THEN RETURN NEW; END IF;

  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'user_id obrigatorio';
  END IF;

  IF NEW.amount <= 0 THEN
    RAISE EXCEPTION 'valor deve ser maior que zero';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.financial_entities e
    WHERE e.id = NEW.entity_id AND e.user_id = NEW.user_id AND e.is_demo = false
  ) THEN
    RAISE EXCEPTION 'entidade nao pertence ao usuario';
  END IF;

  IF NEW.account_id IS NULL THEN
    RAISE EXCEPTION 'conta de origem obrigatoria';
  END IF;

  SELECT entity_id INTO v_source_entity
  FROM public.accounts
  WHERE id = NEW.account_id AND user_id = NEW.user_id AND is_demo = false;

  IF v_source_entity IS NULL OR v_source_entity <> NEW.entity_id THEN
    RAISE EXCEPTION 'conta de origem invalida para a entidade';
  END IF;

  IF NEW.category_id IS NOT NULL THEN
    SELECT kind INTO v_category_kind
    FROM public.categories
    WHERE id = NEW.category_id
      AND ((user_id = NEW.user_id AND is_demo = false) OR is_demo = true)
    LIMIT 1;

    IF v_category_kind IS NULL THEN
      RAISE EXCEPTION 'categoria invalida';
    END IF;

    IF NEW.kind IN ('income','expense') AND v_category_kind <> NEW.kind THEN
      RAISE EXCEPTION 'categoria incompativel com o tipo do lancamento';
    END IF;
  END IF;

  IF NEW.kind = 'transfer' THEN
    IF NEW.to_account_id IS NULL OR NEW.to_account_id = NEW.account_id THEN
      RAISE EXCEPTION 'conta de destino invalida';
    END IF;

    SELECT entity_id INTO v_target_entity
    FROM public.accounts
    WHERE id = NEW.to_account_id AND user_id = NEW.user_id AND is_demo = false;

    IF v_target_entity IS NULL THEN
      RAISE EXCEPTION 'conta de destino nao pertence ao usuario';
    END IF;

    NEW.to_entity_id := v_target_entity;
    NEW.category_id := NULL;
    NEW.credit_card_id := NULL;
    NEW.payment_method := 'transfer';
  ELSE
    NEW.to_account_id := NULL;
    NEW.to_entity_id := NULL;

    IF NEW.credit_card_id IS NOT NULL THEN
      SELECT entity_id INTO v_card_entity
      FROM public.credit_cards
      WHERE id = NEW.credit_card_id AND user_id = NEW.user_id AND is_demo = false;

      IF v_card_entity IS NULL OR v_card_entity <> NEW.entity_id THEN
        RAISE EXCEPTION 'cartao invalido para a entidade';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_transaction_finance_links ON public.transactions;
CREATE TRIGGER validate_transaction_finance_links
BEFORE INSERT OR UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.validate_transaction_finance_links();

CREATE OR REPLACE FUNCTION public.validate_account_entity_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_demo THEN RETURN NEW; END IF;
  IF NEW.user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.financial_entities e
    WHERE e.id = NEW.entity_id AND e.user_id = NEW.user_id AND e.is_demo = false
  ) THEN
    RAISE EXCEPTION 'entidade da conta nao pertence ao usuario';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_account_entity_owner ON public.accounts;
CREATE TRIGGER validate_account_entity_owner
BEFORE INSERT OR UPDATE ON public.accounts
FOR EACH ROW EXECUTE FUNCTION public.validate_account_entity_owner();

CREATE OR REPLACE FUNCTION public.validate_card_entity_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_account_entity uuid;
BEGIN
  IF NEW.is_demo THEN RETURN NEW; END IF;

  IF NEW.user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.financial_entities e
    WHERE e.id = NEW.entity_id AND e.user_id = NEW.user_id AND e.is_demo = false
  ) THEN
    RAISE EXCEPTION 'entidade do cartao nao pertence ao usuario';
  END IF;

  IF NEW.account_id IS NOT NULL THEN
    SELECT entity_id INTO v_account_entity
    FROM public.accounts
    WHERE id = NEW.account_id AND user_id = NEW.user_id AND is_demo = false;
    IF v_account_entity IS NULL OR v_account_entity <> NEW.entity_id THEN
      RAISE EXCEPTION 'conta de pagamento invalida para o cartao';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_card_entity_owner ON public.credit_cards;
CREATE TRIGGER validate_card_entity_owner
BEFORE INSERT OR UPDATE ON public.credit_cards
FOR EACH ROW EXECUTE FUNCTION public.validate_card_entity_owner();

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_amount_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_amount_check CHECK (amount > 0);
