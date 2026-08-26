import { useMemo, useState } from "react";
import { Bot, GitCompareArrows, ShieldCheck, TriangleAlert } from "lucide-react";
import { brl } from "@/lib/finance";
import { parseBRLMoney, roundMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { DecisionProjection } from "@/components/finance/DecisionSimulator";

type Props = {
  entityName: string;
  freeCash: number;
  projections: DecisionProjection[];
  onAskAurelian?: ((question: string) => void) | undefined;
  onUsePlan?: (() => void) | undefined;
};

type Scenario = {
  label: string;
  amount: number;
  freeCashAfter: number;
  negativeHorizons: number;
  projected: Array<{ days: number; balance: number }>;
};

function buildScenario(label: string, amount: number, freeCash: number, projections: DecisionProjection[]): Scenario {
  const projected = projections.map((item) => ({ days: item.days, balance: roundMoney(item.balance - amount) }));
  return { label, amount, freeCashAfter: roundMoney(freeCash - amount), negativeHorizons: projected.filter((item) => item.balance < 0).length, projected };
}

export function ScenarioComparison({ entityName, freeCash, projections, onAskAurelian, onUsePlan }: Props) {
  const [rawA, setRawA] = useState("");
  const [rawB, setRawB] = useState("");
  const [review, setReview] = useState<Scenario | null>(null);
  const amountA = parseBRLMoney(rawA) ?? 0;
  const amountB = parseBRLMoney(rawB) ?? 0;
  const scenarioA = useMemo(() => buildScenario("Plano A", amountA, freeCash, projections), [amountA, freeCash, projections]);
  const scenarioB = useMemo(() => buildScenario("Plano B", amountB, freeCash, projections), [amountB, freeCash, projections]);
  const ready = amountA > 0 && amountB > 0;
  const winner = useMemo(() => {
    if (!ready) return null;
    if (scenarioA.negativeHorizons !== scenarioB.negativeHorizons) return scenarioA.negativeHorizons < scenarioB.negativeHorizons ? scenarioA : scenarioB;
    if (scenarioA.freeCashAfter !== scenarioB.freeCashAfter) return scenarioA.freeCashAfter > scenarioB.freeCashAfter ? scenarioA : scenarioB;
    return null;
  }, [ready, scenarioA, scenarioB]);

  const askAurelian = () => {
    if (!ready || !onAskAurelian) return;
    onAskAurelian(`Compare duas decisões para ${entityName}. Plano A: gastar ${brl(amountA)} hoje. Plano B: gastar ${brl(amountB)} hoje. O Dinheiro Livre atual é ${brl(freeCash)}. Compare o impacto em 7, 15, 30, 60 e 90 dias, diga qual plano é mais prudente e explique o principal risco de cada opção.`);
  };

  const confirmPlan = () => {
    const scenario = review;
    setReview(null);
    if (!scenario) return;
    onAskAurelian?.(`Escolhi o ${scenario.label} para ${entityName}: uma saída de ${brl(scenario.amount)} hoje, deixando ${brl(scenario.freeCashAfter)} de Dinheiro Livre. Monte um plano de execução prudente, indicando o que pagar primeiro, o que adiar e quais riscos observar em 7, 15, 30, 60 e 90 dias. Não considere nenhum lançamento feito.`);
    onUsePlan?.();
  };

  return (
    <section className="panel mt-4 overflow-hidden border-primary/20 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary"><GitCompareArrows className="size-4" /><span className="text-[10px] font-semibold uppercase tracking-[0.16em]">Plano A vs Plano B</span></div>
          <h2 className="mt-1 text-base font-semibold">Compare duas decisões antes de escolher</h2>
          <p className="mt-1 text-xs text-muted-foreground">Nenhum cenário altera seus dados. Escolher um plano não movimenta dinheiro nem cria lançamentos.</p>
        </div>
        {onAskAurelian ? <Button variant="outline" size="sm" className="gap-1.5" disabled={!ready} onClick={askAurelian}><Bot className="size-3.5" /> Pedir parecer</Button> : null}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <ScenarioCard label="Plano A" raw={rawA} onChange={setRawA} scenario={scenarioA} ready={amountA > 0} highlighted={winner?.label === "Plano A"} onUse={onAskAurelian ? () => setReview(scenarioA) : undefined} />
        <ScenarioCard label="Plano B" raw={rawB} onChange={setRawB} scenario={scenarioB} ready={amountB > 0} highlighted={winner?.label === "Plano B"} onUse={onAskAurelian ? () => setReview(scenarioB) : undefined} />
      </div>

      {ready ? <div className={`mt-4 rounded-xl border p-3 text-xs leading-relaxed ${winner ? "border-primary/20 bg-primary/5" : "border-border bg-surface"}`}>{winner ? <div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" /><span><strong>{winner.label}</strong> preserva melhor o caixa pelos critérios atuais: menos horizontes negativos e maior Dinheiro Livre restante.</span></div> : <div className="flex items-start gap-2"><GitCompareArrows className="mt-0.5 size-4 shrink-0 text-primary" /><span>Os dois planos têm impacto financeiro equivalente pelos critérios atuais.</span></div>}</div> : null}

      <AlertDialog open={review !== null} onOpenChange={(open) => { if (!open) setReview(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Usar o {review?.label}?</AlertDialogTitle><AlertDialogDescription>Isto não lança, não paga e não altera nenhum dado. Eu apenas preparo um plano de execução com o Aurelian IA.</AlertDialogDescription></AlertDialogHeader>
          {review ? <div className="space-y-2 text-xs"><div className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2"><span>Saída hipotética</span><span className="num font-medium">{brl(review.amount)}</span></div><div className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2"><span>Dinheiro Livre depois</span><span className={`num font-medium ${review.freeCashAfter < 0 ? "text-destructive" : "text-success"}`}>{brl(review.freeCashAfter)}</span></div><div className="grid grid-cols-5 gap-1.5">{review.projected.map((item) => <div key={item.days} className="rounded-lg border border-border p-2 text-center"><p className="text-[9px] text-muted-foreground">{item.days}d</p><p className={`num mt-1 text-[10px] font-medium ${item.balance < 0 ? "text-destructive" : ""}`}>{brl(item.balance)}</p></div>)}</div></div> : null}
          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={(event) => { event.preventDefault(); confirmPlan(); }}>Confirmar plano</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function ScenarioCard({ label, raw, onChange, scenario, ready, highlighted, onUse }: { label: string; raw: string; onChange: (value: string) => void; scenario: Scenario; ready: boolean; highlighted: boolean; onUse?: (() => void) | undefined; }) {
  return <div className={`rounded-xl border bg-surface p-4 ${highlighted ? "border-primary/40" : "border-border"}`}><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold">{label}</p>{highlighted ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">mais conservador</span> : null}</div><label className="mt-3 block text-xs text-muted-foreground">Gasto hipotético hoje</label><div className="mt-1 flex items-center rounded-lg border border-border bg-background px-3"><span className="text-sm text-muted-foreground">R$</span><input inputMode="decimal" value={raw} onChange={(event) => onChange(event.target.value)} placeholder="5.000,00" className="h-10 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none" /></div>{ready ? <><div className={`mt-3 rounded-lg border p-3 ${scenario.freeCashAfter < 0 ? "border-destructive/25 bg-destructive/5" : "border-border"}`}><span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Dinheiro Livre depois</span><p className={`num mt-1 text-lg font-semibold ${scenario.freeCashAfter < 0 ? "text-destructive" : "text-success"}`}>{brl(scenario.freeCashAfter)}</p>{scenario.negativeHorizons > 0 ? <p className="mt-1 flex items-center gap-1 text-[10px] text-destructive"><TriangleAlert className="size-3" /> {scenario.negativeHorizons} horizonte(s) com saldo negativo</p> : <p className="mt-1 text-[10px] text-muted-foreground">nenhum horizonte negativo</p>}</div><div className="mt-3 grid grid-cols-5 gap-1.5">{scenario.projected.map((item) => <div key={item.days} className="rounded-lg border border-border p-2 text-center"><p className="text-[9px] text-muted-foreground">{item.days}d</p><p className={`num mt-1 text-[10px] font-medium ${item.balance < 0 ? "text-destructive" : ""}`}>{brl(item.balance)}</p></div>)}</div>{onUse ? <Button variant="outline" size="sm" className="mt-3 w-full" onClick={onUse}>Usar este plano</Button> : null}</> : <p className="mt-3 text-xs text-muted-foreground">Informe um valor para calcular este cenário.</p>}</div>;
}
