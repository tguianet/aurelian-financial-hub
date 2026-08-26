import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Ban } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { useRefreshFinance } from "@/hooks/useFinance";
import { useEntityScope } from "@/components/finance/EntityContext";
import { DemoNotice, PageHeader } from "@/components/finance/PageHeader";
import { TransactionDialog } from "@/components/finance/TransactionDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { rpcErrorMessage } from "@/lib/rpc-error";
import {
  brl,
  buildScope,
  displayOpenStatus,
  fmtDate,
  isCardCashMovement,
  KIND_LABEL,
  PAYMENT_LABEL,
  STATUS_LABEL,
  type TxKind,
  type Transaction,
} from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/lancamentos")({
  head: () => ({
    meta: [
      { title: "Movimentações — Aurelian Finance" },
      {
        name: "description",
        content: "Veja tudo o que entrou, saiu ou foi transferido entre suas contas.",
      },
      { property: "og:title", content: "Movimentações — Aurelian Finance" },
      { property: "og:description", content: "Tudo o que movimentou seu dinheiro em um só lugar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Lancamentos,
});

function Lancamentos() {
  const { data, entityId, entityName } = useEntityScope();
  const { canWrite } = useFinanceAccess();
  const refresh = useRefreshFinance();
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [term, setTerm] = useState("");

  const scope = buildScope(data, entityId);
  const rows = data.transactions.filter((t) => {
    const inScope =
      t.kind === "transfer"
        ? (t.account_id && scope.accountIds.has(t.account_id)) ||
          (t.to_account_id && scope.accountIds.has(t.to_account_id))
        : scope.matchesEntity(t.entity_id);
    if (!inScope) return false;
    if (kindFilter !== "all" && t.kind !== kindFilter) return false;
    if (statusFilter !== "all" && displayOpenStatus(t.status, t.due_date ?? t.competence_date) !== statusFilter) return false;
    if (term && !t.description.toLowerCase().includes(term.toLowerCase())) return false;
    return true;
  });

  const cancel = async (t: Transaction) => {
    if (t.is_demo) {
      toast.info("Registros de exemplo não podem ser alterados.");
      return;
    }
    if (!canWrite) {
      toast.error("Seu acesso é somente leitura.");
      return;
    }
    const { error } = await supabase.rpc("cancel_transaction", { p_id: t.id });
    if (error) {
      toast.error(rpcErrorMessage(error, "Não foi possível cancelar essa movimentação."));
      return;
    }
    toast.success("Movimentação cancelada. O histórico foi mantido para sua segurança.");
    refresh();
  };

  return (
    <div>
      <PageHeader
        title="Movimentações"
        subtitle={`${entityName} · ${rows.length} registros encontrados`}
        action={<TransactionDialog />}
      />
      <DemoNotice />

      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Buscar por nome ou descrição…"
          className="w-full sm:w-64"
        />
        <Select value={kindFilter} onValueChange={setKindFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tudo</SelectItem>
            <SelectItem value="income">Dinheiro que entrou</SelectItem>
            <SelectItem value="expense">Dinheiro que saiu</SelectItem>
            <SelectItem value="transfer">Entre minhas contas</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Qualquer situação</SelectItem>
            <SelectItem value="paid">Já pago</SelectItem>
            <SelectItem value="received">Já recebido</SelectItem>
            <SelectItem value="pending">Ainda pendente</SelectItem>
            <SelectItem value="overdue">Atrasado</SelectItem>
            <SelectItem value="cancelled">Cancelado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <Th>O que foi</Th>
              <Th>De onde</Th>
              <Th>Categoria</Th>
              <Th>Conta</Th>
              <Th>Como pagou</Th>
              <Th>Data limite</Th>
              <Th>Situação</Th>
              <Th className="text-right">Valor</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const entity = data.entities.find((e) => e.id === t.entity_id);
              const category = data.categories.find((c) => c.id === t.category_id);
              const account = data.accounts.find((a) => a.id === t.account_id);
              const toAccount = data.accounts.find((a) => a.id === t.to_account_id);
              return (
                <tr key={t.id} className="border-b border-border/60 last:border-0 hover:bg-surface">
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className={t.status === "cancelled" ? "line-through opacity-60" : ""}>
                        {t.description}
                      </span>
                      {t.is_demo ? <DemoTag /> : null}
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {KIND_LABEL[t.kind as TxKind]}
                      {t.installment_total ? ` · parcela ${t.installment_no}/${t.installment_total}` : ""}
                      {t.recurring_transaction_id || t.recurrence !== "none" ? " · recorrente" : ""}
                    </span>
                  </Td>
                  <Td>{entity?.name ?? "—"}</Td>
                  <Td>{category?.name ?? (t.kind === "transfer" ? "Entre contas" : "—")}</Td>
                  <Td>
                    {account?.name ?? "—"}
                    {toAccount ? ` → ${toAccount.name}` : ""}
                  </Td>
                  <Td>{PAYMENT_LABEL[t.payment_method] ?? t.payment_method}</Td>
                  <Td>{fmtDate(t.due_date ?? t.competence_date)}</Td>
                  <Td>
                    <StatusPill status={t.status} dueDate={t.due_date ?? t.competence_date} />
                  </Td>
                  <Td className="text-right">
                    <span
                      className={`num font-medium ${
                        t.kind === "income"
                          ? "text-success"
                          : t.kind === "expense"
                            ? "text-destructive"
                            : "text-muted-foreground"
                      }`}
                    >
                      {t.kind === "expense" ? "−" : t.kind === "income" ? "+" : "↔"} {brl(Number(t.amount))}
                    </span>
                  </Td>
                  <Td className="text-right">
                    {t.status !== "cancelled" && !t.is_demo && !isCardCashMovement(t) && canWrite ? (
                      <Button variant="ghost" size="icon" onClick={() => cancel(t)} title="Cancelar movimentação">
                        <Ban className="size-4" />
                      </Button>
                    ) : null}
                  </Td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-sm text-muted-foreground">
                  Não encontrei nenhuma movimentação com esses filtros.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-3 font-medium ${className}`}>{children}</th>;
}
export function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-top ${className}`}>{children}</td>;
}
export function DemoTag() {
  return (
    <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">
      Exemplo
    </span>
  );
}
export function StatusPill({ status, dueDate }: { status: string; dueDate?: string | null }) {
  const shown = dueDate !== undefined ? displayOpenStatus(status, dueDate) : status;
  const map: Record<string, string> = {
    paid: "bg-success/15 text-success",
    received: "bg-success/15 text-success",
    pending: "bg-warning/15 text-warning",
    overdue: "bg-destructive/15 text-destructive",
    cancelled: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${map[shown] ?? "bg-muted"}`}>
      {STATUS_LABEL[shown as keyof typeof STATUS_LABEL] ?? shown}
    </span>
  );
}
