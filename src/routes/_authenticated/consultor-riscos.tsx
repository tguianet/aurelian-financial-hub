import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Building2, ShieldCheck, Siren, TrendingUp } from "lucide-react";
import { useEntityScope } from "@/components/finance/EntityContext";
import { PageHeader } from "@/components/finance/PageHeader";
import { AdvisorAiPanel } from "@/components/finance/AdvisorAiPanel";
import { brl, today } from "@/lib/finance";
import { advisorAlerts, advisorHealth, categoryMovements, entityRiskRows } from "@/lib/finance-advisor";

export const Route = createFileRoute("/_authenticated/consultor-riscos")({
  head: () => ({ meta: [{ title: "O que merece atenção — Aurelian Finance" }] }),
  component: ConsultorRiscos,
});

function ConsultorRiscos() {
  const { data, entityId, entityName } = useEntityScope();
  const ref = today();
  const health = advisorHealth(data, entityId, ref);
  const alerts = advisorAlerts(data, entityId, ref);
  const movements = categoryMovements(data, entityId, ref);
  const entityRisks = entityRiskRows(data, ref);

  return (
    <div className="min-w-0">
      <PageHeader
        title="O que merece atenção"
        subtitle={`${entityName} · o Aurelian separou os pontos que podem afetar seu dinheiro`}
        action={(
          <Link to="/consultor" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Voltar para o Aurelian IA
          </Link>
        )}
      />

      <section className="panel overflow-hidden p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-primary"><ShieldCheck className="size-5" /><span className="text-xs font-semibold uppercase tracking-[0.18em]">Como está seu financeiro</span></div>
            <p className="mt-2 text-sm text-muted-foreground">Essa nota resume atrasos, pressão no caixa e aumentos fora do normal. Quanto maior, mais tranquilo está o cenário.</p>
          </div>
          <div className="rounded-2xl border border-primary/20 bg-primary/5 px-5 py-4 text-center">
            <p className={`num text-3xl font-bold ${health.score >= 65 ? "text-primary" : "text-destructive"}`}>{health.score}</p>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{health.label}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {health.reasons.map((reason) => <span key={reason} className="rounded-full border border-border bg-surface px-3 py-1 text-[11px] text-muted-foreground">{reason}</span>)}
        </div>
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="panel p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2"><Siren className="size-4 text-primary" /><h2 className="text-sm font-semibold">O que eu resolveria primeiro</h2></div>
          <div className="grid gap-3">
            {alerts.map((alert) => (
              <article key={alert.id} className={`rounded-xl border p-4 ${alert.severity === "critical" ? "border-destructive/35 bg-destructive/5" : alert.severity === "warning" ? "border-amber-500/30 bg-amber-500/5" : alert.severity === "positive" ? "border-emerald-500/30 bg-emerald-500/5" : "border-primary/20 bg-primary/5"}`}>
                <div className="flex items-start gap-3">
                  <AlertTriangle className={`mt-0.5 size-4 shrink-0 ${alert.severity === "critical" ? "text-destructive" : "text-primary"}`} />
                  <div>
                    <h3 className="text-sm font-medium">{alert.title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{alert.body}</p>
                    <p className="mt-2 text-xs font-medium text-foreground">O que fazer: {alert.action}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <AdvisorAiPanel data={data} entityId={entityId} entityName={entityName} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <section className="panel p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2"><TrendingUp className="size-4 text-primary" /><h2 className="text-sm font-semibold">Onde seus gastos mais aumentaram</h2></div>
          <div className="space-y-3">
            {movements.filter((row) => row.delta > 0).slice(0, 8).map((row) => (
              <div key={row.categoryId} className="rounded-xl border border-border bg-surface p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0"><p className="truncate text-sm font-medium">{row.name}</p><p className="text-[11px] text-muted-foreground">Mês anterior {brl(row.previous)} · agora {brl(row.current)}</p></div>
                  <div className="text-right"><p className="num text-sm text-destructive">+ {brl(row.delta)}</p><p className="text-[10px] text-muted-foreground">{row.deltaPct === null ? "novo gasto" : `+${row.deltaPct.toFixed(0)}%`}</p></div>
                </div>
              </div>
            ))}
            {!movements.some((row) => row.delta > 0) ? <p className="text-sm text-muted-foreground">Nenhuma categoria aumentou em relação ao mês anterior.</p> : null}
          </div>
        </section>

        <section className="panel p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2"><Building2 className="size-4 text-primary" /><h2 className="text-sm font-semibold">Onde está mais apertado</h2></div>
          <div className="space-y-3">
            {entityRisks.slice(0, 10).map((row) => (
              <div key={row.entity.id} className="rounded-xl border border-border bg-surface p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0"><p className="truncate text-sm font-medium">{row.entity.name}</p><p className="text-[11px] text-muted-foreground">Saiu {brl(row.expense)} este mês · {row.criticalAlerts} urgente(s) · {row.warningAlerts} ponto(s) de atenção</p></div>
                  <div className={`rounded-full px-2.5 py-1 text-xs font-semibold ${row.health.score >= 65 ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>{row.health.score}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
