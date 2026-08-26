import { useMemo, useState } from "react";
import { Calculator, ShieldAlert, Sparkles } from "lucide-react";
import { brl } from "@/lib/finance";
import { parseBRLMoney, roundMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";

export type DecisionProjection = {
  days: number;
  balance: number;
  inflow: number;
  outflow: number;
};

type Props = {
  entityName: string;
  balance: number;
  freeCash: number;
  projections: DecisionProjection[];
  onAskAurelian?: (question: string) => void;
};

export function DecisionSimulator({ entityName, balance, freeCash, projections, onAskAurelian }: Props) {
  const [rawAmount, setRawAmount] = useState("");
  const amount = parseBRLMoney(rawAmount) ?? 0;
  const hasSimulation = amount > 0;

  const simulated = useMemo(
    () => projections.map((item) => ({ ...item, simulatedBalance: roundMoney(item.balance - amount) })),
    [amount, projections],
  );

  const freeAfter = roundMoney(freeCash - amount);
  const balanceAfter = roundMoney(balance - amount);
  const critical = hasSimulation && freeAfter < 0;
  const consumesMostFreeCash = hasSimulation && freeCash > 0 && amount >= freeCash * 0.7;

  const verdict = !hasSimulation
    ? "Informe um valor para ver o impacto antes de decidir."
    : critical
      ? `Esse gasto deixaria o dinheiro livre em ${brl(freeAfter)}. Eu trataria a decisão como arriscada com os compromissos atuais.`
      : consumesMostFreeCash
        ? `O gasto cabe, mas consumiria uma parte grande do dinheiro livre. Restariam ${brl(freeAfter)} de margem estimada.`
        : `Pelos compromissos registrados hoje, o gasto cabe no cenário. Restariam ${brl(freeAfter)} de dinheiro livre estimado.`;

  const askQuestion = () => {
    if (!hasSimulation || !onAskAurelian) return;
    onAskAurelian(`Se eu gastar ${brl(amount)} hoje em ${entityName}, analise o impacto no meu caixa para 7, 15, 30, 60 e 90 dias e diga se a decisão é prudente considerando meus compromissos atuais.`);
  };

  return (
    <section className="panel mt-4 overflow-hidden border-primary/20 p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <Calculator className="size-4" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">Simulador de decisão</span>
          </div>
          <h2 className="mt-1 text-base font-semibold">Antes de gastar, veja como seu caixa ficaria</h2>
          <p className="mt-1 text-xs text-muted-foreground">É apenas uma simulação. Nenhum lançamento ou saldo real é alterado.</p>
        </div>
        <Sparkles className="size-5 shrink-0 text-primary" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[0.75fr_1.25fr]">
        <div className="rounded-xl border border-border bg-surface p-4">
          <label htmlFor="decision-amount" className="text-xs font-medium">Se eu gastar hoje</label>
          <div className="mt-2 flex items-center rounded-lg border border-border bg-background px-3">
            <span className="text-sm text-muted-foreground">R$</span>
            <input
              id="decision-amount"
              inputMode="decimal"
              value={rawAmount}
              onChange={(event) => setRawAmount(event.target.value)}
              placeholder="5.000,00"
              className="h-11 min-w-0 flex-1 bg-transparent px-2 text-base outline-none"
            />
          </div>

          <div className={`mt-3 rounded-lg border p-3 ${critical ? "border-destructive/25 bg-destructive/5" : "border-primary/20 bg-primary/5"}`}>
            <div className="flex items-start gap-2">
              {critical ? <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" /> : <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />}
              <p className="text-xs leading-relaxed">{verdict}</p>
            </div>
          </div>

          {hasSimulation ? (
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-border p-3"><span className="block text-muted-foreground">Saldo logo após</span><strong className={`num mt-1 block ${balanceAfter < 0 ? "text-destructive" : ""}`}>{brl(balanceAfter)}</strong></div>
              <div className="rounded-lg border border-border p-3"><span className="block text-muted-foreground">Dinheiro livre após</span><strong className={`num mt-1 block ${freeAfter < 0 ? "text-destructive" : "text-success"}`}>{brl(freeAfter)}</strong></div>
            </div>
          ) : null}

          {onAskAurelian ? <Button className="mt-3 w-full" variant="outline" disabled={!hasSimulation} onClick={askQuestion}>Pedir análise ao Aurelian IA</Button> : null}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {simulated.map((item) => (
            <div key={item.days} className={`rounded-xl border p-3 ${hasSimulation && item.simulatedBalance < 0 ? "border-destructive/25 bg-destructive/5" : "border-border bg-surface"}`}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{item.days} dias</p>
              <p className={`num mt-2 text-base font-semibold ${hasSimulation && item.simulatedBalance < 0 ? "text-destructive" : ""}`}>{brl(hasSimulation ? item.simulatedBalance : item.balance)}</p>
              {hasSimulation ? <p className="mt-1 text-[10px] text-muted-foreground">antes: {brl(item.balance)}</p> : <p className="mt-1 text-[10px] text-muted-foreground">saldo projetado atual</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
