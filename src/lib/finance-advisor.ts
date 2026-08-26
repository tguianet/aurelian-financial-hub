import type { FinanceDataset } from "./finance";
import { ALL, addDays, buildScope, isOpen, toDate, today } from "./finance";
import { addMoney, roundMoney } from "./money";

export type CategoryMovement = {
  categoryId: string;
  name: string;
  current: number;
  previous: number;
  delta: number;
  deltaPct: number | null;
};

export type AdvisorAlert = {
  id: string;
  severity: "info" | "positive" | "warning" | "critical";
  title: string;
  body: string;
  action: string;
};

export type AdvisorHealth = {
  score: number;
  label: "crítico" | "atenção" | "estável" | "forte";
  reasons: string[];
};

function monthKeyFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function previousMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return monthKeyFromDate(new Date(year, month - 2, 1));
}

function categoryExpenses(data: FinanceDataset, entityId: string, monthKey: string) {
  const scope = buildScope(data, entityId);
  const totals = new Map<string, number>();

  for (const tx of data.transactions) {
    if (tx.kind !== "expense" || tx.deleted_at || tx.status === "cancelled") continue;
    if (!scope.matchesEntity(tx.entity_id) || !tx.competence_date.startsWith(monthKey)) continue;
    const key = tx.category_id ?? "__uncategorized__";
    totals.set(key, addMoney(totals.get(key) ?? 0, Number(tx.amount)));
  }

  for (const purchase of data.purchases) {
    if (!scope.matchesEntity(purchase.entity_id) || !purchase.purchase_date.startsWith(monthKey)) continue;
    const key = purchase.category_id ?? "__uncategorized__";
    totals.set(key, addMoney(totals.get(key) ?? 0, Number(purchase.total_amount)));
  }

  return totals;
}

export function categoryMovements(data: FinanceDataset, entityId: string, ref = today()): CategoryMovement[] {
  const currentMonth = monthKeyFromDate(ref);
  const previousMonth = previousMonthKey(currentMonth);
  const current = categoryExpenses(data, entityId, currentMonth);
  const previous = categoryExpenses(data, entityId, previousMonth);
  const keys = new Set([...current.keys(), ...previous.keys()]);

  return [...keys].map((categoryId) => {
    const currentValue = roundMoney(current.get(categoryId) ?? 0);
    const previousValue = roundMoney(previous.get(categoryId) ?? 0);
    const delta = roundMoney(addMoney(currentValue, -previousValue));
    return {
      categoryId,
      name: categoryId === "__uncategorized__"
        ? "Sem categoria"
        : data.categories.find((category) => category.id === categoryId)?.name ?? "Categoria removida",
      current: currentValue,
      previous: previousValue,
      delta,
      deltaPct: previousValue > 0 ? (delta / previousValue) * 100 : null,
    };
  }).sort((a, b) => b.delta - a.delta);
}

