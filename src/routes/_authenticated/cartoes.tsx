import { createFileRoute, Link } from "@tanstack/react-router";
import { createFileRouteHead } from "@/lib/head";
import { useEntityScope } from "@/components/finance/EntityContext";
import { PageHeader } from "@/components/finance/PageHeader";
import { CreditCardActions, NewPurchaseDialog } from "@/components/finance/CreditCardActions";
import { BillDetailsDialog, PayBillDialog } from "@/components/finance/CreditCardPayments";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { StatusPill, Td, Th } from "./lancamentos";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { brl, buildScope, cardBill, fmtDate, monthDueDate, pct, today } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/cartoes")({
  head: () =>
    createFileRouteHead(
      "Cartões de crédito — Aurelian Finance",
      "Limite, fatura atual, vencimento e compras parceladas de cada cartão por entidade.",
    ),
  component: Cartoes,
});

function Cartoes() {
  const { data, entityId, entityName } = useEntityScope();
  const { canWrite } = useFinanceAccess();
  const scope = buildScope(data, entityId);
  const cards = data.cards.filter((c) => scope.cardIds.has(c.id));
  const purchases = data.purchases.filter((p) => scope.cardIds.has(p.credit_card_id));
  const ref = today();
  const nextRef = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);

  return (
    <div>
      <PageHeader title="Cartões de crédito" subtitle={entityName} action={<CreditCardActions />} />

      <div className="mb-4 rounded-lg border border-border bg-surface/60 px-4 py-3 text-xs text-muted-foreground">
        A compra no cartão é a despesa (competência na data da compra). Pagar parcela ou fatura debita a conta bancária e
        não entra de novo no resultado nem em{" "}
        <Link to="/pendencias" className="font-medium text-primary underline-offset-2 hover:underline">contas a pagar</Link>.
        Parcelas em aberto continuam na projeção até serem pagas.
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => {
          const bill = cardBill(data, c.id, ref);
          const usage = c.credit_limit > 0 ? bill.open / Number(c.credit_limit) : 0;
          const available = Math.max(Number(c.credit_limit) - bill.open, 0);
          const entity = data.entities.find((e) => e.id === c.entity_id);
          const account = data.accounts.find((a) => a.id === c.account_id);
          return (
            <div key={c.id} className={`panel p-5 ${!c.active ? "opacity-55" : ""}`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {[c.brand, entity?.name].filter(Boolean).join(" · ") || "Sem bandeira"}
                  </p>
                </div>
                <span className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground">
                  {c.active ? "Ativo" : "Inativo"}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-[11px] text-muted-foreground">Limite</p>
                  <p className="num font-medium">{brl(Number(c.credit_limit))}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Disponível</p>
                  <p className="num font-medium">{brl(available)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Fatura atual</p>
                  <p className="num text-lg font-semibold text-destructive">{brl(bill.current)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Vencimento</p>
                  <p className="font-medium">{fmtDate(monthDueDate(ref, c.due_day))}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Próxima fatura</p>
                  <p className="num font-medium">{brl(bill.next)}</p>
                  <p className="text-[10px] text-muted-foreground">{fmtDate(monthDueDate(nextRef, c.due_day))}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Parcelas futuras</p>
                  <p className="num font-medium">{brl(bill.future)}</p>
                  <p className="text-[10px] text-muted-foreground">{bill.futureCount} parcela(s)</p>
                </div>
              </div>

              <div className="mt-4 space-y-1.5">
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>Em aberto: {brl(bill.open)}</span>
                  <span>{pct(usage)} do limite</span>
                </div>
                <Progress value={Math.min(usage * 100, 100)} className="h-1.5" />
                <p className="text-[11px] text-muted-foreground">
                  Fecha dia {c.closing_day}{account ? ` · paga por ${account.name}` : ""}
                </p>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {canWrite ? (
                  <NewPurchaseDialog defaultCardId={c.id}>
                    <Button size="sm">Nova compra</Button>
                  </NewPurchaseDialog>
                ) : null}
                {canWrite ? <PayBillDialog card={c} /> : null}
                <BillDetailsDialog card={c} />
              </div>
            </div>
          );
        })}
        {cards.length === 0 ? (
          <div className="panel p-5 text-sm text-muted-foreground">
            Nenhum cartão cadastrado nesta visão.
            {canWrite ? <> Use <strong className="text-foreground">Novo cartão</strong> para começar.</> : null}
          </div>
        ) : null}
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold">Compras parceladas</h2>
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <Th>Compra</Th>
              <Th>Cartão</Th>
              <Th>Data</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">Parcelas</Th>
              <Th>Próxima parcela</Th>
              <Th className="text-right">Em aberto</Th>
            </tr>
          </thead>
          <tbody>
            {purchases.map((p) => {
              const items = data.installments.filter((i) => i.purchase_id === p.id);
              const open = items.filter((i) => i.status === "pending" || i.status === "overdue");
              const next = [...open].sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
              const card = data.cards.find((c) => c.id === p.credit_card_id);
              return (
                <tr key={p.id} className="border-b border-border/60 last:border-0 hover:bg-surface">
                  <Td>{p.description}</Td>
                  <Td>{card?.name ?? "—"}</Td>
                  <Td>{fmtDate(p.purchase_date)}</Td>
                  <Td className="num text-right">{brl(Number(p.total_amount))}</Td>
                  <Td className="text-right">{items.length - open.length}/{p.installments} pagas</Td>
                  <Td>
                    {next ? (
                      <span className="flex items-center gap-2">{fmtDate(next.due_date)} <StatusPill status={next.status} dueDate={next.due_date} /></span>
                    ) : (
                      "Quitada"
                    )}
                  </Td>
                  <Td className="num text-right text-destructive">{brl(open.reduce((s, i) => s + Number(i.amount), 0))}</Td>
                </tr>
              );
            })}
            {purchases.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-sm text-muted-foreground">Nenhuma compra parcelada.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
