/**
 * Aurelian Finance — núcleo de cálculo financeiro.
 *
 * Regras críticas implementadas aqui:
 * - Transferências internas (kind = "transfer") nunca entram em receitas/despesas.
 * - Saldo realizado usa apenas lançamentos liquidados (paid / received).
 * - Pendências futuras entram somente na projeção.
 * - O filtro de entidade afeta todos os agregados.
 */

export type EntityKind = "personal" | "company";
export type TxKind = "income" | "expense" | "transfer";
export type TxStatus = "pending" | "paid" | "received" | "overdue" | "cancelled";

export interface FinancialEntity {
  id: string;
  name: string;
  slug: string;
  kind: EntityKind;
  color: string;
  active: boolean;
  is_demo: boolean;
}

export interface Account {
  id: string;
  entity_id: string;
  name: string;
  type: string;
  bank: string | null;
  opening_balance: number;
  active: boolean;
  is_demo: boolean;
}

export interface Category {
  id: string;
  name: string;
  kind: "income" | "expense";
  color: string;
  is_demo: boolean;
}

export interface CreditCard {
  id: string;
  entity_id: string;
  account_id: string | null;
  name: string;
  brand: string | null;
  credit_limit: number;
  closing_day: number;
  due_day: number;
  active: boolean;
  is_demo: boolean;
}

export interface Transaction {
  id: string;
  entity_id: string;
  kind: TxKind;
  description: string;
  amount: number;
  category_id: string | null;
  account_id: string | null;
  to_account_id: string | null;
  to_entity_id: string | null;
  credit_card_id: string | null;
  payment_method: string;
  competence_date: string;
  due_date: string | null;
  paid_at: string | null;
  status: TxStatus;
  recurrence: string;
  installment_no: number | null;
  installment_total: number | null;
  source: string;
  notes: string | null;
  deleted_at: string | null;
  is_demo: boolean;
}

export interface CardPurchase {
  id: string;
  credit_card_id: string;
  entity_id: string;
  category_id: string | null;
  description: string;
  total_amount: number;
  purchase_date: string;
  installments: number;
  is_demo: boolean;
}

export interface CardInstallment {
  id: string;
  purchase_id: string;
  credit_card_id: string;
  installment_no: number;
  amount: number;
  due_date: string;
  status: "pending" | "paid" | "overdue" | "cancelled";
  is_demo: boolean;
}

export interface Budget {
  id: string;
  entity_id: string;
  category_id: string;
  month: string;
  planned_amount: number;
  is_demo: boolean;
}

export interface Reserve {
  id: string;
  entity_id: string;
  account_id: string | null;
  name: string;
  target_amount: number;
  current_amount: number;
  notes: string | null;
  is_demo: boolean;
}

export interface RecurringTransaction {
  id: string;
  entity_id: string;
  category_id: string | null;
  account_id: string | null;
  kind: "income" | "expense";
  description: string;
  amount: number;
  frequency: string;
  day_of_month: number | null;
  next_run: string | null;
  active: boolean;
  is_demo: boolean;
}

export interface AiInsight {
  id: string;
  entity_id: string | null;
  title: string;
  body: string;
  severity: "info" | "warning" | "critical" | "positive";
  is_demo: boolean;
}

export interface FinanceDataset {
  entities: FinancialEntity[];
  accounts: Account[];
  categories: Category[];
  cards: CreditCard[];
  transactions: Transaction[];
  purchases: CardPurchase[];
  installments: CardInstallment[];
  budgets: Budget[];
  reserves: Reserve[];
  recurring: RecurringTransaction[];
  insights: AiInsight[];
}

export const emptyDataset: FinanceDataset = {
  entities: [],
  accounts: [],
  categories: [],
  cards: [],
  transactions: [],
  purchases: [],
  installments: [],
  budgets: [],
  reserves: [],
  recurring: [],
  insights: [],
};

/* ---------------- helpers ---------------- */

export const ALL = "all";

export function brl(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  }).format(value ?? 0);
}

export function compact(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value ?? 0);
}

