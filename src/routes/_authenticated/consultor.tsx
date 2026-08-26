import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Bot, CircleDollarSign, Lightbulb, Send, ShieldCheck, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { useEntityScope } from "@/components/finance/EntityContext";
import { PageHeader } from "@/components/finance/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ALL,
  brl,
  buildScope,
  computeKpis,
  entitySummaries,
  monthLabel,
  projection,
  today,
} from "@/lib/finance";
import { addMoney } from "@/lib/money";

export const Route = createFileRoute("/_authenticated/consultor")({
  head: () => ({ meta: [{ title: "Consultor IA — Aurelian Finance" }] }),
  component: ConsultorFinanceiro,
});

type Insight = {
  title: string;
  body: string;
  tone: "positive" | "warning" | "critical" | "info";
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  text: string;
};

const QUICK_QUESTIONS = [
  "Onde gastei mais este mês?",
  "Qual empresa teve o melhor resultado?",
  "Quanto tenho a pagar?",
  "Como está meu caixa nos próximos 30 dias?",
];

function ConsultorFinanceiro() {
  const { data, entityId, entityName, isLoading } = useEntityScope();
  const ref = today();
  const monthKey = ref.slice(0, 7);
  const kpis = computeKpis(data, entityId, ref);
  const scope = buildScope(data, entityId);
  const summaries = entitySummaries(data, ref);
  const proj = projection(data, entityId, ref);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: "assistant",
      text: "Eu analiso somente os dados reais carregados no seu financeiro. Pergunte sobre gastos, resultado, contas a pagar/receber, empresas ou projeção de caixa.",
    },
  ]);

  const expenseByCategory = useMemo(() => {
    const totals = new Map<string, number>();
    for (const tx of data.transactions) {
      if (tx.kind !== "expense" || tx.kind === "transfer" || tx.deleted_at || !scope.matchesEntity(tx.entity_id)) continue;
      if (!tx.competence_date.startsWith(monthKey)) continue;
      const key = tx.category_id ?? "__sem_categoria__";
      totals.set(key, addMoney(totals.get(key) ?? 0, Number(tx.amount)));
    }
    for (const purchase of data.purchases) {
      if (!scope.matchesEntity(purchase.entity_id) || !purchase.purchase_date.startsWith(monthKey)) continue;
      const key = purchase.category_id ?? "__sem_categoria__";
      totals.set(key, addMoney(totals.get(key) ?? 0, Number(purchase.total_amount)));
    }
    return [...totals.entries()]
      .map(([categoryId, total]) => ({
        categoryId,
        name: categoryId === "__sem_categoria__"
          ? "Sem categoria"
          : data.categories.find((category) => category.id === categoryId)?.name ?? "Categoria removida",
        total,
      }))
      .sort((a, b) => b.total - a.total);
  }, [data.categories, data.purchases, data.transactions, monthKey, scope]);

  const bestEntity = useMemo(() => {
    const allowed = entityId === ALL ? summaries : summaries.filter((item) => item.entity.id === entityId);
    return [...allowed].sort((a, b) => b.result - a.result)[0] ?? null;
  }, [entityId, summaries]);

  const insights = useMemo<Insight[]>(() => {
    const list: Insight[] = [];
    if (kpis.resultMonth < 0) {
      list.push({
        title: "Resultado mensal negativo",
        body: `As saídas superam as entradas em ${brl(Math.abs(kpis.resultMonth))} neste mês.`,
        tone: "critical",
      });
    } else if (kpis.resultMonth > 0) {
      list.push({
        title: "Mês no positivo",
        body: `O resultado acumulado do mês está positivo em ${brl(kpis.resultMonth)}.`,
        tone: "positive",
      });
    }

    if (kpis.overduePayables > 0) {
      list.push({
        title: "Contas vencidas exigem atenção",
        body: `Há ${brl(kpis.overduePayables)} em contas a pagar vencidas.`,
        tone: "warning",
      });
    }

    if (kpis.freeCash < 0) {
      list.push({
        title: "Caixa livre pressionado",
        body: `Considerando compromissos, parcelas, reservas e recebimentos, o dinheiro livre em 30 dias está em ${brl(kpis.freeCash)}.`,
        tone: "critical",
      });
    } else {
      list.push({
        title: "Caixa livre em 30 dias",
        body: `Depois dos compromissos conhecidos, a estimativa de dinheiro livre é ${brl(kpis.freeCash)}.`,
        tone: "info",
      });
    }

    const top = expenseByCategory[0];
    if (top && top.total > 0) {
      list.push({
        title: `Maior gasto: ${top.name}`,
        body: `${brl(top.total)} em despesas desta categoria no mês atual.`,
        tone: "info",
      });
    }

    if (entityId === ALL && bestEntity) {
      list.push({
        title: "Melhor resultado por empresa",
        body: `${bestEntity.entity.name} lidera o mês com resultado de ${brl(bestEntity.result)}.`,
        tone: bestEntity.result >= 0 ? "positive" : "warning",
      });
    }

    return list.slice(0, 5);
  }, [bestEntity, entityId, expenseByCategory, kpis.freeCash, kpis.overduePayables, kpis.resultMonth]);

  const answerQuestion = (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    const normalized = q.toLocaleLowerCase("pt-BR");
    let answer: string;

    if (/onde.*gast|gastei mais|maior.*categoria|categoria.*gasto/.test(normalized)) {
      const top = expenseByCategory[0];
      answer = top
        ? `Neste mês, sua maior categoria de gasto em ${entityName} é ${top.name}, com ${brl(top.total)}.`
        : `Ainda não há despesas suficientes neste mês em ${entityName} para apontar uma categoria líder.`;
    } else if (/melhor.*empresa|empresa.*melhor|mais.*lucro|mais.*resultado|lucrou mais/.test(normalized)) {
      answer = bestEntity
        ? `${bestEntity.entity.name} tem o melhor resultado do mês: ${brl(bestEntity.result)}. Entradas ${brl(bestEntity.income)} e saídas ${brl(bestEntity.expense)}.`
        : "Não há dados de entidades suficientes para comparar resultados neste mês.";
    } else if (/pagar|devo|contas.*pagar/.test(normalized)) {
      answer = `Você tem ${brl(kpis.payables)} a pagar. Desse total, ${brl(kpis.overduePayables)} está vencido.`;
    } else if (/receber|tenho.*receber/.test(normalized)) {
      answer = `Você tem ${brl(kpis.receivables)} a receber. Desse total, ${brl(kpis.overdueReceivables)} está vencido.`;
    } else if (/saldo|quanto.*tenho|caixa atual/.test(normalized)) {
      answer = `O saldo realizado em ${entityName} é ${brl(kpis.balance)}. O dinheiro livre estimado para os próximos 30 dias é ${brl(kpis.freeCash)}.`;
    } else if (/proje|30 dias|futuro|caixa.*pr[oó]xim/.test(normalized)) {
      const p30 = proj.find((item) => item.days === 30) ?? proj[2];
      answer = p30
        ? `A projeção de saldo para 30 dias em ${entityName} é ${brl(p30.balance)}. O saldo projetado total conhecido é ${brl(kpis.projectedBalance)}.`
        : `O saldo projetado conhecido é ${brl(kpis.projectedBalance)}.`;
    } else if (/resultado|lucro|preju[ií]zo/.test(normalized)) {
      answer = `O resultado deste mês em ${entityName} é ${brl(kpis.resultMonth)}: entradas de ${brl(kpis.incomeMonth)} e saídas de ${brl(kpis.expenseMonth)}.`;
    } else if (/reserva/.test(normalized)) {
      answer = `Há ${brl(kpis.reserves)} alocados em reservas no escopo atual.`;
    } else {
      answer = "Ainda não consigo responder essa pergunta com segurança. Tente perguntar sobre gastos do mês, resultado, empresa mais lucrativa, saldo, contas a pagar/receber, reservas ou projeção de 30 dias.";
    }

    setMessages((current) => [
      ...current,
      { id: Date.now(), role: "user", text: q },
      { id: Date.now() + 1, role: "assistant", text: answer },
    ]);
    setQuestion("");
  };

  const projection30 = proj.find((item) => item.days === 30) ?? proj[2];

  return (
    <div className="min-w-0">
      <PageHeader
        title="Consultor IA"
        subtitle={`${entityName} · ${monthLabel(ref)} · análise baseada apenas nos dados reais do seu financeiro`}
      />

      {isLoading ? <p className="mb-4 text-sm text-muted-foreground">Carregando dados financeiros…</p> : null}

      <div className="panel relative overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-primary"><Sparkles className="size-5" /><span className="text-xs font-semibold uppercase tracking-[0.18em]">Leitura executiva</span></div>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              O consultor cruza resultado, caixa, contas abertas, cartões, reservas e projeções. Ele não cria lançamentos e não inventa números.
            </p>
          </div>
          <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Caixa estimado em 30 dias</p>
            <p className={`num mt-1 text-xl font-semibold ${(projection30?.balance ?? kpis.projectedBalance) >= 0 ? "text-primary" : "text-destructive"}`}>
              {brl(projection30?.balance ?? kpis.projectedBalance)}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Resultado do mês" value={brl(kpis.resultMonth)} icon={kpis.resultMonth >= 0 ? TrendingUp : TrendingDown} tone={kpis.resultMonth >= 0 ? "positive" : "negative"} />
        <Metric label="Dinheiro livre 30d" value={brl(kpis.freeCash)} icon={CircleDollarSign} tone={kpis.freeCash >= 0 ? "positive" : "negative"} />
        <Metric label="A pagar" value={brl(kpis.payables)} icon={AlertTriangle} tone={kpis.overduePayables > 0 ? "negative" : "neutral"} />
        <Metric label="Reservas" value={brl(kpis.reserves)} icon={ShieldCheck} tone="neutral" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="panel p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2"><Lightbulb className="size-4 text-primary" /><h2 className="text-sm font-semibold">Insights automáticos</h2></div>
          <div className="space-y-3">
            {insights.length ? insights.map((item) => <InsightCard key={item.title} insight={item} />) : (
              <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted-foreground">Ainda não há dados suficientes para gerar insights.</p>
            )}
          </div>
        </section>

        <section className="panel flex min-h-[480px] flex-col p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2"><Bot className="size-4 text-primary" /><h2 className="text-sm font-semibold">Pergunte aos seus números</h2></div>
          <div className="mb-3 flex flex-wrap gap-2">
            {QUICK_QUESTIONS.map((item) => (
              <button key={item} type="button" onClick={() => answerQuestion(item)} className="rounded-full border border-border bg-surface px-3 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
                {item}
              </button>
            ))}
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-border bg-background/40 p-3">
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${message.role === "user" ? "bg-primary text-primary-foreground" : "border border-border bg-surface text-foreground"}`}>
                  {message.text}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <Textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  answerQuestion(question);
                }
              }}
              placeholder="Ex.: onde gastei mais este mês?"
              className="min-h-12 resize-none"
            />
            <Button size="icon" className="size-12 shrink-0" onClick={() => answerQuestion(question)} disabled={!question.trim()} aria-label="Perguntar">
              <Send className="size-4" />
            </Button>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">Respostas calculadas localmente com os dados já autorizados do finance_space. Nenhuma pergunta cria ou altera lançamentos.</p>
        </section>
      </div>
    </div>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const tone = insight.tone === "critical"
    ? "border-destructive/30 bg-destructive/5"
    : insight.tone === "warning"
      ? "border-amber-500/30 bg-amber-500/5"
      : insight.tone === "positive"
        ? "border-emerald-500/30 bg-emerald-500/5"
        : "border-primary/20 bg-primary/5";
  return (
    <div className={`rounded-xl border p-3.5 ${tone}`}>
      <p className="text-sm font-medium">{insight.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{insight.body}</p>
    </div>
  );
}

function Metric({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof TrendingUp; tone: "positive" | "negative" | "neutral" }) {
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <Icon className={`size-4 ${tone === "positive" ? "text-emerald-500" : tone === "negative" ? "text-destructive" : "text-primary"}`} />
      </div>
      <p className={`num mt-2 text-xl font-semibold ${tone === "positive" ? "text-emerald-500" : tone === "negative" ? "text-destructive" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
