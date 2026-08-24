import { createFileRoute, Link } from "@tanstack/react-router";
import { Wallet, TrendingUp, TrendingDown, ArrowDownToLine, ArrowUpFromLine, LineChart as LineChartIcon, ShieldCheck } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useEntityScope } from "@/components/finance/EntityContext";
import { KpiCard } from "@/components/finance/KpiCard";
import { PageHeader } from "@/components/finance/PageHeader";
import { TransactionDialog } from "@/components/finance/TransactionDialog";
import {
  addDays,
  brl,
  buildScope,
  compact,
  computeKpis,
  entitySummaries,
  isOpen,
  monthLabel,
  projection,
  toDate,
  today,
} from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard executivo — Aurelian Finance" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { data, entityId, entityName, isLoading } = useEntityScope();
  const ref = today();
  const k = computeKpis(data, entityId, ref);
  const scope = buildScope(data, entityId);
  const horizon = addDays(ref, 30);
  const summaries = entitySummaries(data, ref);
  const proj = projection(data, entityId, ref);

  let receivables30 = 0;
  let payables30 = 0;
  let cardBills30 = 0;
  let commitments30 = 0;

  for (const t of data.transactions) {
    if (t.kind === "transfer" || t.deleted_at || !isOpen(t) || !scope.matchesEntity(t.entity_id)) continue;
    const due = toDate(t.due_date ?? t.competence_date);
    if (due > horizon) continue;
    if (t.kind === "income") receivables30 += Number(t.amount);
    if (t.kind === "expense") payables30 += Number(t.amount);
  }

  for (const installment of data.installments) {
    if (installment.status !== "pending" && installment.status !== "overdue") continue;
    if (!scope.cardIds.has(installment.credit_card_id)) continue;
    if (toDate(installment.due_date) <= horizon) cardBills30 += Number(installment.amount);
  }

  for (const recurring of data.recurring) {
    if (!recurring.active || recurring.kind !== "expense" || !scope.matchesEntity(recurring.entity_id)) continue;
    if (!recurring.next_run || toDate(recurring.next_run) <= horizon) commitments30 += Number(recurring.amount);
  }

  const strictFreeCash = k.balance + receivables30 - payables30 - cardBills30 - k.reserves - commitments30;

  return (
    <div className="min-w-0">
      <PageHeader
        title="Dashboard executivo"
        subtitle={`${entityName} · ${monthLabel(ref)}`}
        action={<TransactionDialog />}
      />

      {isLoading ? <p className="mb-4 text-sm text-muted-foreground">Carregando dados…</p> : null}

      <div className="panel relative overflow-hidden p-4 sm:p-5 md:p-8">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex min-w-0 flex-col gap-5 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-primary sm:text-[11px] sm:tracking-[0.22em]">Dinheiro livre — próximos 30 dias</p>
            <p className={`num mt-2 break-words text-[2rem] font-bold leading-tight sm:text-4xl md:text-5xl ${strictFreeCash >= 0 ? "text-gold-gradient" : "text-destructive"}`}>
              {brl(strictFreeCash)}
            </p>
            <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-muted-foreground sm:text-xs">
              Saldo realizado + recebimentos com vencimento em até 30 dias − contas a pagar em até 30 dias − parcelas de cartão em até 30 dias − reservas − compromissos recorrentes previstos no período.
            </p>
          </div>
          <div className="grid w-full grid-cols-2 gap-x-3 gap-y-3 text-xs sm:grid-cols-3 sm:gap-x-6 lg:w-auto lg:min-w-[430px]">
            <Breakdown label="Saldo realizado" value={k.balance} sign="+" />
            <Breakdown label="A receber 30d" value={receivables30} sign="+" />
            <Breakdown label="A pagar 30d" value={payables30} sign="−" negative />
            <Breakdown label="Cartões 30d" value={cardBills30} sign="−" negative />
            <Breakdown label="Reservas" value={k.reserves} sign="−" negative />
            <Breakdown label="Recorrentes 30d" value={commitments30} sign="−" negative />
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:mt-5 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        <KpiCard label="Saldo atual" value={brl(k.balance)} tone="gold" icon={<Wallet className="size-4" />} />
        <KpiCard label="Entradas do mês" value={brl(k.incomeMonth)} tone="positive" icon={<TrendingUp className="size-4" />} />
        <KpiCard label="Saídas do mês" value={brl(k.expenseMonth)} tone="negative" icon={<TrendingDown className="size-4" />} />
        <KpiCard label="Resultado do mês" value={brl(k.resultMonth)} tone={k.resultMonth >= 0 ? "positive" : "negative"} hint={`Transferências internas ignoradas: ${brl(k.internalTransfers)}`} />
        <KpiCard label="Total a receber" value={brl(k.receivables)} icon={<ArrowDownToLine className="size-4" />} hint={k.overdueReceivables > 0 ? `Vencidos: ${brl(k.overdueReceivables)}` : "Nada vencido"} />
        <KpiCard label="Total a pagar" value={brl(k.payables)} tone="negative" icon={<ArrowUpFromLine className="size-4" />} hint={k.overduePayables > 0 ? `Vencidos: ${brl(k.overduePayables)}` : "Nada vencido"} />
        <KpiCard label="Reservas alocadas" value={brl(k.reserves)} icon={<ShieldCheck className="size-4" />} />
        <KpiCard label="Saldo projetado total" value={brl(k.projectedBalance)} tone={k.projectedBalance >= 0 ? "positive" : "negative"} icon={<LineChartIcon className="size-4" />} />
      </div>

      <div className="panel mt-4 overflow-hidden p-4 sm:mt-5 sm:p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div><h2 className="text-sm font-semibold">Projeção de caixa</h2><p className="text-xs text-muted-foreground">7, 15, 30, 60 e 90 dias.</p></div>
          <Link to="/projecao" className="text-xs text-primary hover:underline">Abrir projeção</Link>
        </div>
        <div className="h-56 w-full sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={proj} margin={{ left: -18, right: 4, top: 4, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={10} tickLine={false} />
              <YAxis width={48} stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v: number) => compact(v)} />
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} formatter={(v: number) => brl(v)} />
              <Area type="monotone" dataKey="balance" stroke="var(--gold)" strokeWidth={2} fill="var(--gold)" fillOpacity={0.12} name="Saldo projetado" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel mt-4 p-4 sm:mt-5 sm:p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-sm font-semibold">Empresas e pessoal</h2><p className="text-xs text-muted-foreground">Saldo e resultado mensal por entidade.</p></div>
          <Link to="/entidades" className="text-xs text-primary hover:underline">Gerenciar</Link>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summaries.map((s) => (
            <div key={s.entity.id} className="min-w-0 rounded-xl border border-border bg-surface p-3.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.entity.color }} />
                <span className="truncate text-xs font-medium">{s.entity.name}</span>
              </div>
              <p className="num mt-2 break-words text-lg font-semibold">{brl(s.balance)}</p>
              <p className="text-[11px] text-muted-foreground">Resultado <span className={s.result >= 0 ? "text-success" : "text-destructive"}>{brl(s.result)}</span></p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Breakdown({ label, value, sign, negative }: { label: string; value: number; sign: string; negative?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] uppercase leading-tight tracking-wider text-muted-foreground sm:text-[10px]">{label}</p>
      <p className={`num mt-0.5 break-words text-xs font-medium sm:text-sm ${negative ? "text-destructive" : "text-foreground"}`}>{sign} {brl(value)}</p>
    </div>
  );
}
