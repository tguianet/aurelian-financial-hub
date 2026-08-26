import { parseDateOnly } from "./date";
import type { FinanceDataset, Transaction } from "./finance";

export type TransactionAnomaly = {
  id: string;
  type: "possible_duplicate" | "unusual_amount";
  severity: "warning" | "critical";
  transaction: Transaction;
  relatedTransaction?: Transaction;
  title: string;
  body: string;
};

function normalizeDescription(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(de|da|do|das|dos|em|no|na|nos|nas|para|pra|com|por|um|uma|o|a|os|as)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dayDistance(a: string, b: string) {
  const left = parseDateOnly(a).getTime();
  const right = parseDateOnly(b).getTime();
  return Math.abs(Math.round((left - right) / 86_400_000));
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function activeTransactions(data: FinanceDataset, entityId: string) {
  return data.transactions
    .filter((tx) => !tx.deleted_at && !tx.is_demo && tx.kind !== "transfer" && tx.status !== "cancelled" && (entityId === "all" || tx.entity_id === entityId))
    .sort((a, b) => b.competence_date.localeCompare(a.competence_date));
}

export function detectTransactionAnomalies(data: FinanceDataset, entityId: string): TransactionAnomaly[] {
  const transactions = activeTransactions(data, entityId);
  const anomalies: TransactionAnomaly[] = [];
  const duplicateKeys = new Set<string>();

  for (let i = 0; i < transactions.length; i += 1) {
    const current = transactions[i];
    if (!current) continue;
    const normalized = normalizeDescription(current.description);
    if (normalized.length < 4) continue;

    for (let j = i + 1; j < transactions.length; j += 1) {
      const previous = transactions[j];
      if (!previous) continue;
      if (dayDistance(current.competence_date, previous.competence_date) > 3) break;
      if (current.kind !== previous.kind || current.entity_id !== previous.entity_id) continue;
      if (Math.abs(Number(current.amount) - Number(previous.amount)) > 0.01) continue;
      if (normalizeDescription(previous.description) !== normalized) continue;

      const key = [current.id, previous.id].sort().join(":");
      if (duplicateKeys.has(key)) continue;
      duplicateKeys.add(key);
      anomalies.push({
        id: `duplicate:${key}`,
        type: "possible_duplicate",
        severity: "critical",
        transaction: current,
        relatedTransaction: previous,
        title: "Esse lançamento pode estar repetido",
        body: "Encontrei outro lançamento com o mesmo valor e descrição em uma data muito próxima. Confira antes de considerar os dois.",
      });
      break;
    }
  }

  const expenses = transactions.filter((tx) => tx.kind === "expense");
  for (const current of expenses.slice(0, 80)) {
    const comparable = expenses
      .filter((other) => other.id !== current.id && other.entity_id === current.entity_id && other.category_id && other.category_id === current.category_id && other.competence_date < current.competence_date)
      .slice(0, 12)
      .map((other) => Number(other.amount))
      .filter((amount) => amount > 0);

    if (comparable.length < 4) continue;
    const baseline = median(comparable);
    const amount = Number(current.amount);
    if (baseline <= 0 || amount < baseline * 2.5 || amount - baseline < 100) continue;

    anomalies.push({
      id: `amount:${current.id}`,
      type: "unusual_amount",
      severity: amount >= baseline * 4 ? "critical" : "warning",
      transaction: current,
      title: "Esse gasto ficou bem acima do normal",
      body: `Para essa categoria, o valor típico recente ficou perto de R$ ${baseline.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Este lançamento foi de R$ ${amount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
    });
  }

  return anomalies
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
      return b.transaction.competence_date.localeCompare(a.transaction.competence_date);
    })
    .slice(0, 20);
}
