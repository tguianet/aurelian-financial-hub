import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { createFileRouteHead } from "@/lib/head";
import { supabase } from "@/integrations/supabase/client";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { useRefreshFinance } from "@/hooks/useFinance";
import { useEntityScope } from "@/components/finance/EntityContext";
import { PageHeader } from "@/components/finance/PageHeader";
import { TransactionDialog } from "@/components/finance/TransactionDialog";
import { StatusPill, Td, Th } from "./lancamentos";
import { KpiCard } from "@/components/finance/KpiCard";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { brl, buildScope, displayOpenStatus, fmtDate, isOpen, type Transaction } from "@/lib/finance";
import { localDateIso } from "@/lib/date";
import { addMoney } from "@/lib/money";
import { rpcErrorMessage } from "@/lib/rpc-error";

export const Route = createFileRoute("/_authenticated/pendencias")({
  head: () =>
    createFileRouteHead(
      "Contas a pagar e receber — Aurelian Finance",
      "Pendências, vencimentos e liquidações com status pendente, pago, recebido, vencido e cancelado.",
    ),
  component: Pendencias,
});

function Pendencias() {
  const { data, entityId, entityName } = useEntityScope();
  const { canWrite } = useFinanceAccess();
  const refresh = useRefreshFinance();
  const [tab, setTab] = useState("payables");
  const scope = buildScope(data, entityId);

  const open = data.transactions.filter(
    (t) => t.kind !== "transfer" && scope.matchesEntity(t.entity_id) && isOpen(t),
  );
  const payables = open.filter((t) => t.kind === "expense");
  const receivables = open.filter((t) => t.kind === "income");
  const rows = tab === "payables" ? payables : receivables;

  const settle = async (t: Transaction) => {
    if (t.is_demo) {
      toast.info("Registros de exemplo não podem ser alterados.");
      return;
    }
    if (!canWrite) {
      toast.error("Seu acesso é somente leitura.");
      return;
    }
    const { error } = await supabase.rpc("settle_transaction", {
      p_id: t.id,
      p_paid_at: localDateIso(),
    });
    if (error) {
      toast.error(rpcErrorMessage(error, "Não foi possível liquidar o lançamento."));
      return;
    }
    toast.success(t.kind === "income" ? "Recebimento confirmado." : "Pagamento confirmado.");
    refresh();
  };

  const sum = (list: Transaction[]) => list.reduce((s, t) => addMoney(s, Number(t.amount)), 0);

  return (
    <div>
      <PageHeader
        title="Contas a pagar e receber"
        subtitle={entityName}
        action={<TransactionDialog />}
      />

      <div className="mb-4 rounded-lg border border-border bg-surface/60 px-4 py-3 text-xs text-muted-foreground">
        Para criar uma conta futura, use <strong className="text-foreground">Novo lançamento</strong> e deixe o status como Pendente ou Vencido. Entradas viram contas a receber; saídas viram contas a pagar.
        Faturas de cartão não aparecem aqui: pague-as em{" "}
        <Link to="/cartoes" className="font-medium text-primary underline-offset-2 hover:underline">Cartões</Link>
        {" "}para não lançar a despesa duas vezes.
      </div>

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total a pagar" value={brl(sum(payables))} tone="negative" />
        <KpiCard
          label="Vencido a pagar"
          value={brl(sum(payables.filter((t) => displayOpenStatus(t.status, t.due_date ?? t.competence_date) === "overdue")))}
          tone="negative"
        />
        <KpiCard label="Total a receber" value={brl(sum(receivables))} tone="positive" />
        <KpiCard
          label="Vencido a receber"
          value={brl(sum(receivables.filter((t) => displayOpenStatus(t.status, t.due_date ?? t.competence_date) === "overdue")))}
          tone="negative"
        />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mb-4">
        <TabsList>
          <TabsTrigger value="payables">A pagar ({payables.length})</TabsTrigger>
          <TabsTrigger value="receivables">A receber ({receivables.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <Th>Descrição</Th>
              <Th>Entidade</Th>
              <Th>Categoria</Th>
              <Th>Vencimento</Th>
              <Th>Status</Th>
              <Th className="text-right">Valor</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {[...rows]
              .sort((a, b) =>
                (a.due_date ?? a.competence_date).localeCompare(b.due_date ?? b.competence_date),
              )
              .map((t) => (
                <tr key={t.id} className="border-b border-border/60 last:border-0 hover:bg-surface">
                  <Td>{t.description}</Td>
                  <Td>{data.entities.find((e) => e.id === t.entity_id)?.name ?? "—"}</Td>
                  <Td>{data.categories.find((c) => c.id === t.category_id)?.name ?? "—"}</Td>
                  <Td>{fmtDate(t.due_date ?? t.competence_date)}</Td>
                  <Td><StatusPill status={t.status} dueDate={t.due_date ?? t.competence_date} /></Td>
                  <Td className={`num text-right font-medium ${t.kind === "income" ? "text-success" : "text-destructive"}`}>
                    {brl(Number(t.amount))}
                  </Td>
                  <Td className="text-right">
                    {!t.is_demo && canWrite ? (
                      <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => settle(t)}>
                        <Check className="size-3.5" /> Liquidar
                      </Button>
                    ) : null}
                  </Td>
                </tr>
              ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-sm text-muted-foreground">Nenhuma pendência.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
