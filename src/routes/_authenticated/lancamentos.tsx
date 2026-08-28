import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Ban, CalendarDays, List } from "lucide-react";
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
import { firstOfMonthIso, localDateIso } from "@/lib/date";
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

type HistoryItem = {
  id: string;
  date: string;
  type: "transaction" | "card_purchase";
  kind: "income" | "expense" | "transfer";
  description: string;
  amount: number;
  entityName: string;
  categoryName: string;
  accountLabel: string;
  paymentLabel: string;
  statusLabel: string;
  statusTone: string;
  contributesToResult: boolean;
  transaction?: Transaction;
};

function Lancamentos() {
  const { data, entityId, entityName } = useEntityScope();
  const { canWrite } = useFinanceAccess();
  const refresh = useRefreshFinance();
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [term, setTerm] = useState("");
  const [view, setView] = useState<"list" | "history">("list");
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(localDateIso());

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

  const historyItems = useMemo<HistoryItem[]>(() => {
    const normalizedTerm = term.trim().toLowerCase();
    const txItems: HistoryItem[] = data.transactions.flatMap((t) => {
      const inScope =
        t.kind === "transfer"
          ? Boolean(
              (t.account_id && scope.accountIds.has(t.account_id)) ||
              (t.to_account_id && scope.accountIds.has(t.to_account_id)),
            )
          : scope.matchesEntity(t.entity_id);
      if (!inScope) return [];
      if (t.competence_date < from || t.competence_date > to) return [];
      if (kindFilter !== "all" && t.kind !== kindFilter) return [];
      const shownStatus = displayOpenStatus(t.status, t.due_date ?? t.competence_date);
      if (statusFilter !== "all" && shownStatus !== statusFilter) return [];
      if (normalizedTerm && !t.description.toLowerCase().includes(normalizedTerm)) return [];

      const entity = data.entities.find((e) => e.id === t.entity_id);
      const category = data.categories.find((c) => c.id === t.category_id);
      const account = data.accounts.find((a) => a.id === t.account_id);
      const toAccount = data.accounts.find((a) => a.id === t.to_account_id);

      return [{
        id: `tx-${t.id}`,
        date: t.competence_date,
        type: "transaction",
        kind: t.kind,
        description: t.description,
        amount: Number(t.amount),
        entityName: entity?.name ?? "—",
        categoryName: category?.name ?? (t.kind === "transfer" ? "Entre contas" : "—"),
        accountLabel: `${account?.name ?? "—"}${toAccount ? ` → ${toAccount.name}` : ""}`,
        paymentLabel: PAYMENT_LABEL[t.payment_method] ?? t.payment_method,
        statusLabel: STATUS_LABEL[shownStatus as keyof typeof STATUS_LABEL] ?? shownStatus,
        statusTone: shownStatus,
        contributesToResult: t.status !== "cancelled" && t.kind !== "transfer" && !t.deleted_at,
        transaction: t,
      }];
    });

    const cardItems: HistoryItem[] = data.purchases.flatMap((purchase) => {
      if (!scope.matchesEntity(purchase.entity_id)) return [];
      if (purchase.purchase_date < from || purchase.purchase_date > to) return [];
      if (kindFilter !== "all" && kindFilter !== "expense") return [];
      if (normalizedTerm && !purchase.description.toLowerCase().includes(normalizedTerm)) return [];

      const installments = data.installments.filter((item) => item.purchase_id === purchase.id);
      const activeInstallments = installments.filter((item) => item.status !== "cancelled");
      const hasOverdue = activeInstallments.some((item) => item.status === "overdue");
      const paidCount = activeInstallments.filter((item) => item.status === "paid").length;
      const openCount = activeInstallments.filter((item) => item.status === "pending" || item.status === "overdue").length;
      const allCancelled = installments.length > 0 && activeInstallments.length === 0;
      const fullyPaid = activeInstallments.length > 0 && openCount === 0 && paidCount === activeInstallments.length;

      const derivedStatus = allCancelled ? "cancelled" : hasOverdue ? "overdue" : fullyPaid ? "paid" : "pending";
      if (statusFilter !== "all" && statusFilter !== derivedStatus) return [];

      const entity = data.entities.find((e) => e.id === purchase.entity_id);
      const category = data.categories.find((c) => c.id === purchase.category_id);
      const card = data.cards.find((c) => c.id === purchase.credit_card_id);
      const statusLabel = allCancelled
        ? "Parcelas canceladas"
        : fullyPaid
          ? "Fatura quitada"
          : hasOverdue
            ? paidCount > 0
              ? `Fatura parcial · ${paidCount}/${activeInstallments.length} pagas · há atraso`
              : "Fatura em atraso"
            : paidCount > 0
              ? `Fatura parcial · ${paidCount}/${activeInstallments.length} pagas`
              : purchase.installments > 1
                ? `${purchase.installments}x · fatura pendente`
                : "Fatura pendente";

      return [{
        id: `card-${purchase.id}`,
        date: purchase.purchase_date,
        type: "card_purchase",
        kind: "expense",
        description: purchase.description,
        amount: Number(purchase.total_amount),
        entityName: entity?.name ?? "—",
        categoryName: category?.name ?? "—",
        accountLabel: card?.name ?? "Cartão",
        paymentLabel: "Cartão de crédito",
        statusLabel,
        statusTone: derivedStatus,
        contributesToResult: !allCancelled,
      }];
    });

    return [...txItems, ...cardItems].sort((a, b) => b.date.localeCompare(a.date) || a.description.localeCompare(b.description));
  }, [data, scope, from, to, kindFilter, statusFilter, term]);

  const historyGroups = useMemo(() => {
    const groups = new Map<string, HistoryItem[]>();
    for (const item of historyItems) {
      const current = groups.get(item.date) ?? [];
      current.push(item);
      groups.set(item.date, current);
    }
    return Array.from(groups.entries()).map(([date, items]) => {
      const economicItems = items.filter((item) => item.contributesToResult);
      return {
        date,
        items,
        income: economicItems.filter((item) => item.kind === "income").reduce((sum, item) => sum + item.amount, 0),
        expense: economicItems.filter((item) => item.kind === "expense").reduce((sum, item) => sum + item.amount, 0),
      };
    });
  }, [historyItems]);

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
        subtitle={`${entityName} · ${view === "history" ? `${historyItems.length} itens no histórico` : `${rows.length} registros encontrados`}`}
        action={<TransactionDialog />}
      />
      <DemoNotice />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-border bg-surface p-1">
          <Button variant={view === "list" ? "secondary" : "ghost"} size="sm" className="gap-2" onClick={() => setView("list")}>
            <List className="size-4" /> Lista
          </Button>
          <Button variant={view === "history" ? "secondary" : "ghost"} size="sm" className="gap-2" onClick={() => setView("history")}>
            <CalendarDays className="size-4" /> Histórico por data
          </Button>
        </div>
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
            <SelectItem value="paid">Já pago / quitado</SelectItem>
            <SelectItem value="received">Já recebido</SelectItem>
            <SelectItem value="pending">Ainda pendente</SelectItem>
            <SelectItem value="overdue">Atrasado</SelectItem>
            <SelectItem value="cancelled">Cancelado</SelectItem>
          </SelectContent>
        </Select>
        {view === "history" ? (
          <>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="Data inicial" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="Data final" />
          </>
        ) : null}
      </div>

      {view === "list" ? (
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
      ) : (
        <div className="space-y-4">
          {from > to ? (
            <div className="panel p-6 text-sm text-destructive">A data inicial precisa ser anterior ou igual à data final.</div>
          ) : null}
          {from <= to && historyGroups.map((group) => (
            <section key={group.date} className="panel overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface/60 px-4 py-3">
                <div>
                  <p className="font-semibold">{fmtDate(group.date)}</p>
                  <p className="text-[11px] text-muted-foreground">{group.items.length} movimentação(ões)</p>
                </div>
                <div className="flex gap-4 text-xs">
                  <span className="text-success">Entrou {brl(group.income)}</span>
                  <span className="text-destructive">Saiu {brl(group.expense)}</span>
                  <span className={group.income - group.expense >= 0 ? "text-success" : "text-destructive"}>
                    Resultado {brl(group.income - group.expense)}
                  </span>
                </div>
              </div>
              <div className="divide-y divide-border/60">
                {group.items.map((item) => (
                  <div key={item.id} className="grid gap-3 px-4 py-3 text-sm hover:bg-surface md:grid-cols-[minmax(220px,1.6fr)_1fr_1fr_1fr_auto] md:items-center">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className={item.transaction?.status === "cancelled" || item.statusTone === "cancelled" ? "line-through opacity-60" : "font-medium"}>{item.description}</p>
                        {item.type === "card_purchase" ? (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">Cartão</span>
                        ) : null}
                      </div>
                      <p className="text-[11px] text-muted-foreground">{item.entityName} · {item.categoryName}</p>
                    </div>
                    <div className="text-xs text-muted-foreground">{item.accountLabel}</div>
                    <div className="text-xs text-muted-foreground">{item.paymentLabel}</div>
                    <div>
                      {item.type === "transaction" && item.transaction ? (
                        <StatusPill status={item.transaction.status} dueDate={item.transaction.due_date ?? item.transaction.competence_date} />
                      ) : (
                        <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                          item.statusTone === "paid"
                            ? "bg-success/15 text-success"
                            : item.statusTone === "overdue"
                              ? "bg-destructive/15 text-destructive"
                              : item.statusTone === "cancelled"
                                ? "bg-muted text-muted-foreground"
                                : "bg-warning/15 text-warning"
                        }`}>{item.statusLabel}</span>
                      )}
                    </div>
                    <div className={`num text-right font-semibold ${!item.contributesToResult ? "text-muted-foreground line-through" : item.kind === "income" ? "text-success" : item.kind === "expense" ? "text-destructive" : "text-muted-foreground"}`}>
                      {item.kind === "expense" ? "−" : item.kind === "income" ? "+" : "↔"} {brl(item.amount)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {from <= to && historyGroups.length === 0 ? (
            <div className="panel p-8 text-center text-sm text-muted-foreground">
              Não encontrei movimentações nesse período.
            </div>
          ) : null}
        </div>
      )}
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
