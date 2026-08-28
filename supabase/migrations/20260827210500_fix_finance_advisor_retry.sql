-- Aurelian Finance: corrige Retry-After para diferenciar limite horario e diario.

CREATE OR REPLACE FUNCTION public.consume_finance_advisor_quota(
  p_hour_limit integer DEFAULT 30,
  p_day_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_hour_start timestamptz := date_trunc('hour', v_now);
  v_today date := CURRENT_DATE;
  v_row public.finance_advisor_usage%ROWTYPE;
  v_hour_blocked boolean := false;
  v_day_blocked boolean := false;
  v_retry_after integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'sessao invalida';
  END IF;
  IF p_hour_limit < 1 OR p_day_limit < 1 THEN
    RAISE EXCEPTION 'limite invalido';
  END IF;

  INSERT INTO public.finance_advisor_usage(user_id)
  VALUES (v_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_row
  FROM public.finance_advisor_usage
  WHERE user_id = v_user_id
  FOR UPDATE;

  IF v_row.hour_window_start <> v_hour_start THEN
    v_row.hour_window_start := v_hour_start;
    v_row.hour_count := 0;
  END IF;

  IF v_row.day_date <> v_today THEN
    v_row.day_date := v_today;
    v_row.day_count := 0;
  END IF;

  v_hour_blocked := v_row.hour_count >= p_hour_limit;
  v_day_blocked := v_row.day_count >= p_day_limit;

  IF v_hour_blocked OR v_day_blocked THEN
    UPDATE public.finance_advisor_usage
    SET hour_window_start = v_row.hour_window_start,
        hour_count = v_row.hour_count,
        day_date = v_row.day_date,
        day_count = v_row.day_count,
        updated_at = v_now
    WHERE user_id = v_user_id;

    IF v_day_blocked THEN
      v_retry_after := GREATEST(
        1,
        EXTRACT(EPOCH FROM (((v_today + 1)::timestamp AT TIME ZONE current_setting('TIMEZONE')) - v_now))::integer
      );
    ELSE
      v_retry_after := GREATEST(
        1,
        EXTRACT(EPOCH FROM ((v_hour_start + interval '1 hour') - v_now))::integer
      );
    END IF;

    RETURN jsonb_build_object(
      'allowed', false,
      'hour_remaining', GREATEST(p_hour_limit - v_row.hour_count, 0),
      'day_remaining', GREATEST(p_day_limit - v_row.day_count, 0),
      'retry_after_seconds', v_retry_after,
      'limit_type', CASE WHEN v_day_blocked THEN 'day' ELSE 'hour' END
    );
  END IF;

  v_row.hour_count := v_row.hour_count + 1;
  v_row.day_count := v_row.day_count + 1;

  UPDATE public.finance_advisor_usage
  SET hour_window_start = v_row.hour_window_start,
      hour_count = v_row.hour_count,
      day_date = v_row.day_date,
      day_count = v_row.day_count,
      updated_at = v_now
  WHERE user_id = v_user_id;

  RETURN jsonb_build_object(
    'allowed', true,
    'hour_remaining', GREATEST(p_hour_limit - v_row.hour_count, 0),
    'day_remaining', GREATEST(p_day_limit - v_row.day_count, 0),
    'retry_after_seconds', 0,
    'limit_type', null
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_finance_advisor_quota(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_finance_advisor_quota(integer, integer) TO authenticated;
