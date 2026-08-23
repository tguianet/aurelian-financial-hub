import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { emptyDataset, type FinanceDataset } from "@/lib/finance";

async function fetchAll(): Promise<FinanceDataset> {
  const [
    entities,
    accounts,
    categories,
    cards,
    transactions,
    purchases,
    installments,
    budgets,
    reserves,
    recurring,
    insights,
  ] = await Promise.all([
    supabase.from("financial_entities").select("*").order("kind").order("name"),
    supabase.from("accounts").select("*").order("name"),
    supabase.from("categories").select("*").order("name"),
    supabase.from("credit_cards").select("*").order("name"),
    supabase.from("transactions").select("*").is("deleted_at", null).order("competence_date", { ascending: false }),
    supabase.from("credit_card_purchases").select("*").order("purchase_date", { ascending: false }),
    supabase.from("credit_card_installments").select("*").order("due_date"),
    supabase.from("budgets").select("*"),
    supabase.from("reserves").select("*").order("name"),
    supabase.from("recurring_transactions").select("*").order("description"),
    supabase.from("ai_insights").select("*").order("created_at", { ascending: false }),
  ]);

  const first = [entities, accounts, categories, cards, transactions].find((r) => r.error);
  if (first?.error) throw first.error;

  return {
    ...emptyDataset,
    entities: (entities.data ?? []) as FinanceDataset["entities"],
    accounts: (accounts.data ?? []) as FinanceDataset["accounts"],
    categories: (categories.data ?? []) as FinanceDataset["categories"],
    cards: (cards.data ?? []) as FinanceDataset["cards"],
    transactions: (transactions.data ?? []) as FinanceDataset["transactions"],
    purchases: (purchases.data ?? []) as FinanceDataset["purchases"],
    installments: (installments.data ?? []) as FinanceDataset["installments"],
    budgets: (budgets.data ?? []) as FinanceDataset["budgets"],
    reserves: (reserves.data ?? []) as FinanceDataset["reserves"],
    recurring: (recurring.data ?? []) as FinanceDataset["recurring"],
    insights: (insights.data ?? []) as FinanceDataset["insights"],
  };
}

export function useFinance() {
  const query = useQuery({
    queryKey: ["finance"],
    queryFn: fetchAll,
    staleTime: 30_000,
  });
  return { data: query.data ?? emptyDataset, isLoading: query.isLoading, error: query.error };
}

export function useRefreshFinance() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["finance"] });
}
