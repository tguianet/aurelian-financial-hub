import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Printer } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { toast } from "sonner";
import { createFileRouteHead } from "@/lib/head";
import { useEntityScope } from "@/components/finance/EntityContext";
import { PageHeader } from "@/components/finance/PageHeader";
import { Td, Th } from "./lancamentos";
import { KpiCard } from "@/components/finance/KpiCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { brl, categoryBreakdown, entitySummaries, toDate, today } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/relatorios")({
  head: () => createFileRouteHead(
    "Relatórios — Aurelian Finance",
    "Relatórios financeiros por período, empresa e categoria com receitas, despesas e resultado.",
  ),
  component: Relatorios,
});

function firstOfMonth() {
  const d = today();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function csvCell(value: string | number) {
  const text = String(value).replace(/"/g, '""');
  return `"${text}"`;
}

function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function Relatorios() {
  const { data, entityId, entityName } = useEntityScope();
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const validRange = from <= to;
  const rows = useMemo(
    () => validRange ? categoryBreakdown(data, entityId, toDate(from), toDate(to)) : [],
    [data, entityId, from, to, validRange],
  );
  const income = rows.reduce((s, r) => s + r.income, 0);
  const expense = rows.reduce((s, r) => s + r.expense, 0);
  const byEntity = entitySummaries(data, today());

  const exportCsv = () => {
    if (!validRange) { toast.error("Período inválido."); return; }
    const header = ["Categoria", "Receitas", "Despesas", "Resultado"];
    const lines = rows.map((r) => [r.name, r.income.toFixed(2), r.expense.toFixed(2), (r.income - r.expense).toFixed(2)]);
    const content = "\uFEFF" + [header, ...lines].map((line) => line.map(csvCell).join(";")).join("\n");
    downloadFile(content, `aurelian-${from}-a-${to}.csv`, "text/csv;charset=utf-8");
    toast.success("Relatório exportado para Excel/CSV.");
  };

  return (
    <div>
      <PageHeader
        title="Relatórios"
        subtitle={`${entityName} · período selecionado`}
        action={
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={exportCsv}><Download className="size-4" /> Excel/CSV</Button>
            <Button variant="outline" className="gap-2" onClick={() => window.print()}><Printer className="size-4" /> Imprimir/PDF</Button>
          </div>
        }
      />

      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div><Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">De</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" /></div>
        <div><Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Até</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" /></div>
        {!validRange ? <p className="pb-2 text-xs text-destructive">A data inicial deve ser anterior à final.</p> : null}
      </div>

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Receitas no período" value={brl(income)} tone="positive" />
        <KpiCard label="Despesas no período" value={brl(expense)} tone="negative" />
        <KpiCard label="Resultado" value={brl(income - expense)} tone={income - expense >= 0 ? "positive" : "negative"} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="panel p-5 xl:col-span-2">
          <h2 className="mb-4 text-sm font-semibold">Por categoria</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground"><Th>Categoria</Th><Th className="text-right">Receitas</Th><Th className="text-right">Despesas</Th><Th className="text-right">Saldo</Th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} className="border-b border-border/60 last:border-0">
                    <Td><span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ backgroundColor: r.color }} />{r.name}</span></Td>
                    <Td className="num text-right text-success">{brl(r.income)}</Td>
                    <Td className="num text-right text-destructive">{brl(r.expense)}</Td>
                    <Td className={`num text-right ${r.income - r.expense >= 0 ? "text-success" : "text-destructive"}`}>{brl(r.income - r.expense)}</Td>
                  </tr>
                ))}
                {rows.length === 0 ? <tr><td colSpan={4} className="p-8 text-center text-sm text-muted-foreground">Nenhum lançamento liquidado no período.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel p-5">
          <h2 className="mb-2 text-sm font-semibold">Composição de despesas</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={rows.filter((r) => r.expense > 0)} dataKey="expense" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2}>
                  {rows.filter((r) => r.expense > 0).map((r) => <Cell key={r.name} fill={r.color} stroke="var(--card)" />)}
                </Pie>
                <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} formatter={(v: number) => brl(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="panel mt-5 p-5">
        <h2 className="mb-4 text-sm font-semibold">Resultado do mês por empresa</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground"><Th>Entidade</Th><Th className="text-right">Receitas</Th><Th className="text-right">Despesas</Th><Th className="text-right">Resultado</Th></tr></thead>
            <tbody>{byEntity.map((r) => <tr key={r.entity.id} className="border-b border-border/60 last:border-0"><Td>{r.entity.name}</Td><Td className="num text-right text-success">{brl(r.income)}</Td><Td className="num text-right text-destructive">{brl(r.expense)}</Td><Td className={`num text-right font-medium ${r.result >= 0 ? "text-success" : "text-destructive"}`}>{brl(r.result)}</Td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
