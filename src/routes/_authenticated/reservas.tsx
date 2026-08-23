import { createFileRoute } from "@tanstack/react-router";
import { createFileRouteHead } from "@/lib/head";
import { useEntityScope } from "@/components/finance/EntityContext";
import { DemoNotice, PageHeader } from "@/components/finance/PageHeader";
import { DemoTag } from "./lancamentos";
import { KpiCard } from "@/components/finance/KpiCard";
import { Progress } from "@/components/ui/progress";
import { brl, buildScope, pct } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/reservas")({
  head: () =>
    createFileRouteHead(
      "Reservas financeiras — Aurelian Finance",
      "Reservas alocadas por entidade, meta, valor atual e impacto no dinheiro livre.",
    ),
  component: Reservas,
});

function Reservas() {
  const { data, entityId, entityName } = useEntityScope();
  const scope = buildScope(data, entityId);
  const rows = data.reserves.filter((r) => scope.matchesEntity(r.entity_id));
  const current = rows.reduce((s, r) => s + Number(r.current_amount), 0);
  const target = rows.reduce((s, r) => s + Number(r.target_amount), 0);

  return (
    <div>
      <PageHeader
        title="Reservas financeiras"
        subtitle={`${entityName} · reservas reduzem o dinheiro livre`}
      />
      <DemoNotice />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Reservado hoje" value={brl(current)} tone="gold" />
        <KpiCard label="Meta total" value={brl(target)} />
        <KpiCard
          label="Cobertura da meta"
          value={target > 0 ? pct(current / target) : "—"}
          tone={current >= target ? "positive" : "neutral"}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const ratio = Number(r.target_amount) > 0 ? Number(r.current_amount) / Number(r.target_amount) : 0;
          const entity = data.entities.find((e) => e.id === r.entity_id);
          return (
            <div key={r.id} className="panel p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{r.name}</p>
                  <p className="text-[11px] text-muted-foreground">{entity?.name}</p>
                </div>
                {r.is_demo ? <DemoTag /> : null}
              </div>
              <p className="num mt-4 text-2xl font-semibold">{brl(Number(r.current_amount))}</p>
              <p className="text-[11px] text-muted-foreground">
                Meta {brl(Number(r.target_amount))}
              </p>
              <Progress value={Math.min(ratio * 100, 100)} className="mt-3 h-1.5" />
              <p className="mt-2 text-[11px] text-muted-foreground">{r.notes}</p>
            </div>
          );
        })}
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma reserva nesta entidade.</p>
        ) : null}
      </div>
    </div>
  );
}
