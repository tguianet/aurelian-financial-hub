import { createFileRoute } from "@tanstack/react-router";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { createFileRouteHead } from "@/lib/head";
import { useEntityScope } from "@/components/finance/EntityContext";
import { DemoNotice, PageHeader } from "@/components/finance/PageHeader";
import { Td, Th } from "./lancamentos";
import { brl, compact, computeKpis, projection, today } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/projecao")({
  head: () =>
    createFileRouteHead(
      "Projeção de caixa — Aurelian Finance",
      "Projeção de saldo para 7, 15, 30, 60 e 90 dias considerando pendências e parcelas de cartão.",
    ),
  component: Projecao,
});

function Projecao() {
  const { data, entityId, entityName } = useEntityScope();
  const ref = today();
  const rows = projection(data, entityId, ref);
  const k = computeKpis(data, entityId, ref);

  return (
    <div>
      <PageHeader
        title="Projeção de caixa"
        subtitle={`${entityName} · saldo atual ${brl(k.balance)}`}
      />
      <DemoNotice />

      <div className="mb-4 rounded-lg border border-border bg-surface/60 px-4 py-3 text-xs text-muted-foreground">
        Parcelas de cartão pendentes e ocorrências de recorrência ainda não geradas entram como movimento de caixa na data prevista. Ocorrências já materializadas entram só pelo lançamento — a definição não é somada de novo.
      </div>

      <div className="panel p-5">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows}>
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
                cursor={{ fill: "var(--surface-2)" }}
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  fontSize: 12,
                }}
                formatter={(v: number) => brl(v)}
              />
              <Bar dataKey="inflow" name="Entradas previstas" fill="var(--success)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="outflow" name="Saídas previstas" fill="var(--destructive)" radius={[6, 6, 0, 0]} />
              <Line
                type="monotone"
                dataKey="balance"
                name="Saldo projetado"
                stroke="var(--gold)"
                strokeWidth={2.5}
                dot={{ r: 3 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel mt-5 overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <Th>Janela</Th>
              <Th className="text-right">Entradas previstas</Th>
              <Th className="text-right">Saídas previstas</Th>
              <Th className="text-right">Fluxo líquido</Th>
              <Th className="text-right">Saldo projetado</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.days} className="border-b border-border/60 last:border-0 hover:bg-surface">
                <Td className="font-medium">{r.label}</Td>
                <Td className="num text-right text-success">{brl(r.inflow)}</Td>
                <Td className="num text-right text-destructive">{brl(r.outflow)}</Td>
                <Td
                  className={`num text-right ${
                    r.inflow - r.outflow >= 0 ? "text-success" : "text-destructive"
                  }`}
                >
                  {brl(r.inflow - r.outflow)}
                </Td>
                <Td
                  className={`num text-right font-semibold ${
                    r.balance >= 0 ? "text-primary" : "text-destructive"
                  }`}
                >
                  {brl(r.balance)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Pendências futuras entram apenas na projeção — nunca no saldo realizado. Transferências
        internas são ignoradas por não alterarem o caixa consolidado.
      </p>
    </div>
  );
}
