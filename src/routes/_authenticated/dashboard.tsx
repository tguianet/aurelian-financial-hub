import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowDownToLine, ArrowRight, ArrowUpFromLine, CheckCircle2, Clock3, LineChart as LineChartIcon, ShieldCheck, TrendingDown, TrendingUp, Wallet } from "lucide-react";
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
import { addMoney } from "@/lib/money";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Início — Aurelian Finance" }] }),
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

  for (const t of data.transactions) {
    if (t.kind === "transfer" || t.deleted_at || !isOpen(t) || !scope.matchesEntity(t.entity_id)) continue;
    const due = toDate(t.due_date ?? t.competence_date);
    if (due > horizon) continue;
    if (t.kind === "income") receivables30 = addMoney(receivables30, Number(t.amount));
    if (t.kind === "expense") payables30 = addMoney(payables30, Number(t.amount));
  }

  for (const installment of data.installments) {
    if (installment.status !== "pending" && installment.status !== "overdue") continue;
    if (!scope.cardIds.has(installment.credit_card_id)) continue;
    if (toDate(installment.due_date) <= horizon) cardBills30 = addMoney(cardBills30, Number(installment.amount));
  }

  const commitments30 = k.commitments;
  const strictFreeCash = k.freeCash;
  const openTransactions = data.transactions.filter((t) => t.kind !== "transfer" && !t.deleted_at && isOpen(t) && scope.matchesEntity(t.entity_id));
  const overduePayments = openTransactions.filter((t) => t.kind === "expense" && toDate(t.due_date ?? t.competence_date) < ref);
  const overdueReceipts = openTransactions.filter((t) => t.kind === "income" && toDate(t.due_date ?? t.competence_date) < ref);
  const dueToday = openTransactions.filter((t) => toDate(t.due_date ?? t.competence_date).toDateString() === ref.toDateString());

  const priorities = [
    overduePayments.length > 0 ? {
      title: `${overduePayments.length} pagamento${overduePayments.length > 1 ? "s" : ""} atrasado${overduePayments.length > 1 ? "s" : ""}`,
      body: `${brl(overduePayments.reduce((sum, item) => addMoney(sum, Number(item.amount)), 0))} já venceu e merece sua atenção primeiro.`,
      to: "/pendencias" as const,
      action: "Ver pagamentos",
      icon: AlertTriangle,
      tone: "critical" as const,
    } : null,
    overdueReceipts.length > 0 ? {
      title: `${overdueReceipts.length} recebimento${overdueReceipts.length > 1 ? "s" : ""} atrasado${overdueReceipts.length > 1 ? "s" : ""}`,
      body: `${brl(overdueReceipts.reduce((sum, item) => addMoney(sum, Number(item.amount)), 0))} já deveria ter entrado.`,
      to: "/pendencias" as const,
      action: "Ver recebimentos",
      icon: ArrowDownToLine,
      tone: "warning" as const,
    } : null,
    dueToday.length > 0 ? {
      title: `${dueToday.length} coisa${dueToday.length > 1 ? "s" : ""} vence${dueToday.length > 1 ? "m" : ""} hoje`,
      body: "Vale conferir agora para não deixar nada passar.",
      to: "/pendencias" as const,
      action: "Ver o que vence hoje",
      icon: Clock3,
      tone: "info" as const,
    } : null,
    strictFreeCash < 0 ? {
      title: "Os próximos 30 dias estão apertados",
      body: `Depois dos compromissos conhecidos, a previsão fica em ${brl(strictFreeCash)}.`,
      to: "/projecao" as const,
      action: "Ver próximos 30 dias",
      icon: TrendingDown,
      tone: "critical" as const,
    } : null,
  ].filter(Boolean).slice(0, 3) as Array<{
    title: string;
    body: string;
    to: "/pendencias" | "/projecao";
    action: string;
    icon: typeof AlertTriangle;
    tone: "critical" | "warning" | "info";
  }>;

  return (
    <div className="min-w-0">
      <PageHeader
        title="Seu dinheiro hoje"
        subtitle={`${entityName} · ${monthLabel(ref)}`}
        action={<TransactionDialog />}
      />

      {isLoading ? <p className="mb-4 text-sm text-muted-foreground">Organizando seus dados…</p> : null}

      <section className="panel mb-4 p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-primary">Resumo do dia</p>
            <h2 className="mt-1 text-lg font-semibold">
              {priorities.length > 0 ? `Hoje eu cuidaria de ${priorities.length} ${priorities.length === 1 ? "coisa" : "coisas"}.` : "Hoje está tudo em ordem."}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {priorities.length > 0 ? "Coloquei primeiro o que pode afetar seu caixa ou virar problema." : "Não encontrei pagamentos ou recebimentos urgentes agora."}
            </p>
          </div>
          <Link to="/consultor" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 text-xs font-medium text-primary hover:bg-primary/10">
            Perguntar ao Aurelian IA <ArrowRight className="size-3.5" />
          </Link>
        </div>

        {priorities.length > 0 ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {priorities.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className={`rounded-xl border p-4 ${item.tone === "critical" ? "border-destructive/30 bg-destructive/5" : item.tone === "warning" ? "border-amber-500/30 bg-amber-500/5" : "border-primary/20 bg-primary/5"}`}>
                  <div className="flex items-start gap-3">
                    <Icon className={`mt-0.5 size-4 shrink-0 ${item.tone === "critical" ? "text-destructive" : item.tone === "warning" ? "text-amber-500" : "text-primary"}`} />
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium">{item.title}</h3>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.body}</p>
                      <Link to={item.to} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                        {item.action} <ArrowRight className="size-3" />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <CheckCircle2 className="size-5 text-primary" />
            <div><p className="text-sm font-medium">Nada urgente agora</p><p className="text-xs text-muted-foreground">Você pode seguir acompanhando normalmente ou registrar uma nova movimentação.</p></div>
          </div>
        )}
      </section>

      <div className="panel relative overflow-hidden p-4 sm:p-5 md:p-8">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex min-w-0 flex-col gap-5 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-primary sm:text-[11px] sm:tracking-[0.22em]">Você pode usar sem preocupação</p>
            <p className={`num mt-2 break-words text-[2rem] font-bold leading-tight sm:text-4xl md:text-5xl ${strictFreeCash >= 0 ? "text-gold-gradient" : "text-destructive"}`}>
              {brl(strictFreeCash)}
            </p>
            <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-muted-foreground sm:text-xs">
              Já descontamos do seu saldo as contas, cartões, reservas e compromissos dos próximos 30 dias, e somamos o que você ainda vai receber nesse período.
            </p>
          </div>
          <details className="w-full rounded-xl border border-border bg-background/45 p-3 text-xs lg:w-auto lg:min-w-[430px]">
            <summary className="cursor-pointer font-medium text-foreground">Ver como chegamos nesse valor</summary>
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3 sm:gap-x-6">
              <Breakdown label="Dinheiro disponível hoje" value={k.balance} sign="+" />
              <Breakdown label="Dinheiro a receber" value={receivables30} sign="+" />
              <Breakdown label="Contas a pagar" value={payables30} sign="−" negative />
              <Breakdown label="Cartões" value={cardBills30} sign="−" negative />
              <Breakdown label="Dinheiro reservado" value={k.reserves} sign="−" negative />
              <Breakdown label="Compromissos recorrentes" value={commitments30} sign="−" negative />
            </div>
          </details>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:mt-5 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        <KpiCard label="Tenho hoje" value={brl(k.balance)} tone="gold" icon={<Wallet className="size-4" />} />
        <KpiCard label="Entrou este mês" value={brl(k.incomeMonth)} tone="positive" icon={<TrendingUp className="size-4" />} />
        <KpiCard label="Saiu este mês" value={brl(k.expenseMonth)} tone="negative" icon={<TrendingDown className="size-4" />} hint="Compras no cartão entram no mês em que foram feitas. O pagamento da fatura não conta duas vezes." />
        <KpiCard label="Sobrou no mês" value={brl(k.resultMonth)} tone={k.resultMonth >= 0 ? "positive" : "negative"} hint={`Movimentações entre suas próprias contas não alteram esse resultado: ${brl(k.internalTransfers)}`} />
        <KpiCard label="Ainda vou receber" value={brl(k.receivables)} icon={<ArrowDownToLine className="size-4" />} hint={k.overdueReceivables > 0 ? `Tem ${brl(k.overdueReceivables)} atrasado` : "Nada atrasado"} />
        <KpiCard label="Ainda preciso pagar" value={brl(k.payables)} tone="negative" icon={<ArrowUpFromLine className="size-4" />} hint={k.overduePayables > 0 ? `Tem ${brl(k.overduePayables)} atrasado` : "Nada atrasado"} />
        <KpiCard label="Dinheiro reservado" value={brl(k.reserves)} icon={<ShieldCheck className="size-4" />} />
        <KpiCard label="Como devo ficar" value={brl(k.projectedBalance)} tone={k.projectedBalance >= 0 ? "positive" : "negative"} icon={<LineChartIcon className="size-4" />} />
      </div>

      <div className="panel mt-4 overflow-hidden p-4 sm:mt-5 sm:p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div><h2 className="text-sm font-semibold">Como seu dinheiro vai ficar</h2><p className="text-xs text-muted-foreground">Uma visão dos próximos 7, 15, 30, 60 e 90 dias.</p></div>
          <Link to="/projecao" className="text-xs text-primary hover:underline">Ver detalhes</Link>
        </div>
        <div className="h-56 w-full sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={proj} margin={{ left: -18, right: 4, top: 4, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={10} tickLine={false} />
              <YAxis width={48} stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v: number) => compact(v)} />
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} formatter={(v: number) => brl(v)} />
              <Area type="monotone" dataKey="balance" stroke="var(--gold)" strokeWidth={2} fill="var(--gold)" fillOpacity={0.12} name="Quanto você deve ter" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel mt-4 p-4 sm:mt-5 sm:p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-sm font-semibold">Seu dinheiro por área</h2><p className="text-xs text-muted-foreground">Veja quanto existe no pessoal e em cada empresa.</p></div>
          <Link to="/entidades" className="text-xs text-primary hover:underline">Organizar</Link>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summaries.map((s) => (
            <div key={s.entity.id} className="min-w-0 rounded-xl border border-border bg-surface p-3.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.entity.color }} />
                <span className="truncate text-xs font-medium">{s.entity.name}</span>
              </div>
              <p className="num mt-2 break-words text-lg font-semibold">{brl(s.balance)}</p>
              <p className="text-[11px] text-muted-foreground">No mês <span className={s.result >= 0 ? "text-success" : "text-destructive"}>{brl(s.result)}</span></p>
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
