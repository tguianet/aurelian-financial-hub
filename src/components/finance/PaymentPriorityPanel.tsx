import { ArrowRight, CalendarClock, CircleAlert } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { brl, displayOpenStatus, fmtDate, isOpen, type FinanceDataset, type Transaction } from "@/lib/finance";
import { Button } from "@/components/ui/button";

type Props = {
  data: FinanceDataset;
  entityId: string;
  limit?: number;
};

function dueDateOf(tx: Transaction) {
  return tx.due_date ?? tx.competence_date;
}

function urgency(tx: Transaction) {
  const status = displayOpenStatus(tx.status, dueDateOf(tx));
  if (status === "overdue") return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDateOf(tx)}T00:00:00`);
  const days = Math.ceil((due.getTime() - today.getTime()) / 86_400_000);
  if (days <= 7) return 1;
  return 2;
}

export function prioritizedPayables(data: FinanceDataset, entityId: string) {
  return data.transactions
    .filter((tx) =>
      tx.kind === "expense"
      && !tx.deleted_at
      && isOpen(tx)
      && (entityId === "all" || tx.entity_id === entityId),
    )
    .sort((a, b) => {
      const urgencyDiff = urgency(a) - urgency(b);
      if (urgencyDiff !== 0) return urgencyDiff;
      const dateDiff = dueDateOf(a).localeCompare(dueDateOf(b));
      if (dateDiff !== 0) return dateDiff;
      return Number(b.amount) - Number(a.amount);
    });
}

export function PaymentPriorityPanel({ data, entityId, limit = 5 }: Props) {
  const payables = prioritizedPayables(data, entityId).slice(0, limit);

  return (
    <section className="panel mt-4 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <CalendarClock className="size-4" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">O que eu pagaria primeiro</span>
          </div>
          <h2 className="mt-1 text-base font-semibold">Fila prática de pagamentos</h2>
          <p className="mt-1 text-xs text-muted-foreground">Primeiro vencidos, depois os que vencem mais cedo. Em empate, o maior valor aparece antes.</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/pendencias">Ver todas <ArrowRight className="ml-1 size-3.5" /></Link>
        </Button>
      </div>

      <div className="mt-4 space-y-2">
        {payables.map((tx, index) => {
          const status = displayOpenStatus(tx.status, dueDateOf(tx));
          const entityName = data.entities.find((entity) => entity.id === tx.entity_id)?.name ?? "—";
          const categoryName = data.categories.find((category) => category.id === tx.category_id)?.name ?? "Sem categoria";
          return (
            <div key={tx.id} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 sm:flex-row sm:items-center">
              <div className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${status === "overdue" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
                {index + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium">{tx.description}</p>
                  {status === "overdue" ? <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive"><CircleAlert className="size-3" /> vencido</span> : null}
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{entityName} · {categoryName} · vence {fmtDate(dueDateOf(tx))}</p>
              </div>
              <p className="num shrink-0 text-sm font-semibold text-destructive">{brl(Number(tx.amount))}</p>
            </div>
          );
        })}
        {payables.length === 0 ? <p className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">Não há pagamentos em aberto neste escopo.</p> : null}
      </div>
    </section>
  );
}
