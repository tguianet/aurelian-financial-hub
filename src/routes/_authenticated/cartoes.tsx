import { createFileRoute } from "@tanstack/react-router";
import { createFileRouteHead } from "@/lib/head";
import { useEntityScope } from "@/components/finance/EntityContext";
import { DemoNotice, PageHeader } from "@/components/finance/PageHeader";
import { DemoTag, StatusPill, Td, Th } from "./lancamentos";
import { Progress } from "@/components/ui/progress";
import { brl, buildScope, cardBill, fmtDate, pct, today } from "@/lib/finance";

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
  const scope = buildScope(data, entityId);
  const cards = data.cards.filter((c) => scope.cardIds.has(c.id));
  const purchases = data.purchases.filter((p) => scope.cardIds.has(p.credit_card_id));
  const ref = today();

  return (
    <div>
      <PageHeader title="Cartões de crédito" subtitle={entityName} />
      <DemoNotice />

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => {
          const bill = cardBill(data, c.id, ref);
          const usage = c.credit_limit > 0 ? bill.open / Number(c.credit_limit) : 0;
          return (
            <div key={c.id} className="panel p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {c.brand} · fecha dia {c.closing_day} · vence dia {c.due_day}
                  </p>
                </div>
                {c.is_demo ? <DemoTag /> : null}
              </div>
              <p className="num mt-4 text-2xl font-semibold text-destructive">{brl(bill.current)}</p>
              <p className="text-[11px] text-muted-foreground">Fatura do mês corrente</p>
              <div className="mt-4 space-y-1.5">
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>Parcelas em aberto: {brl(bill.open)}</span>
                  <span>{pct(usage)} do limite</span>
                </div>
                <Progress value={Math.min(usage * 100, 100)} className="h-1.5" />
                <p className="text-[11px] text-muted-foreground">
                  Limite {brl(Number(c.credit_limit))} · disponível{" "}
                  {brl(Math.max(Number(c.credit_limit) - bill.open, 0))}
                </p>
              </div>
            </div>
          );
        })}
        {cards.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum cartão nesta entidade.</p>
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
              const next = open[0];
              const card = data.cards.find((c) => c.id === p.credit_card_id);
              return (
                <tr key={p.id} className="border-b border-border/60 last:border-0 hover:bg-surface">
                  <Td>
                    <div className="flex items-center gap-2">
                      {p.description}
                      {p.is_demo ? <DemoTag /> : null}
                    </div>
                  </Td>
                  <Td>{card?.name ?? "—"}</Td>
                  <Td>{fmtDate(p.purchase_date)}</Td>
                  <Td className="num text-right">{brl(Number(p.total_amount))}</Td>
                  <Td className="text-right">
                    {items.length - open.length}/{p.installments} pagas
                  </Td>
                  <Td>
                    {next ? (
                      <span className="flex items-center gap-2">
                        {fmtDate(next.due_date)} <StatusPill status={next.status} />
                      </span>
                    ) : (
                      "Quitada"
                    )}
                  </Td>
                  <Td className="num text-right text-destructive">
                    {brl(open.reduce((s, i) => s + Number(i.amount), 0))}
                  </Td>
                </tr>
              );
            })}
            {purchases.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-sm text-muted-foreground">
                  Nenhuma compra parcelada.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
