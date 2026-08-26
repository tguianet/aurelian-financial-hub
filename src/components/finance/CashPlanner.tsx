import { useMemo } from "react";
import { Bot, PiggyBank, ShieldCheck, WalletCards } from "lucide-react";
import { brl, displayOpenStatus, type FinanceDataset } from "@/lib/finance";
import { addMoney, roundMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { prioritizedPayables } from "@/components/finance/PaymentPriorityPanel";

type Props = {
  data: FinanceDataset;
  entityId: string;
  entityName: string;
  balance: number;
  freeCash: number;
  onAskAurelian?: (question: string) => void;
};

function dueDateOf(tx: { due_date: string | null; competence_date: string }) {
  return tx.due_date ?? tx.competence_date;
}

function daysUntil(dateIso: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(`${dateIso}T00:00:00`);
  return Math.ceil((date.getTime() - today.getTime()) / 86_400_000);
}

export function CashPlanner({ data, entityId, entityName, balance, freeCash, onAskAurelian }: Props) {
  const plan = useMemo(() => {
    const payables = prioritizedPayables(data, entityId);
    const urgent = payables.filter((tx) => {
      const due = dueDateOf(tx);
      const status = displayOpenStatus(tx.status, due);
      return status === "overdue" || daysUntil(due) <= 7;
    });
    const urgentTotal = urgent.reduce((sum, tx) => addMoney(sum, Number(tx.amount)), 0);

    const scopedReserves = data.reserves.filter((reserve) => entityId === "all" || reserve.entity_id === entityId);
    const reserveTotal = scopedReserves.reduce((sum, reserve) => addMoney(sum, Number(reserve.current_amount)), 0);

    const positiveBalance = Math.max(0, balance);
    const positiveFreeCash = Math.max(0, freeCash);
    const safetyMargin = roundMoney(Math.min(positiveBalance * 0.1, positiveFreeCash * 0.25));
    const afterUrgentAndSafety = roundMoney(balance - urgentTotal - safetyMargin);
    const conservativeRemaining = roundMoney(Math.min(afterUrgentAndSafety, freeCash));

    return {
      urgent,
      urgentTotal: roundMoney(urgentTotal),
      reserveTotal: roundMoney(reserveTotal),
      safetyMargin,
      afterUrgentAndSafety,
      conservativeRemaining,
    };
  }, [balance, data, entityId, freeCash]);

  const status = plan.urgentTotal > balance
    ? "critical"
    : plan.conservativeRemaining < 0
      ? "warning"
      : "healthy";

  const summary = status === "critical"
    ? `As contas vencidas ou dos próximos 7 dias somam ${brl(plan.urgentTotal)}, acima do saldo atual de ${brl(balance)}. Eu não comprometeria caixa com novas despesas agora.`
    : status === "warning"
      ? `As prioridades imediatas cabem no saldo, mas os compromissos futuros deixam o Dinheiro Livre pressionado. Eu preservaria caixa depois dos pagamentos urgentes.`
      : `O caixa comporta as prioridades imediatas e ainda preserva uma margem conservadora de até ${brl(plan.conservativeRemaining)}.`;

  const askAurelian = () => {
    if (!onAskAurelian) return;
    onAskAurelian(`Monte um plano prudente para o caixa de ${entityName}. Considere saldo atual de ${brl(balance)}, ${brl(plan.urgentTotal)} em pagamentos vencidos ou até 7 dias, margem de segurança sugerida de ${brl(plan.safetyMargin)}, reservas atuais de ${brl(plan.reserveTotal)} e Dinheiro Livre de ${brl(freeCash)}. Diga o que eu deveria priorizar e o que evitar.`);
  };

  return (
    <section className="panel mt-4 overflow-hidden border-primary/20 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <PiggyBank className="size-4" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">Planejador de caixa</span>
          </div>
          <h2 className="mt-1 text-base font-semibold">Como eu distribuiria o caixa agora</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">Sugestão automática baseada no saldo, vencimentos, reservas já existentes e Dinheiro Livre. Nenhum dinheiro é movimentado.</p>
        </div>
        {onAskAurelian ? <Button variant="outline" size="sm" className="gap-1.5" onClick={askAurelian}><Bot className="size-3.5" /> Analisar plano</Button> : null}
      </div>

      <div className={`mt-4 rounded-xl border p-3 text-xs leading-relaxed ${status === "critical" ? "border-destructive/25 bg-destructive/5" : status === "warning" ? "border-amber-500/25 bg-amber-500/5" : "border-primary/20 bg-primary/5"}`}>
        {summary}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <PlanCard icon={WalletCards} label="1. Resolver agora" value={brl(plan.urgentTotal)} detail={`${plan.urgent.length} pagamento(s) vencido(s) ou até 7 dias`} danger={plan.urgentTotal > balance} />
        <PlanCard icon={ShieldCheck} label="2. Proteger" value={brl(plan.safetyMargin)} detail="margem sugerida para não zerar o caixa" />
        <PlanCard icon={PiggyBank} label="Reservas existentes" value={brl(plan.reserveTotal)} detail="já consideradas pelo cálculo de Dinheiro Livre" />
        <PlanCard icon={ShieldCheck} label="3. Margem conservadora" value={brl(plan.conservativeRemaining)} detail="menor entre sobra imediata e Dinheiro Livre" danger={plan.conservativeRemaining < 0} />
      </div>

      {plan.urgent.length > 0 ? (
        <div className="mt-4 rounded-xl border border-border bg-surface p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Primeiros pagamentos do plano</p>
          <div className="mt-2 space-y-2">
            {plan.urgent.slice(0, 3).map((tx, index) => (
              <div key={tx.id} className="flex items-center gap-3 text-xs">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate">{tx.description}</span>
                <strong className="num shrink-0 text-destructive">{brl(Number(tx.amount))}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PlanCard({ icon: Icon, label, value, detail, danger = false }: {
  icon: typeof PiggyBank;
  label: string;
  value: string;
  detail: string;
  danger?: boolean;
}) {
  return (
    <div className={`rounded-xl border bg-surface p-3 ${danger ? "border-destructive/25" : "border-border"}`}>
      <div className="flex items-center gap-2 text-muted-foreground"><Icon className={`size-4 ${danger ? "text-destructive" : "text-primary"}`} /><span className="text-[10px] font-semibold uppercase tracking-[0.13em]">{label}</span></div>
      <p className={`num mt-2 text-lg font-semibold ${danger ? "text-destructive" : ""}`}>{value}</p>
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  );
}
