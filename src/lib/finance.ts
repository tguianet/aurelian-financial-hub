/**
 * Aurelian Finance — núcleo de cálculo financeiro.
 *
 * REGIME DE COMPETÊNCIA (resultado, orçamento, relatórios, dashboard):
 * - Compra no cartão (`credit_card_purchases`): despesa econômica na `purchase_date`,
 *   pelo valor total. Parcelas NÃO entram no resultado.
 * - Lançamento `income`/`expense` não cancelado: na `competence_date`.
 * - Transferência (`kind = transfer`) NUNCA entra em receita/despesa/orçamento.
 *
 * PAGAMENTO DE FATURA / PARCELA (anti dupla contagem):
 * - `kind = transfer` + `source` em CARD_CASH_SOURCES.
 * - Debita o saldo bancário (caixa) e baixa a obrigação da parcela.
 * - NÃO aumenta `expenseMonth`, NÃO entra em relatórios/orçamento/resultado.
 *
 * CAIXA E OBRIGAÇÕES:
 * - Saldo realizado: lançamentos liquidados + transfers (pagamento de cartão
 *   sem conta destino só debita a origem).
 * - Projeção / cardBills: parcelas `pending`/`overdue`. Ao pagar, saem da obrigação.
 * - Ocorrências materializadas entram por `transactions`.
 * - A definição em `recurring_transactions` NÃO é somada de novo no mesmo horizonte.
 * - Projeção/caixa usam apenas datas ainda não materializadas a partir de `next_run`.
 *
 * DATE vs TIMESTAMPTZ:
 * - competence_date, due_date, purchase_date, paid_at, next_run, starts_at, ends_at
 *   são DATE (dia civil). Nunca gerar com toISOString().slice(0, 10).
 * - created_at / updated_at continuam TIMESTAMPTZ.
 *
 * Dinheiro: somas e parcelas em centavos (ver src/lib/money.ts).
 */

import {
  addMonthsClamped,
  formatDateOnly,
  isoFromYMD,
  isoWeekday,
  localDateIso,
  parseDateOnly,
} from "./date";
import { addMoney, roundMoney } from "./money";

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
  description?: string | null;
  ai_keywords?: string[] | null;
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
  active: boolean;
  description?: string | null;
  ai_keywords?: string[] | null;
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
  recurring_transaction_id?: string | null;
  recurring_occurrence_date?: string | null;
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
  paid_at?: string | null;
  payment_transaction_id?: string | null;
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
  weekday?: number | null;
  month_of_year?: number | null;
  next_run: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  active: boolean;
  payment_method?: string;
  notes?: string | null;
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

export type SemanticRuleType = "entity" | "category" | "entity_category";

export interface SemanticRule {
  id: string;
  space_id: string;
  user_id: string;
  rule_type: SemanticRuleType;
  normalized_hint: string;
  original_hint: string | null;
  entity_id: string | null;
  category_id: string | null;
  usage_count: number;
  active: boolean;
  created_at: string;
  updated_at: string;
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
  semanticRules: SemanticRule[];
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
  semanticRules: [],
};

/* ---------------- helpers ---------------- */

export const ALL = "all";

export function brl(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  }).format(roundMoney(value ?? 0));
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
  return parseDateOnly(iso);
}

export function fmtDate(iso: string | null): string {
  return formatDateOnly(iso);
}

