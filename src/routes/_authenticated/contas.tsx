import { createFileRoute } from "@tanstack/react-router";
import { createFileRouteHead } from "@/lib/head";
import { useEntityScope } from "@/components/finance/EntityContext";
import { DemoNotice, PageHeader } from "@/components/finance/PageHeader";
import { DemoTag } from "./lancamentos";
import { accountBalances, brl, buildScope } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/contas")({
  head: () =>
    createFileRouteHead(
      "Contas e carteiras — Aurelian Finance",
      "Saldo realizado de cada conta bancária, caixa e carteira, por entidade financeira.",
    ),
  component: Contas,
});

const TYPE_LABEL: Record<string, string> = {
  checking: "Conta corrente",
  savings: "Poupança",
  cash: "Caixa",
  wallet: "Carteira digital",
  investment: "Investimento",
};

function Contas() {
  const { data, entityId, entityName } = useEntityScope();
  const scope = buildScope(data, entityId);
  const balances = accountBalances(data);
  const accounts = data.accounts.filter((a) => scope.accountIds.has(a.id));
  const total = accounts.reduce((s, a) => s + (balances.get(a.id) ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Contas bancárias e carteiras"
        subtitle={`${entityName} · saldo somado ${brl(total)}`}
      />
      <DemoNotice />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {accounts.map((a) => {
          const entity = data.entities.find((e) => e.id === a.entity_id);
          const balance = balances.get(a.id) ?? 0;
          return (
            <div key={a.id} className="panel p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{a.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {TYPE_LABEL[a.type] ?? a.type}
                    {a.bank ? ` · ${a.bank}` : ""}
                  </p>
                </div>
                {a.is_demo ? <DemoTag /> : null}
              </div>
              <p
                className={`num mt-4 text-2xl font-semibold ${
                  balance >= 0 ? "text-foreground" : "text-destructive"
                }`}
              >
                {brl(balance)}
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {entity?.name} · abertura {brl(Number(a.opening_balance))}
              </p>
            </div>
          );
        })}
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma conta nesta entidade.</p>
        ) : null}
      </div>
    </div>
  );
}