export function advisorAlerts(data: FinanceDataset, entityId: string, ref = today()): AdvisorAlert[] {
  const scope = buildScope(data, entityId);
  const now = new Date(ref);
  const horizon7 = addDays(ref, 7);
  const horizon30 = addDays(ref, 30);
  let overduePayables = 0;
  let overdueReceivables = 0;
  let payables7 = 0;
  let receivables7 = 0;
  let payables30 = 0;
  let receivables30 = 0;

  for (const tx of data.transactions) {
    if (tx.deleted_at || tx.status === "cancelled" || tx.kind === "transfer" || !isOpen(tx)) continue;
    if (!scope.matchesEntity(tx.entity_id)) continue;
    const due = toDate(tx.due_date ?? tx.competence_date);
    const amount = Number(tx.amount);
    if (tx.kind === "expense") {
      if (due < now) overduePayables = addMoney(overduePayables, amount);
      if (due <= horizon7) payables7 = addMoney(payables7, amount);
      if (due <= horizon30) payables30 = addMoney(payables30, amount);
    } else if (tx.kind === "income") {
      if (due < now) overdueReceivables = addMoney(overdueReceivables, amount);
      if (due <= horizon7) receivables7 = addMoney(receivables7, amount);
      if (due <= horizon30) receivables30 = addMoney(receivables30, amount);
    }
  }

  const alerts: AdvisorAlert[] = [];
  if (overduePayables > 0) alerts.push({ id: "overdue-payables", severity: "critical", title: "Contas vencidas", body: `Há R$ ${overduePayables.toFixed(2).replace(".", ",")} em pagamentos vencidos.`, action: "Priorize os vencidos com maior impacto operacional ou juros." });
  if (overdueReceivables > 0) alerts.push({ id: "overdue-receivables", severity: "warning", title: "Recebimentos atrasados", body: `Há R$ ${overdueReceivables.toFixed(2).replace(".", ",")} em recebimentos vencidos.`, action: "Faça cobrança dos maiores valores antes de assumir novos compromissos." });
  if (payables7 > receivables7 && payables7 > 0) alerts.push({ id: "cash-gap-7", severity: "warning", title: "Pressão de caixa nos próximos 7 dias", body: `Saídas abertas superam entradas abertas em R$ ${Math.abs(payables7 - receivables7).toFixed(2).replace(".", ",")}.`, action: "Antecipe recebíveis ou adie despesas não essenciais." });
  if (payables30 > receivables30 && payables30 > 0) alerts.push({ id: "cash-gap-30", severity: "info", title: "Compromissos de 30 dias acima dos recebíveis", body: `Contas abertas excedem recebimentos abertos em R$ ${Math.abs(payables30 - receivables30).toFixed(2).replace(".", ",")}.`, action: "Use a projeção para planejar capital de giro e reservas." });

  for (const movement of categoryMovements(data, entityId, ref).slice(0, 3)) {
    if (movement.deltaPct !== null && movement.deltaPct >= 30 && movement.delta >= 100) {
      alerts.push({ id: `category-spike-${movement.categoryId}`, severity: "warning", title: `Alta em ${movement.name}`, body: `A categoria subiu ${movement.deltaPct.toFixed(0)}% contra o mês anterior, aumento de R$ ${movement.delta.toFixed(2).replace(".", ",")}.`, action: "Revise os lançamentos dessa categoria e confirme se o aumento é esperado." });
    }
  }

  if (!alerts.length) alerts.push({ id: "stable", severity: "positive", title: "Sem alerta financeiro relevante", body: "Não encontrei pressão imediata de vencimentos ou alta anormal de categorias no escopo atual.", action: "Continue acompanhando resultado e projeção semanalmente." });
  return alerts.slice(0, 6);
}

export function advisorHealth(data: FinanceDataset, entityId: string, ref = today()): AdvisorHealth {
  const alerts = advisorAlerts(data, entityId, ref);
  let score = 100;
  const reasons: string[] = [];
  for (const alert of alerts) {
    if (alert.severity === "critical") { score -= 25; reasons.push(alert.title); }
    else if (alert.severity === "warning") { score -= 12; reasons.push(alert.title); }
    else if (alert.severity === "info" && alert.id !== "stable") { score -= 5; reasons.push(alert.title); }
  }
  score = Math.max(0, Math.min(100, score));
  const label: AdvisorHealth["label"] = score < 40 ? "crítico" : score < 65 ? "atenção" : score < 85 ? "estável" : "forte";
  if (!reasons.length) reasons.push("Nenhum alerta relevante no momento");
  return { score, label, reasons: reasons.slice(0, 3) };
}

export function entityRiskRows(data: FinanceDataset, ref = today()) {
  const currentMonth = monthKeyFromDate(ref);
  return data.entities.filter((entity) => entity.active !== false).map((entity) => {
    const movements = categoryMovements(data, entity.id, ref);
    const alerts = advisorAlerts(data, entity.id, ref);
    const health = advisorHealth(data, entity.id, ref);
    return {
      entity,
      currentMonth,
      expense: roundMoney(movements.reduce((sum, item) => addMoney(sum, item.current), 0)),
      health,
      criticalAlerts: alerts.filter((alert) => alert.severity === "critical").length,
      warningAlerts: alerts.filter((alert) => alert.severity === "warning").length,
    };
  }).sort((a, b) => a.health.score - b.health.score);
}

export function shouldCompareAllEntities(entityId: string) {
  return entityId === ALL;
}
