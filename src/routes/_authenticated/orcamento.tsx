import { createFileRoute } from "@tanstack/react-router";
import { createFileRouteHead } from "@/lib/head";
import { useEntityScope } from "@/components/finance/EntityContext";
import { DemoNotice, PageHeader } from "@/components/finance/PageHeader";
import { Td, Th } from "./lancamentos";
import { KpiCard } from "@/components/finance/KpiCard";
import { Progress } from "@/components/ui/progress";
import { brl, budgetRows, monthLabel, pct, today } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/orcamento")({
  head: () =>
    createFileRouteHead(
      "Orçamento mensal — Aurelian Finance",
      "Orçado, realizado, diferença e percentual utilizado por categoria e entidade.",
    ),
  component: Orcamento,
});

function Orcamento() {
  const { data, entityId, entityName } = useEntityScope();
  const ref = today();
  const rows = budgetRows(data, entityId, ref);
  const planned = rows.reduce((s, r) => s + r.planned, 0);
  const actual = rows.reduce((s, r) => s + r.actual, 0);

  return (
    <div>
      <PageHeader
        title="Orçamento mensal"
        subtitle={`${entityName} · ${monthLabel(ref)}`}
      />
      <DemoNotice />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Orçado" value={brl(planned)} tone="gold" />
        <KpiCard label="Realizado" value={brl(actual)} tone="negative" />
        <KpiCard
          label="Diferença"
          value={brl(planned - actual)}
          tone={planned - actual >= 0 ? "positive" : "negative"}
          hint={planned > 0 ? `${pct(actual / planned)} do orçamento utilizado` : undefined}
        />
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <Th>Categoria</Th>
              <Th>Entidade</Th>
              <Th className="text-right">Orçado</Th>
              <Th className="text-right">Realizado</Th>
              <Th className="text-right">Diferença</Th>
              <Th className="w-56">Utilização</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-surface">
                <Td>
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                    {r.categoryName}
                  </span>
                </Td>
                <Td className="text-muted-foreground">{r.entityName}</Td>
                <Td className="num text-right">{brl(r.planned)}</Td>
                <Td className="num text-right">{brl(r.actual)}</Td>
                <Td
                  className={`num text-right font-medium ${
                    r.diff >= 0 ? "text-success" : "text-destructive"
                  }`}
                >
                  {brl(r.diff)}
                </Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <Progress value={Math.min(r.usage * 100, 100)} className="h-1.5" />
                    <span
                      className={`num w-14 text-right text-[11px] ${
                        r.usage > 1 ? "text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {pct(r.usage)}
                    </span>
                  </div>
                </Td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-sm text-muted-foreground">
                  Nenhum orçamento definido para este mês.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
