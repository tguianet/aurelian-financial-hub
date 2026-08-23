import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Ban } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useRefreshFinance } from "@/hooks/useFinance";
import { useEntityScope } from "@/components/finance/EntityContext";
import { DemoNotice, PageHeader } from "@/components/finance/PageHeader";
import { TransactionDialog } from "@/components/finance/TransactionDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  brl,
  buildScope,
  fmtDate,
  KIND_LABEL,
  PAYMENT_LABEL,
  STATUS_LABEL,
  type TxKind,
  type Transaction,
} from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/lancamentos")({
  head: () => ({
    meta: [
      { title: "Lançamentos — Aurelian Finance" },
      {
        name: "description",
        content:
          "Registre entradas, saídas e transferências internas com categoria, conta, vencimento, status, recorrência e parcelamento.",
      },
      { property: "og:title", content: "Lançamentos — Aurelian Finance" },
      { property: "og:description", content: "Ledger completo de entradas, saídas e transferências." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Lancamentos,
});

function Lancamentos() {
  const { data, entityId, entityName } = useEntityScope();
  const { user } = useAuthUser();
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
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (term && !t.description.toLowerCase().includes(term.toLowerCase())) return false;
    return true;
  });

  const cancel = async (t: Transaction) => {
    if (t.is_demo) {
      toast.info("Registros de exemplo não podem ser alterados.");
      return;
    }
    const { error } = await supabase
      .from("transactions")
      .update({ status: "cancelled" })
      .eq("id", t.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (user) {
      await supabase.from("audit_log").insert({
        user_id: user.id,
        table_name: "transactions",
        record_id: t.id,
        action: "cancel",
        details: { description: t.description, amount: t.amount },
      });
    }
    toast.success("Lançamento cancelado (mantido na trilha de auditoria).");
    refresh();
  };

  return (
    <div>
      <PageHeader
        title="Lançamentos"
        subtitle={`${entityName} · ${rows.length} registros`}
        action={<TransactionDialog />}
      />
      <DemoNotice />

      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Buscar descrição…"
          className="w-full sm:w-64"
        />
        <Select value={kindFilter} onValueChange={setKindFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            <SelectItem value="income">Entradas</SelectItem>
            <SelectItem value="expense">Saídas</SelectItem>
            <SelectItem value="transfer">Transferências</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="paid">Pago</SelectItem>
            <SelectItem value="received">Recebido</SelectItem>
            <SelectItem value="pending">Pendente</SelectItem>
            <SelectItem value="overdue">Vencido</SelectItem>
            <SelectItem value="cancelled">Cancelado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <Th>Descrição</Th>
              <Th>Entidade</Th>
              <Th>Categoria</Th>
              <Th>Conta</Th>
              <Th>Pgto.</Th>
              <Th>Vencimento</Th>
              <Th>Status</Th>
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
                      {t.recurrence !== "none" ? " · recorrente" : ""}
                    </span>
                  </Td>
                  <Td>{entity?.name ?? "—"}</Td>
                  <Td>{category?.name ?? (t.kind === "transfer" ? "Interna" : "—")}</Td>
                  <Td>
                    {account?.name ?? "—"}
                    {toAccount ? ` → ${toAccount.name}` : ""}
                  </Td>
                  <Td>{PAYMENT_LABEL[t.payment_method] ?? t.payment_method}</Td>
                  <Td>{fmtDate(t.due_date ?? t.competence_date)}</Td>
                  <Td>
                    <StatusPill status={t.status} />
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
                    {t.status !== "cancelled" && !t.is_demo ? (
                      <Button variant="ghost" size="icon" onClick={() => cancel(t)} title="Cancelar">
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
                  Nenhum lançamento com esses filtros.
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
export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    paid: "bg-success/15 text-success",
    received: "bg-success/15 text-success",
    pending: "bg-warning/15 text-warning",
    overdue: "bg-destructive/15 text-destructive",
    cancelled: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${map[status] ?? "bg-muted"}`}>
      {STATUS_LABEL[status as keyof typeof STATUS_LABEL] ?? status}
    </span>
  );
}
