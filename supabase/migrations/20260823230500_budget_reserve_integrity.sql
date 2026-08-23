-- Aurelian Finance: integridade de orçamento e reservas.

CREATE UNIQUE INDEX IF NOT EXISTS budgets_user_entity_category_month_unique
  ON public.budgets(user_id, entity_id, category_id, month)
  WHERE user_id IS NOT NULL AND is_demo = false;

CREATE OR REPLACE FUNCTION public.validate_budget_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_demo THEN RETURN NEW; END IF;
  IF NEW.user_id IS NULL THEN RAISE EXCEPTION 'user_id obrigatorio'; END IF;
  IF NEW.planned_amount < 0 THEN RAISE EXCEPTION 'orcamento nao pode ser negativo'; END IF;
  IF date_trunc('month', NEW.month)::date <> NEW.month THEN
    NEW.month := date_trunc('month', NEW.month)::date;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.financial_entities e
    WHERE e.id = NEW.entity_id AND e.user_id = NEW.user_id AND e.is_demo = false
  ) THEN RAISE EXCEPTION 'entidade nao pertence ao usuario'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.categories c
    WHERE c.id = NEW.category_id AND c.user_id = NEW.user_id AND c.is_demo = false AND c.kind = 'expense'
  ) THEN RAISE EXCEPTION 'categoria de despesa invalida'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_budget_owner ON public.budgets;
CREATE TRIGGER validate_budget_owner
BEFORE INSERT OR UPDATE ON public.budgets
FOR EACH ROW EXECUTE FUNCTION public.validate_budget_owner();

CREATE OR REPLACE FUNCTION public.validate_reserve_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_account_entity uuid;
BEGIN
  IF NEW.is_demo THEN RETURN NEW; END IF;
  IF NEW.user_id IS NULL THEN RAISE EXCEPTION 'user_id obrigatorio'; END IF;
  IF NEW.target_amount < 0 OR NEW.current_amount < 0 THEN
    RAISE EXCEPTION 'valores de reserva nao podem ser negativos';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.financial_entities e
    WHERE e.id = NEW.entity_id AND e.user_id = NEW.user_id AND e.is_demo = false
  ) THEN RAISE EXCEPTION 'entidade nao pertence ao usuario'; END IF;
  IF NEW.account_id IS NOT NULL THEN
    SELECT entity_id INTO v_account_entity
    FROM public.accounts
    WHERE id = NEW.account_id AND user_id = NEW.user_id AND is_demo = false;
    IF v_account_entity IS NULL OR v_account_entity <> NEW.entity_id THEN
      RAISE EXCEPTION 'conta da reserva invalida para a entidade';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_reserve_owner ON public.reserves;
CREATE TRIGGER validate_reserve_owner
BEFORE INSERT OR UPDATE ON public.reserves
FOR EACH ROW EXECUTE FUNCTION public.validate_reserve_owner();

ALTER TABLE public.budgets DROP CONSTRAINT IF EXISTS budgets_planned_amount_nonnegative;
ALTER TABLE public.budgets ADD CONSTRAINT budgets_planned_amount_nonnegative CHECK (planned_amount >= 0);
ALTER TABLE public.reserves DROP CONSTRAINT IF EXISTS reserves_target_nonnegative;
ALTER TABLE public.reserves ADD CONSTRAINT reserves_target_nonnegative CHECK (target_amount >= 0);
ALTER TABLE public.reserves DROP CONSTRAINT IF EXISTS reserves_current_nonnegative;
ALTER TABLE public.reserves ADD CONSTRAINT reserves_current_nonnegative CHECK (current_amount >= 0);
