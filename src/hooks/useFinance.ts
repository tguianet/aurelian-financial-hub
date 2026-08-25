import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { emptyDataset, type Category, type FinanceDataset } from "@/lib/finance";

function preferPrivateData(data: FinanceDataset): FinanceDataset {
  const hasPrivateWorkspace = data.entities.some((e) => !e.is_demo);
  if (!hasPrivateWorkspace) return data;

  const entityIds = new Set(data.entities.filter((e) => !e.is_demo).map((e) => e.id));
  const accountIds = new Set(
    data.accounts.filter((a) => !a.is_demo && entityIds.has(a.entity_id)).map((a) => a.id),
  );
  const cardIds = new Set(
    data.cards.filter((c) => !c.is_demo && entityIds.has(c.entity_id)).map((c) => c.id),
  );
  const purchaseIds = new Set(
    data.purchases
      .filter((p) => !p.is_demo && entityIds.has(p.entity_id) && cardIds.has(p.credit_card_id))
      .map((p) => p.id),
  );

  return {
    entities: data.entities.filter((e) => !e.is_demo),
    accounts: data.accounts.filter((a) => !a.is_demo && entityIds.has(a.entity_id)),
    categories: data.categories.filter((c) => !c.is_demo).map((c) => ({ ...c, active: c.active !== false })),
    cards: data.cards.filter((c) => !c.is_demo && entityIds.has(c.entity_id)),
    transactions: data.transactions.filter((t) => !t.is_demo && entityIds.has(t.entity_id)),
    purchases: data.purchases.filter(
      (p) => !p.is_demo && entityIds.has(p.entity_id) && cardIds.has(p.credit_card_id),
    ),
    installments: data.installments.filter(
      (i) => !i.is_demo && purchaseIds.has(i.purchase_id) && cardIds.has(i.credit_card_id),
    ),
    budgets: data.budgets.filter((b) => !b.is_demo && entityIds.has(b.entity_id)),
    reserves: data.reserves.filter((r) => !r.is_demo && entityIds.has(r.entity_id)),
    recurring: data.recurring.filter((r) => !r.is_demo && entityIds.has(r.entity_id)),
    insights: data.insights.filter(
      (i) => !i.is_demo && (i.entity_id === null || entityIds.has(i.entity_id)),
    ),
    semanticRules: data.semanticRules ?? [],
  };
}

async function fetchAll(): Promise<FinanceDataset> {
  const space = await supabase.rpc("current_finance_space_id");
  const spaceId = space.data;
  if (spaceId) {
    const write = await supabase.rpc("can_write_finance_space", { p_space_id: spaceId });
    if (write.data) {
      await supabase.rpc("generate_due_recurring_transactions");
    }
  }

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
    semanticRulesResult,
  ] = await Promise.all([
    supabase.from("financial_entities").select("*").order("kind").order("name"),
    supabase.from("accounts").select("*").order("name"),
    supabase.from("categories").select("*").order("name"),
    supabase.from("credit_cards").select("*").order("name"),
    supabase
      .from("transactions")
      .select("*")
      .is("deleted_at", null)
      .order("competence_date", { ascending: false }),
    supabase
      .from("credit_card_purchases")
      .select("*")
      .order("purchase_date", { ascending: false }),
    supabase.from("credit_card_installments").select("*").order("due_date"),
    supabase.from("budgets").select("*"),
    supabase.from("reserves").select("*").order("name"),
    supabase.from("recurring_transactions").select("*").order("description"),
    supabase.from("ai_insights").select("*").order("created_at", { ascending: false }),
    supabase.from("finance_semantic_rules").select("*").order("updated_at", { ascending: false }),
  ]);

  let categoryRows = (categories.data ?? []) as FinanceDataset["categories"];
  if (!categoryRows.some((c) => !c.is_demo)) {
    if (spaceId) {
      const write = await supabase.rpc("can_write_finance_space", { p_space_id: spaceId });
      if (write.data) {
        await supabase.rpc("ensure_finance_default_categories", { p_space_id: spaceId });
        const seeded = await supabase.from("categories").select("*").order("name");
        if (!seeded.error) categoryRows = (seeded.data ?? categoryRows) as FinanceDataset["categories"];
      }
    }
  }

  const first = [
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
  ].find((r) => r.error);
  if (first?.error) throw first.error;

  const dataset: FinanceDataset = {
    ...emptyDataset,
    entities: (entities.data ?? []) as FinanceDataset["entities"],
    accounts: (accounts.data ?? []) as FinanceDataset["accounts"],
    categories: categoryRows.map((c) => ({ ...c, active: c.active !== false })) as Category[],
    cards: (cards.data ?? []) as FinanceDataset["cards"],
    transactions: (transactions.data ?? []) as FinanceDataset["transactions"],
    purchases: (purchases.data ?? []) as FinanceDataset["purchases"],
    installments: (installments.data ?? []) as FinanceDataset["installments"],
    budgets: (budgets.data ?? []) as FinanceDataset["budgets"],
    reserves: (reserves.data ?? []) as FinanceDataset["reserves"],
    recurring: (recurring.data ?? []) as FinanceDataset["recurring"],
    insights: (insights.data ?? []) as FinanceDataset["insights"],
    semanticRules: semanticRulesResult.error
      ? []
      : ((semanticRulesResult.data ?? []) as FinanceDataset["semanticRules"]),
  };

  return preferPrivateData(dataset);
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