export function pct(value: number): string {
  return `${(value * 100).toFixed(1).replace(".", ",")}%`;
}

export function toDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return toDate(iso).toLocaleDateString("pt-BR");
}

export function today(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

export function addDays(d: Date, days: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + days);
  return c;
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(d: Date): string {
  return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

export const isSettled = (t: Transaction) => t.status === "paid" || t.status === "received";
export const isOpen = (t: Transaction) => t.status === "pending" || t.status === "overdue";

/* ---------------- escopo por entidade ---------------- */

export interface Scope {
  entityId: string; // ALL ou id
  accountIds: Set<string>;
  cardIds: Set<string>;
  matchesEntity: (id: string | null) => boolean;
}

export function buildScope(data: FinanceDataset, entityId: string): Scope {
  const all = entityId === ALL;
  const accountIds = new Set(
    data.accounts.filter((a) => all || a.entity_id === entityId).map((a) => a.id),
  );
  const cardIds = new Set(data.cards.filter((c) => all || c.entity_id === entityId).map((c) => c.id));
  return {
    entityId,
    accountIds,
    cardIds,
    matchesEntity: (id) => all || id === entityId,
  };
}

/** Saldo realizado por conta, considerando transferências sem duplicidade. */
export function accountBalances(data: FinanceDataset): Map<string, number> {
  const map = new Map<string, number>();
  for (const a of data.accounts) map.set(a.id, Number(a.opening_balance));

  for (const t of data.transactions) {
    if (t.deleted_at || t.status === "cancelled") continue;
    if (!isSettled(t)) continue;
    const amount = Number(t.amount);
    if (t.kind === "income" && t.account_id) {
      map.set(t.account_id, (map.get(t.account_id) ?? 0) + amount);
    } else if (t.kind === "expense" && t.account_id) {
      map.set(t.account_id, (map.get(t.account_id) ?? 0) - amount);
    } else if (t.kind === "transfer") {
      // Transferência interna: debita origem, credita destino. Soma global = 0.
      if (t.account_id) map.set(t.account_id, (map.get(t.account_id) ?? 0) - amount);
      if (t.to_account_id) map.set(t.to_account_id, (map.get(t.to_account_id) ?? 0) + amount);
    }
  }
  return map;
}

export interface Kpis {
  balance: number;
  freeCash: number;
  incomeMonth: number;
  expenseMonth: number;
  resultMonth: number;
  receivables: number;
  payables: number;
  overdueReceivables: number;
  overduePayables: number;
  cardBills: number;
  reserves: number;
  commitments: number;
  projectedBalance: number;
  internalTransfers: number;
}

export function computeKpis(data: FinanceDataset, entityId: string, ref = today()): Kpis {
  const scope = buildScope(data, entityId);
  const balances = accountBalances(data);

  let balance = 0;
  for (const id of scope.accountIds) balance += balances.get(id) ?? 0;

  const mk = monthKey(ref);
  const horizon = addDays(ref, 30);

  let incomeMonth = 0;
  let expenseMonth = 0;
  let receivables = 0;
  let payables = 0;
  let overdueReceivables = 0;
  let overduePayables = 0;
  let receivables30 = 0;
  let payables30 = 0;
  let internalTransfers = 0;

  for (const t of data.transactions) {
    if (t.deleted_at || t.status === "cancelled") continue;
    const amount = Number(t.amount);

    if (t.kind === "transfer") {
      // Nunca entra em receita/despesa. Contabilizado só como volume interno.
      const inScope =
        (t.account_id && scope.accountIds.has(t.account_id)) ||
        (t.to_account_id && scope.accountIds.has(t.to_account_id));
      if (inScope) internalTransfers += amount;
      continue;
    }

    if (!scope.matchesEntity(t.entity_id)) continue;

    if (isSettled(t)) {
      const settledOn = t.paid_at ?? t.competence_date;
      if (monthKey(toDate(settledOn)) === mk) {
        if (t.kind === "income") incomeMonth += amount;
        else expenseMonth += amount;
      }
    } else if (isOpen(t)) {
      const due = toDate(t.due_date ?? t.competence_date);
      const within30 = due <= horizon;
      if (t.kind === "income") {
        receivables += amount;
        if (within30) receivables30 += amount;
        if (t.status === "overdue") overdueReceivables += amount;
      } else {
        payables += amount;
        if (within30) payables30 += amount;
        if (t.status === "overdue") overduePayables += amount;
      }
    }
  }

  let cardBills = 0;
  let cardBills30 = 0;
  for (const i of data.installments) {
    if (i.status !== "pending" && i.status !== "overdue") continue;
    if (!scope.cardIds.has(i.credit_card_id)) continue;
    const amount = Number(i.amount);
    cardBills += amount;
    if (toDate(i.due_date) <= horizon) cardBills30 += amount;
  }

  const reserves = data.reserves
    .filter((r) => scope.matchesEntity(r.entity_id))
    .reduce((s, r) => s + Number(r.current_amount), 0);

  const commitments = data.recurring
    .filter((r) => r.active && r.kind === "expense" && scope.matchesEntity(r.entity_id))
    .reduce((s, r) => s + Number(r.amount), 0);

  const freeCash =
    balance + receivables30 - payables30 - cardBills30 - reserves - commitments;
  const projectedBalance = balance + receivables - payables - cardBills;

  return {
    balance,
    freeCash,
    incomeMonth,
    expenseMonth,
    resultMonth: incomeMonth - expenseMonth,
    receivables,
    payables,
    overdueReceivables,
    overduePayables,
    cardBills,
    reserves,
    commitments,
    projectedBalance,
    internalTransfers,
  };
}

export interface EntitySummary {
  entity: FinancialEntity;
  balance: number;
  income: number;
  expense: number;
  result: number;
  share: number;
}

export function entitySummaries(data: FinanceDataset, ref = today()): EntitySummary[] {
  const balances = accountBalances(data);
  const mk = monthKey(ref);
  const rows = data.entities.map((entity) => {
    const accIds = data.accounts.filter((a) => a.entity_id === entity.id).map((a) => a.id);
    const balance = accIds.reduce((s, id) => s + (balances.get(id) ?? 0), 0);
    let income = 0;
    let expense = 0;
    for (const t of data.transactions) {
      if (t.kind === "transfer" || t.deleted_at || t.status === "cancelled") continue;
      if (t.entity_id !== entity.id || !isSettled(t)) continue;
      if (monthKey(toDate(t.paid_at ?? t.competence_date)) !== mk) continue;
      if (t.kind === "income") income += Number(t.amount);
      else expense += Number(t.amount);
    }
    return { entity, balance, income, expense, result: income - expense, share: 0 };
  });
  const totalPositive = rows.reduce((s, r) => s + Math.max(r.balance, 0), 0) || 1;
  return rows
    .map((r) => ({ ...r, share: Math.max(r.balance, 0) / totalPositive }))
    .sort((a, b) => b.balance - a.balance);
}

export interface ProjectionPoint {
  days: number;
  label: string;
  inflow: number;
  outflow: number;
  balance: number;
}

export const PROJECTION_WINDOWS = [7, 15, 30, 60, 90];

export function projection(data: FinanceDataset, entityId: string, ref = today()): ProjectionPoint[] {
  const scope = buildScope(data, entityId);
  const balances = accountBalances(data);
  let base = 0;
  for (const id of scope.accountIds) base += balances.get(id) ?? 0;

  return PROJECTION_WINDOWS.map((days) => {
    const limit = addDays(ref, days);
    let inflow = 0;
    let outflow = 0;
    for (const t of data.transactions) {
      if (t.kind === "transfer" || t.deleted_at || t.status === "cancelled") continue;
      if (!isOpen(t) || !scope.matchesEntity(t.entity_id)) continue;
      const due = toDate(t.due_date ?? t.competence_date);
      if (due > limit) continue;
      if (t.kind === "income") inflow += Number(t.amount);
      else outflow += Number(t.amount);
    }
    for (const i of data.installments) {
      if (i.status !== "pending" && i.status !== "overdue") continue;
      if (!scope.cardIds.has(i.credit_card_id)) continue;
      if (toDate(i.due_date) > limit) continue;
      outflow += Number(i.amount);
    }
    return {
      days,
      label: `${days} dias`,
      inflow,
      outflow,
      balance: base + inflow - outflow,
    };
  });
}

export interface BudgetRow {
  id: string;
  entityName: string;
  categoryName: string;
  color: string;
  planned: number;
  actual: number;
  diff: number;
  usage: number;
}

export function budgetRows(data: FinanceDataset, entityId: string, ref = today()): BudgetRow[] {
  const scope = buildScope(data, entityId);
  const mk = monthKey(ref);
  return data.budgets
    .filter((b) => scope.matchesEntity(b.entity_id) && monthKey(toDate(b.month)) === mk)
    .map((b) => {
      const category = data.categories.find((c) => c.id === b.category_id);
      const entity = data.entities.find((e) => e.id === b.entity_id);
      const actual = data.transactions
        .filter(
          (t) =>
            t.kind === "expense" &&
            !t.deleted_at &&
            t.status !== "cancelled" &&
            t.entity_id === b.entity_id &&
            t.category_id === b.category_id &&
            monthKey(toDate(t.paid_at ?? t.competence_date)) === mk,
        )
        .reduce((s, t) => s + Number(t.amount), 0);
      const planned = Number(b.planned_amount);
      return {
        id: b.id,
        entityName: entity?.name ?? "—",
        categoryName: category?.name ?? "—",
        color: category?.color ?? "#8A8A8A",
        planned,
        actual,
        diff: planned - actual,
        usage: planned > 0 ? actual / planned : 0,
      };
    })
    .sort((a, b) => b.usage - a.usage);
}

export interface CategoryRow {
  name: string;
  color: string;
  income: number;
  expense: number;
}

export function categoryBreakdown(
  data: FinanceDataset,
  entityId: string,
  from: Date,
  to: Date,
): CategoryRow[] {
  const scope = buildScope(data, entityId);
  const map = new Map<string, CategoryRow>();
  for (const t of data.transactions) {
    if (t.kind === "transfer" || t.deleted_at || t.status === "cancelled") continue;
    if (!scope.matchesEntity(t.entity_id) || !isSettled(t)) continue;
    const d = toDate(t.paid_at ?? t.competence_date);
    if (d < from || d > to) continue;
    const cat = data.categories.find((c) => c.id === t.category_id);
    const name = cat?.name ?? "Sem categoria";
    const row = map.get(name) ?? { name, color: cat?.color ?? "#8A8A8A", income: 0, expense: 0 };
    if (t.kind === "income") row.income += Number(t.amount);
    else row.expense += Number(t.amount);
    map.set(name, row);
  }
  return [...map.values()].sort((a, b) => b.expense + b.income - (a.expense + a.income));
}

export function cardBill(data: FinanceDataset, cardId: string, ref = today()) {
  const items = data.installments.filter((i) => i.credit_card_id === cardId);
  const openItems = items.filter((i) => i.status === "pending" || i.status === "overdue");
  const currentMonth = openItems.filter((i) => monthKey(toDate(i.due_date)) === monthKey(ref));
  return {
    current: currentMonth.reduce((s, i) => s + Number(i.amount), 0),
    open: openItems.reduce((s, i) => s + Number(i.amount), 0),
    count: openItems.length,
  };
}

export const STATUS_LABEL: Record<TxStatus, string> = {
  pending: "Pendente",
  paid: "Pago",
  received: "Recebido",
  overdue: "Vencido",
  cancelled: "Cancelado",
};

export const KIND_LABEL: Record<TxKind, string> = {
  income: "Entrada",
  expense: "Saída",
  transfer: "Transferência",
};

export const PAYMENT_LABEL: Record<string, string> = {
  pix: "Pix",
  cash: "Dinheiro",
  debit: "Débito",
  credit: "Crédito",
  boleto: "Boleto",
  transfer: "Transferência",
  other: "Outro",
};
