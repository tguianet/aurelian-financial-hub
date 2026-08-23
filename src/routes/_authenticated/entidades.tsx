import { createFileRoute } from "@tanstack/react-router";
import { createFileRouteHead } from "@/lib/head";
import { useEntityScope } from "@/components/finance/EntityContext";
import { DemoNotice, PageHeader } from "@/components/finance/PageHeader";
import { DemoTag, Td, Th } from "./lancamentos";
import { brl, entitySummaries, monthLabel, pct, today } from "@/lib/finance";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/_authenticated/entidades")({
  head: () =>
    createFileRouteHead(
      "Empresas e entidades — Aurelian Finance",
      "Saldo, receitas, despesas, resultado e participação de cada empresa no consolidado.",
    ),
  component: Entidades;
});

function Entidades() {
  const { data } = useEntityScope();
  const ref = today();
  const rows = entitySummaries(data, ref);
  const total = rows.reduce((s, r) => s + r.balance, 0);

  return (
    <div>
      <PageHeader
        title="Empresas e entidades financeiras"
        subtitle={`Consolidado de ${monthLabel(ref)} · saldo total ${brl(total)}`}
      />
      <DemoNotice />

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <Th>Entidade</Th>
              <Th>Tipo</Th>
              <Th className="text-right">Saldo</Th>
              <Th className="text-right">Receitas do mês</Th>
              <Th className="text-right">Despesas do mês</Th>
              <Th className="text-right">Resultado</Th>
              <Th className="w-48">Participação</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.entity.id} className="border-b border-border/60 last:border-0 hover:bg-surface">
                <Td>
                  <div className="flex items-center gap-2">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: r.entity.color }}
                    />
                    <span className="font-medium">{r.entity.name}</span>
                    {r.entity.is_demo ? <DemoTag /> : null}
                  </div>
                </Td>
                <Td className="text-muted-foreground">
                  {r.entity.kind === "personal" ? "Pessoal" : "Empresa"}
                </Td>
                <Td className="num text-right font-medium">{brl(r.balance)}</Td>
                <Td className="num text-right text-success">{brl(r.income)}</Td>
                <Td className="num text-right text-destructive">{brl(r.expense)}</Td>
                <Td
                  className={`num text-right font-medium ${
                    r.result >= 0 ? "text-success" : "text-destructive"
                  }`}
                >
                  {brl(r.result)}
                </Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <Progress value={r.share * 100} className="h-1.5" />
                    <span className="num w-12 text-right text-[11px] text-muted-foreground">
                      {pct(r.share)}
                    </span>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Transferências entre contas próprias são registradas como movimentação interna e não somam
        receita nem despesa em nenhuma entidade.
      </p>
    </div>
  );
}
