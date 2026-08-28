-- Aurelian Finance: permite usar um mesmo cartao fisico em varias entidades.
-- O cartao continua tendo um titular/conta de pagamento, mas cada compra escolhe
-- a entidade economica responsavel pela despesa.

DROP FUNCTION IF EXISTS public.create_credit_card_purchase(uuid, uuid, text, numeric, date, integer);

CREATE OR REPLACE FUNCTION public.create_credit_card_purchase(
  _credit_card_id uuid,
  _category_id uuid,
  _description text,
  _total_amount numeric,
  _purchase_date date,
  _installments integer DEFAULT 1,
  _entity_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_card_owner_entity_id uuid;
  v_purchase_entity_id uuid;
  v_closing_day integer;
  v_due_day integer;
  v_purchase_id uuid;
  v_first_month date;
  v_due_date date;
  v_base_amount numeric(14,2);
  v_last_amount numeric(14,2);
  i integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'sessao invalida'; END IF;
  IF _total_amount IS NULL OR _total_amount <= 0 THEN RAISE EXCEPTION 'valor deve ser maior que zero'; END IF;
  IF _installments < 1 OR _installments > 48 THEN RAISE EXCEPTION 'parcelas devem estar entre 1 e 48'; END IF;
  IF btrim(COALESCE(_description, '')) = '' THEN RAISE EXCEPTION 'descricao obrigatoria'; END IF;

  SELECT entity_id, closing_day, due_day
    INTO v_card_owner_entity_id, v_closing_day, v_due_day
  FROM public.credit_cards
  WHERE id = _credit_card_id
    AND user_id = v_user_id
    AND is_demo = false
    AND active = true;

  IF v_card_owner_entity_id IS NULL THEN RAISE EXCEPTION 'cartao invalido'; END IF;

  v_purchase_entity_id := COALESCE(_entity_id, v_card_owner_entity_id);

  IF NOT EXISTS (
    SELECT 1
    FROM public.financial_entities
    WHERE id = v_purchase_entity_id
      AND user_id = v_user_id
      AND is_demo = false
      AND active = true
  ) THEN
    RAISE EXCEPTION 'entidade da compra invalida';
  END IF;

  IF _category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.categories
    WHERE id = _category_id
      AND kind = 'expense'
      AND user_id = v_user_id
      AND is_demo = false
  ) THEN
    RAISE EXCEPTION 'categoria de despesa invalida';
  END IF;

  INSERT INTO public.credit_card_purchases(
    user_id, is_demo, credit_card_id, entity_id, category_id,
    description, total_amount, purchase_date, installments
  ) VALUES (
    v_user_id, false, _credit_card_id, v_purchase_entity_id, _category_id,
    btrim(_description), _total_amount, _purchase_date, _installments
  ) RETURNING id INTO v_purchase_id;

  v_first_month := date_trunc('month', _purchase_date)::date
    + CASE WHEN extract(day FROM _purchase_date)::integer <= v_closing_day
        THEN interval '1 month' ELSE interval '2 months' END;

  v_base_amount := trunc((_total_amount / _installments)::numeric, 2);
  v_last_amount := _total_amount - (v_base_amount * (_installments - 1));

  FOR i IN 1.._installments LOOP
    v_due_date := public.card_due_date((v_first_month + ((i - 1) || ' month')::interval)::date, v_due_day);
    INSERT INTO public.credit_card_installments(
      user_id, is_demo, purchase_id, credit_card_id, installment_no, amount, due_date, status
    ) VALUES (
      v_user_id, false, v_purchase_id, _credit_card_id, i,
      CASE WHEN i = _installments THEN v_last_amount ELSE v_base_amount END,
      v_due_date, 'pending'
    );
  END LOOP;

  INSERT INTO public.audit_log(user_id, table_name, record_id, action, details)
  VALUES (
    v_user_id, 'credit_card_purchases', v_purchase_id, 'insert',
    jsonb_build_object(
      'description', btrim(_description),
      'amount', _total_amount,
      'installments', _installments,
      'card_owner_entity_id', v_card_owner_entity_id,
      'purchase_entity_id', v_purchase_entity_id
    )
  );

  RETURN v_purchase_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_credit_card_purchase(uuid, uuid, text, numeric, date, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_credit_card_purchase(uuid, uuid, text, numeric, date, integer, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_card_purchase_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_demo THEN RETURN NEW; END IF;
  IF NEW.user_id IS NULL THEN RAISE EXCEPTION 'user_id obrigatorio'; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.credit_cards
    WHERE id = NEW.credit_card_id
      AND user_id = NEW.user_id
      AND is_demo = false
  ) THEN
    RAISE EXCEPTION 'cartao invalido para o usuario';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.financial_entities
    WHERE id = NEW.entity_id
      AND user_id = NEW.user_id
      AND is_demo = false
  ) THEN
    RAISE EXCEPTION 'entidade da compra invalida para o usuario';
  END IF;

  IF NEW.category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.categories
    WHERE id = NEW.category_id
      AND user_id = NEW.user_id
      AND is_demo = false
      AND kind = 'expense'
  ) THEN
    RAISE EXCEPTION 'categoria invalida';
  END IF;

  IF NEW.total_amount <= 0 OR NEW.installments < 1 OR NEW.installments > 48 THEN
    RAISE EXCEPTION 'compra invalida';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_card_purchase_owner ON public.credit_card_purchases;
CREATE TRIGGER validate_card_purchase_owner
BEFORE INSERT OR UPDATE ON public.credit_card_purchases
FOR EACH ROW EXECUTE FUNCTION public.validate_card_purchase_owner();
