import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  ArrowDownToLine,
  ArrowUpFromLine,
  LineChart as LineChartIcon,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEntityScope } from "@/components/finance/EntityContext";
import { KpiCard } from "@/components/finance/KpiCard";
import { DemoNotice, PageHeader } from "@/components/finance/PageHeader";
import { TransactionDialog } from "@/components/finance/TransactionDialog";
import {
  brl,
  compact,
  computeKpis,
  entitySummaries,
  monthLabel,
  pct,
  projection,
  today,
} from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard executivo — Aurelian Finance" },
      {
        name: "description",
        content:
          "Saldo, dinheiro livre, entradas e saídas do mês, contas a pagar e receber e saldo projetado por entidade.",
      },
      { property: "og:title", content: "Dashboard executivo — Aurelian Finance" },
      { property: "og:description", content: "Visão consolidada do caixa pessoal e das empresas." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { data, entityId, entityName, isLoading } = useEntityScope();
  const ref = today();
  const k = computeKpis(data, entityId, ref);
  const summaries = entitySummaries(data, ref);
  const proj = projection(data, entityId, ref);
  const insights = data.insights.filter((i) => !i.entity_id || i.entity_id === entityId).slice(0, 3);

  return (
    <div>
      <PageHeader
        title="Dashboard executivo"
        subtitle={`${entityName} · ${monthLabel(ref)}`}
        action={<TransactionDialog />}
      />
      <DemoNotice />

      {isLoading ? <p className="text-sm text-muted-foreground">Carregando dados…</p> : null}

      {/* Card principal: Dinheiro Livre */}
      <div className="panel relative overflow-hidden p-6 md:p-8">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-primary">
              Dinheiro livre
            </p>
            <p
              className={`num mt-2 text-4xl font-bold md:text-5xl ${
                k.freeCash >= 0 ? "text-gold-gradient" : "text-destructive"
              }`}
            >
              {brl(k.freeCash)}
            </p>
            <p className="mt-2 max-w-xl text-xs text-muted-foreground">
              Saldo disponível + recebimentos previstos em 30 dias − contas a pagar − faturas de
              cartão − reservas − compromissos programados.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-xs sm:grid-cols-3">
            <Breakdown label="Saldo disponível" value={k.balance} sign="+" />
            <Breakdown label="A receber (30d)" value={k.receivables} sign="+" />
            <Breakdown label="A pagar" value={k.payables} sign="−" negative />
            <Breakdown label="Faturas de cartão" value={k.cardBills} sign="−" negative />
            <Breakdown label="Reservas" value={k.reserves} sign="−" negative />
            <Breakdown label="Compromissos" value={k.commitments} sign="−" negative />
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Saldo atual" value={brl(k.balance)} tone="gold" icon={<Wallet className="size-4" />} />
        <KpiCard
          label="Entradas do mês"
          value={brl(k.incomeMonth)}
          tone="positive"
          icon={<TrendingUp className="size-4" />}
        />
        <KpiCard
          label="Saídas do mês"
          value={brl(k.expenseMonth)}
          tone="negative"
          icon={<TrendingDown className="size-4" />}
        />
        <KpiCard
          label="Resultado do mês"
          value={brl(k.resultMonth)}
          tone={k.resultMonth >= 0 ? "positive" : "negative"}
          hint={`Transferências internas ignoradas: ${brl(k.internalTransfers)}`}
        />
        <KpiCard
          label="Contas a receber"
          value={brl(k.receivables)}
          hint={k.overdueReceivables > 0 ? `Vencidos: ${brl(k.overdueReceivables)}` : "Nada vencido"}
          icon={<ArrowDownToLine className="size-4" />}
        />
        <KpiCard
          label="Contas a pagar"
          value={brl(k.payables)}
          tone="negative"
          hint={k.overduePayables > 0 ? `Vencidos: ${brl(k.overduePayables)}` : "Nada vencido"}
          icon={<ArrowUpFromLine className="size-4" />}
        />
        <KpiCard
          label="Reservas alocadas"
          value={brl(k.reserves)}
          icon={<ShieldCheck className="size-4" />}
        />
        <KpiCard
          label="Saldo projetado"
          value={brl(k.projectedBalance)}
          tone={k.projectedBalance >= 0 ? "positive" : "negative"}
          icon={<LineChartIcon className="size-4" />}
          hint="Considera todas as pendências e parcelas"
        />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <div className="panel p-5 xl:col-span-2">
          <h2 className="text-sm font-semibold">Projeção de caixa</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Saldo estimado considerando pendências com vencimento dentro de cada janela.
          </p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={proj}>
                <defs>
                  <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--gold)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="var(--gold)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} />
                <YAxis
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => compact(v)}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  formatter={(v: number) => brl(v)}
                />
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke="var(--gold)"
                  strokeWidth={2}
                  fill="url(#gold)"
                  name="Saldo projetado"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel p-5">
          <h2 className="text-sm font-semibold">Sinais e alertas</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Espaço preparado para insights automáticos de IA.
          </p>
          <div className="space-y-3">
            {insights.map((i) => (
              <div key={i.id} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-center gap-2">
                  <Sparkles
                    className={`size-3.5 ${
                      i.severity === "warning" || i.severity === "critical"
                        ? "text-destructive"
                        : i.severity === "positive"
                          ? "text-success"
                          : "text-primary"
                    }`}
                  />
                  <p className="text-xs font-medium">{i.title}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{i.body}</p>
              </div>
            ))}
            {insights.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum sinal no período.</p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="panel mt-5 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Participação por entidade</h2>
            <p className="text-xs text-muted-foreground">
              Saldo, receitas e despesas do mês, sem duplicar transferências internas.
            </p>
          </div>
          <Link to="/entidades" className="text-xs text-primary hover:underline">
            Ver detalhes
          </Link>
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={summaries.map((s) => ({ name: s.entity.name, saldo: s.balance }))}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} />
              <YAxis
                stroke="var(--muted-foreground)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => compact(v)}
              />
              <Tooltip
                cursor={{ fill: "var(--surface-2)" }}
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  fontSize: 12,
                }}
                formatter={(v: number) => brl(v)}
              />
              <Bar dataKey="saldo" fill="var(--gold)" radius={[6, 6, 0, 0]} name="Saldo" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {summaries.map((s) => (
            <div key={s.entity.id} className="rounded-lg border border-border bg-surface p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">{s.entity.name}</span>
                <span className="text-[10px] text-muted-foreground">{pct(s.share)}</span>
              </div>
              <p className="num mt-1 text-sm font-semibold">{brl(s.balance)}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Resultado{" "}
                <span className={s.result >= 0 ? "text-success" : "text-destructive"}>
                  {brl(s.result)}
                </span>
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Breakdown({
  label,
  value,
  sign,
  negative,
}: {
  label: string;
  value: number;
  sign: string;
  negative?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`num text-sm font-medium ${negative ? "text-destructive" : "text-foreground"}`}>
        {sign} {brl(value)}
      </p>
    </div>
  );
}
