-- Aurelian Finance: fundacao para integracao oficial com WhatsApp Cloud API.
-- Tokens/segredos NAO ficam nesta tabela; devem ser armazenados como secrets de backend.

CREATE TABLE IF NOT EXISTS public.whatsapp_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  display_phone_number text,
  phone_number_id text,
  business_account_id text,
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected','pending','connected','error')),
  last_webhook_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_settings TO authenticated;
GRANT ALL ON public.whatsapp_settings TO service_role;
ALTER TABLE public.whatsapp_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "whatsapp settings own read" ON public.whatsapp_settings;
CREATE POLICY "whatsapp settings own read" ON public.whatsapp_settings
FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "whatsapp settings own insert" ON public.whatsapp_settings;
CREATE POLICY "whatsapp settings own insert" ON public.whatsapp_settings
FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "whatsapp settings own update" ON public.whatsapp_settings;
CREATE POLICY "whatsapp settings own update" ON public.whatsapp_settings
FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "whatsapp settings own delete" ON public.whatsapp_settings;
CREATE POLICY "whatsapp settings own delete" ON public.whatsapp_settings
FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.touch_whatsapp_settings_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS whatsapp_settings_touch ON public.whatsapp_settings;
CREATE TRIGGER whatsapp_settings_touch BEFORE UPDATE ON public.whatsapp_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_whatsapp_settings_updated_at();

-- Evita que um usuario vincule comando a transacao de outro usuario.
CREATE OR REPLACE FUNCTION public.validate_whatsapp_command_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_demo THEN RETURN NEW; END IF;
  IF NEW.user_id IS NULL THEN RAISE EXCEPTION 'user_id obrigatorio'; END IF;
  IF NEW.transaction_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.id = NEW.transaction_id AND t.user_id = NEW.user_id AND t.is_demo = false
  ) THEN
    RAISE EXCEPTION 'transacao do comando nao pertence ao usuario';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_whatsapp_command_owner ON public.whatsapp_commands;
CREATE TRIGGER validate_whatsapp_command_owner
BEFORE INSERT OR UPDATE ON public.whatsapp_commands
FOR EACH ROW EXECUTE FUNCTION public.validate_whatsapp_command_owner();

CREATE INDEX IF NOT EXISTS whatsapp_commands_user_created_idx
  ON public.whatsapp_commands(user_id, created_at DESC)
  WHERE is_demo = false;
