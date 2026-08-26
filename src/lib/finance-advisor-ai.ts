import type { FinanceDataset } from "./finance";
import { ALL, brl, computeKpis, entitySummaries, projection, today } from "./finance";
import { advisorAlerts, advisorHealth, categoryMovements } from "./finance-advisor";

export type AdvisorAiContext = {
  scope: { entityId: string; entityName: string };
  period: string;
  kpis: {
    balance: number;
    freeCash30d: number;
    incomeMonth: number;
    expenseMonth: number;
    resultMonth: number;
    receivables: number;
    payables: number;
    overdueReceivables: number;
    overduePayables: number;
    reserves: number;
    commitments30d: number;
  };
  projections: Array<{ days: number; inflow: number; outflow: number; balance: number }>;
  entities: Array<{ name: string; income: number; expense: number; result: number; balance: number }>;
  categories: Array<{ name: string; current: number; previous: number; delta: number; deltaPct: number | null }>;
  alerts: Array<{ severity: string; title: string; body: string; action: string }>;
  health: { score: number; label: string; reasons: string[] };
};

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function buildAdvisorAiContext(
  data: FinanceDataset,
  entityId: string,
  entityName: string,
  ref = today(),
): AdvisorAiContext {
  const kpis = computeKpis(data, entityId, ref);
  const projections = projection(data, entityId, ref)
    .filter((row) => row.days === 7 || row.days === 30 || row.days === 60 || row.days === 90)
    .map((row) => ({ days: row.days, inflow: row.inflow, outflow: row.outflow, balance: row.balance }));

  const summaries = entitySummaries(data, ref)
    .filter((row) => entityId === ALL || row.entity.id === entityId)
    .slice(0, 20)
    .map((row) => ({
      name: row.entity.name,
      income: row.income,
      expense: row.expense,
      result: row.result,
      balance: row.balance,
    }));

  const categories = categoryMovements(data, entityId, ref)
    .slice(0, 15)
    .map((row) => ({
      name: row.name,
      current: row.current,
      previous: row.previous,
      delta: row.delta,
      deltaPct: row.deltaPct,
    }));

  const alerts = advisorAlerts(data, entityId, ref)
    .slice(0, 8)
    .map((row) => ({ severity: row.severity, title: row.title, body: row.body, action: row.action }));

  const health = advisorHealth(data, entityId, ref);

  return {
    scope: { entityId, entityName },
    period: monthKey(ref),
    kpis: {
      balance: kpis.balance,
      freeCash30d: kpis.freeCash,
      incomeMonth: kpis.incomeMonth,
      expenseMonth: kpis.expenseMonth,
      resultMonth: kpis.resultMonth,
      receivables: kpis.receivables,
      payables: kpis.payables,
      overdueReceivables: kpis.overdueReceivables,
      overduePayables: kpis.overduePayables,
      reserves: kpis.reserves,
      commitments30d: kpis.commitments,
    },
    projections,
    entities: summaries,
    categories,
    alerts,
    health,
  };
}

export function advisorFallbackSummary(context: AdvisorAiContext) {
  const k = context.kpis;
  const topCategory = [...context.categories].sort((a, b) => b.current - a.current)[0];
  const bestEntity = [...context.entities].sort((a, b) => b.result - a.result)[0];
  const worstEntity = [...context.entities].sort((a, b) => a.result - b.result)[0];
  const parts = [
    `Resultado do mês: ${brl(k.resultMonth)} (entradas ${brl(k.incomeMonth)} e saídas ${brl(k.expenseMonth)}).`,
    `Saldo realizado: ${brl(k.balance)}. Dinheiro livre em 30 dias: ${brl(k.freeCash30d)}.`,
    `A pagar: ${brl(k.payables)}; a receber: ${brl(k.receivables)}.`,
  ];
  if (topCategory) parts.push(`Maior categoria de gasto no mês: ${topCategory.name}, ${brl(topCategory.current)}.`);
  if (bestEntity && context.entities.length > 1) parts.push(`Melhor resultado: ${bestEntity.name}, ${brl(bestEntity.result)}.`);
  if (worstEntity && worstEntity.result < 0) parts.push(`Pior resultado: ${worstEntity.name}, ${brl(worstEntity.result)}.`);
  return parts.join(" ");
}

export async function requestAdvisorAnswer(question: string, context: AdvisorAiContext): Promise<string> {
  const response = await fetch("/api/finance/advisor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, context }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message || "Não consegui consultar o Consultor IA agora.");
  }

  const payload = await response.json() as { answer?: string };
  if (!payload.answer?.trim()) throw new Error("O Consultor IA não retornou uma resposta válida.");
  return payload.answer.trim();
}