export function today(): Date {
  return parseDateOnly(localDateIso());
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

/** Sources de caixa do cartão: transfer que não é despesa econômica. */
export const CARD_CASH_SOURCES = ["card_installment_payment", "card_bill_payment"] as const;

export function isCardCashMovement(t: Transaction): boolean {
  return t.kind === "transfer" && (CARD_CASH_SOURCES as readonly string[]).includes(t.source);
}

/** Receita/despesa econômica (competência). Transfers e cancelados ficam de fora. */
export function isEconomicTransaction(t: Transaction): boolean {
  return !t.deleted_at && t.status !== "cancelled" && t.kind !== "transfer";
}

export function monthDueDate(ref: Date, dueDay: number): string {
  return isoFromYMD(ref.getFullYear(), ref.getMonth() + 1, dueDay);
}

function isoFromParts(year: number, monthIndex: number, day: number): string {
  return isoFromYMD(year, monthIndex + 1, day);
}

function isoDow(d: Date): number {
  return isoWeekday(localDateIso(d));
}

function dateIso(d: Date): string {
  return localDateIso(d);
}

/**
 * Aberto e due_date < hoje local. Vencimento de hoje NÃO é atraso.
 * Não reescreve lançamentos já pagos.
 */
export function isFinancialOverdue(
  status: string,
  dueIso: string | null | undefined,
  todayIso = localDateIso(),
): boolean {
  if (status === "paid" || status === "received" || status === "cancelled") return false;
  if (status !== "pending" && status !== "overdue") return false;
  if (!dueIso) return false;
  return dueIso.slice(0, 10) < todayIso;
}

export function displayOpenStatus(
  status: string,
  dueIso: string | null | undefined,
  todayIso = localDateIso(),
): string {
  if (status === "paid" || status === "received" || status === "cancelled") return status;
  if (status === "pending" || status === "overdue") {
    return isFinancialOverdue(status, dueIso, todayIso) ? "overdue" : "pending";
  }
  return status;
}

export { addMonthsClamped, localDateIso };

/** Primeira ocorrência >= from, alinhada ao motor SQL. */
export function firstRecurringOccurrence(r: RecurringTransaction, fromIso: string): string {
  const from = toDate(fromIso);
  if (r.frequency === "weekly") {
    const target = r.weekday ?? isoDow(from);
    const delta = (target - isoDow(from) + 7) % 7;
    return dateIso(addDays(from, delta));
  }
  if (r.frequency === "yearly") {
    const monthIndex = (r.month_of_year ?? from.getMonth() + 1) - 1;
    const day = r.day_of_month ?? from.getDate();
    let candidate = isoFromParts(from.getFullYear(), monthIndex, day);
    if (candidate < fromIso) candidate = isoFromParts(from.getFullYear() + 1, monthIndex, day);
    return candidate;
  }
  const day = r.day_of_month ?? from.getDate();
  let candidate = isoFromParts(from.getFullYear(), from.getMonth(), day);
  if (candidate < fromIso) {
    const next = new Date(from.getFullYear(), from.getMonth() + 1, 1);
    candidate = isoFromParts(next.getFullYear(), next.getMonth(), day);
  }
  return candidate;
}

export function nextRecurringOccurrence(r: RecurringTransaction, fromIso: string): string {
  return firstRecurringOccurrence(r, dateIso(addDays(toDate(fromIso), 1)));
}

/**
 * Ocorrências futuras ainda NÃO materializadas em `transactions`.
 * Usar na projeção/caixa. Não somar `recurring.amount` solto.
 */
export function unmaterializedRecurringDates(
  r: RecurringTransaction,
  from: Date,
  until: Date,
  materializedDates: Set<string>,
): string[] {
  if (!r.active || !r.next_run) return [];
  const dates: string[] = [];
  let cursor = r.next_run;
  let guard = 0;
  const fromIso = dateIso(from);
  const untilIso = dateIso(until);
  while (guard++ < 400 && cursor <= untilIso) {
    if (r.ends_at && cursor > r.ends_at) break;
    if (cursor >= fromIso && !materializedDates.has(cursor)) dates.push(cursor);
    const next = nextRecurringOccurrence(r, cursor);
    if (next <= cursor) break;
    cursor = next;
  }
  return dates;
}

export function recurringMaterializedDates(data: FinanceDataset, recurringId: string): Set<string> {
  const set = new Set<string>();
  for (const t of data.transactions) {
    if (t.deleted_at || t.recurring_transaction_id !== recurringId || !t.recurring_occurrence_date) continue;
    set.add(t.recurring_occurrence_date);
  }
  return set;
}

export const FREQUENCY_LABEL: Record<string, string> = {
  weekly: "Semanal",
  monthly: "Mensal",
  yearly: "Anual",
};

export const WEEKDAY_LABEL: Record<number, string> = {
  1: "Segunda",
  2: "Terça",
  3: "Quarta",
  4: "Quinta",
  5: "Sexta",
  6: "Sábado",
  7: "Domingo",
};

function inRange(iso: string, from: Date, to: Date): boolean {
  const d = toDate(iso);
  return d >= from && d <= to;
}

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

/** Saldo realizado por conta. Transfer de fatura (sem destino) só debita a origem. */
export function accountBalances(data: FinanceDataset): Map<string, number> {
  const map = new Map<string, number>();
  for (const a of data.accounts) map.set(a.id, roundMoney(Number(a.opening_balance)));

  for (const t of data.transactions) {
    if (t.deleted_at || t.status === "cancelled") continue;
    if (!isSettled(t)) continue;
    const amount = roundMoney(Number(t.amount));
    if (t.kind === "income" && t.account_id) {
      map.set(t.account_id, addMoney(map.get(t.account_id) ?? 0, amount));
    } else if (t.kind === "expense" && t.account_id) {
      map.set(t.account_id, addMoney(map.get(t.account_id) ?? 0, -amount));
    } else if (t.kind === "transfer") {
      // Transferência interna ou pagamento de fatura: debita origem.
      // Destino ausente (card cash) = só caixa saindo, sem receita/despesa.
      if (t.account_id) map.set(t.account_id, addMoney(map.get(t.account_id) ?? 0, -amount));
      if (t.to_account_id) map.set(t.to_account_id, addMoney(map.get(t.to_account_id) ?? 0, amount));
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
  for (const id of scope.accountIds) balance = addMoney(balance, balances.get(id) ?? 0);

  const mk = monthKey(ref);
  const horizon = addDays(ref, 30);
  const todayIso = localDateIso(ref);

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
    const amount = roundMoney(Number(t.amount));

    if (t.kind === "transfer") {
      // Nunca entra em receita/despesa. Pagamento de fatura também é transfer.
      if (isCardCashMovement(t)) continue;
      const inScope =
        (t.account_id && scope.accountIds.has(t.account_id)) ||
        (t.to_account_id && scope.accountIds.has(t.to_account_id));
      if (inScope) internalTransfers = addMoney(internalTransfers, amount);
      continue;
    }

    if (!scope.matchesEntity(t.entity_id)) continue;

    if (isEconomicTransaction(t) && monthKey(toDate(t.competence_date)) === mk) {
      if (t.kind === "income") incomeMonth = addMoney(incomeMonth, amount);
      else expenseMonth = addMoney(expenseMonth, amount);
    }

    if (isOpen(t)) {
      const due = toDate(t.due_date ?? t.competence_date);
      const within30 = due <= horizon;
      const overdue = isFinancialOverdue(t.status, t.due_date ?? t.competence_date, todayIso);
      if (t.kind === "income") {
        receivables = addMoney(receivables, amount);
        if (within30) receivables30 = addMoney(receivables30, amount);
        if (overdue) overdueReceivables = addMoney(overdueReceivables, amount);
      } else {
        payables = addMoney(payables, amount);
        if (within30) payables30 = addMoney(payables30, amount);
        if (overdue) overduePayables = addMoney(overduePayables, amount);
      }
    }
  }

  for (const p of data.purchases) {
    if (!scope.matchesEntity(p.entity_id) || !scope.cardIds.has(p.credit_card_id)) continue;
    if (monthKey(toDate(p.purchase_date)) === mk) expenseMonth = addMoney(expenseMonth, Number(p.total_amount));
  }

  let cardBills = 0;
  let cardBills30 = 0;
  for (const i of data.installments) {
    if (i.status !== "pending" && i.status !== "overdue") continue;
    if (!scope.cardIds.has(i.credit_card_id)) continue;
    const amount = roundMoney(Number(i.amount));
    cardBills = addMoney(cardBills, amount);
    if (toDate(i.due_date) <= horizon) cardBills30 = addMoney(cardBills30, amount);
  }

  const reserves = data.reserves
    .filter((r) => scope.matchesEntity(r.entity_id))
    .reduce((s, r) => addMoney(s, Number(r.current_amount)), 0);

  const commitments = data.recurring
    .filter((r) => r.active && r.kind === "expense" && scope.matchesEntity(r.entity_id))
    .reduce((s, r) => {
      const dates = unmaterializedRecurringDates(r, ref, horizon, recurringMaterializedDates(data, r.id));
      return addMoney(s, dates.length * Number(r.amount));
    }, 0);

  const freeCash = addMoney(balance, receivables30, -payables30, -cardBills30, -reserves, -commitments);
  const projectedBalance = addMoney(balance, receivables, -payables, -cardBills);

  return {
    balance: roundMoney(balance),
    freeCash: roundMoney(freeCash),
    incomeMonth: roundMoney(incomeMonth),
    expenseMonth: roundMoney(expenseMonth),
    resultMonth: roundMoney(addMoney(incomeMonth, -expenseMonth)),
    receivables: roundMoney(receivables),
    payables: roundMoney(payables),
    overdueReceivables: roundMoney(overdueReceivables),
    overduePayables: roundMoney(overduePayables),
    cardBills: roundMoney(cardBills),
    reserves: roundMoney(reserves),
    commitments: roundMoney(commitments),
    projectedBalance: roundMoney(projectedBalance),
    internalTransfers: roundMoney(internalTransfers),
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
      if (!isEconomicTransaction(t) || t.entity_id !== entity.id) continue;
      if (monthKey(toDate(t.competence_date)) !== mk) continue;
      if (t.kind === "income") income = addMoney(income, Number(t.amount));
      else expense = addMoney(expense, Number(t.amount));
    }
    for (const p of data.purchases) {
      if (p.entity_id !== entity.id) continue;
      if (monthKey(toDate(p.purchase_date)) !== mk) continue;
      expense = addMoney(expense, Number(p.total_amount));
    }
    return { entity, balance: roundMoney(balance), income, expense, result: addMoney(income, -expense), share: 0 };
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
      if (t.kind === "income") inflow = addMoney(inflow, Number(t.amount));
      else outflow = addMoney(outflow, Number(t.amount));
    }
    for (const i of data.installments) {
      if (i.status !== "pending" && i.status !== "overdue") continue;
      if (!scope.cardIds.has(i.credit_card_id)) continue;
      if (toDate(i.due_date) > limit) continue;
      outflow = addMoney(outflow, Number(i.amount));
    }
    for (const r of data.recurring) {
      if (!r.active || !scope.matchesEntity(r.entity_id)) continue;
      const dates = unmaterializedRecurringDates(r, ref, limit, recurringMaterializedDates(data, r.id));
      const amount = dates.length * Number(r.amount);
      if (r.kind === "income") inflow = addMoney(inflow, amount);
      else outflow = addMoney(outflow, amount);
    }
    return {
      days,
      label: `${days} dias`,
      inflow: roundMoney(inflow),
      outflow: roundMoney(outflow),
      balance: roundMoney(addMoney(base, inflow, -outflow)),
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
      const fromTx = data.transactions
        .filter(
          (t) =>
            t.kind === "expense" &&
            isEconomicTransaction(t) &&
            t.entity_id === b.entity_id &&
            t.category_id === b.category_id &&
            monthKey(toDate(t.competence_date)) === mk,
        )
        .reduce((s, t) => addMoney(s, Number(t.amount)), 0);
      const fromPurchases = data.purchases
        .filter(
          (p) =>
            p.entity_id === b.entity_id &&
            p.category_id === b.category_id &&
            monthKey(toDate(p.purchase_date)) === mk,
        )
        .reduce((s, p) => addMoney(s, Number(p.total_amount)), 0);
      const actual = addMoney(fromTx, fromPurchases);
      const planned = roundMoney(Number(b.planned_amount));
      return {
        id: b.id,
        entityName: entity?.name ?? "—",
        categoryName: category?.name ?? "—",
        color: category?.color ?? "#8A8A8A",
        planned,
        actual,
        diff: addMoney(planned, -actual),
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
    if (!isEconomicTransaction(t) || !scope.matchesEntity(t.entity_id)) continue;
    if (!inRange(t.competence_date, from, to)) continue;
    const cat = data.categories.find((c) => c.id === t.category_id);
    const name = cat?.name ?? "Sem categoria";
    const row = map.get(name) ?? { name, color: cat?.color ?? "#8A8A8A", income: 0, expense: 0 };
    if (t.kind === "income") row.income = addMoney(row.income, Number(t.amount));
    else row.expense = addMoney(row.expense, Number(t.amount));
    map.set(name, row);
  }
  for (const p of data.purchases) {
    if (!scope.matchesEntity(p.entity_id) || !scope.cardIds.has(p.credit_card_id)) continue;
    if (!inRange(p.purchase_date, from, to)) continue;
    const cat = data.categories.find((c) => c.id === p.category_id);
    const name = cat?.name ?? "Sem categoria";
    const row = map.get(name) ?? { name, color: cat?.color ?? "#8A8A8A", income: 0, expense: 0 };
    row.expense = addMoney(row.expense, Number(p.total_amount));
    map.set(name, row);
  }
  return [...map.values()].sort((a, b) => b.expense + b.income - (a.expense + a.income));
}

export function cardBill(data: FinanceDataset, cardId: string, ref = today()) {
  const items = data.installments.filter((i) => i.credit_card_id === cardId);
  const openItems = items.filter((i) => i.status === "pending" || i.status === "overdue");
  const mk = monthKey(ref);
  const nextRef = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
  const nextMk = monthKey(nextRef);
  const currentMonth = openItems.filter((i) => monthKey(toDate(i.due_date)) === mk);
  const nextMonth = openItems.filter((i) => monthKey(toDate(i.due_date)) === nextMk);
  const future = openItems.filter((i) => monthKey(toDate(i.due_date)) > mk);
  return {
    current: currentMonth.reduce((s, i) => addMoney(s, Number(i.amount)), 0),
    next: nextMonth.reduce((s, i) => addMoney(s, Number(i.amount)), 0),
    future: future.reduce((s, i) => addMoney(s, Number(i.amount)), 0),
    open: openItems.reduce((s, i) => addMoney(s, Number(i.amount)), 0),
    count: openItems.length,
    currentCount: currentMonth.length,
    nextCount: nextMonth.length,
    futureCount: future.length,
    currentItems: currentMonth,
    openItems,
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
