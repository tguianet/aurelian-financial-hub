import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  Bot,
  CircleDollarSign,
  Gauge,
  Lightbulb,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
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
import { addMoney, roundMoney } from "@/lib/money";

export const Route = createFileRoute("/_authenticated/consultor")({
  head: () => ({ meta: [{ title: "Consultor IA — Aurelian Finance" }] }),
  component: ConsultorFinanceiro,
});

type InsightTone = "positive" | "warning" | "critical" | "info";

type Insight = {
  title: string;
  body: string;
  tone: InsightTone;
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  text: string;
};

type MonthlyTotals = {
  income: number;
  expense: number;
  result: number;
};

type CategoryTotal = {
  categoryId: string;
  name: string;
  total: number;
};

const QUICK_QUESTIONS = [
  "Onde gastei mais este mês?",
  "Minhas despesas aumentaram?",
  "Qual empresa teve o melhor resultado?",
  "Tenho alguma conta vencida?",
  "Como está meu caixa em 30 dias?",
  "Qual empresa está dando prejuízo?",
];

function previousMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, month - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function percentChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function pctLabel(value: number | null) {
  if (value === null) return "sem base comparável";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1).replace(".", ",")}%`;
}

function ConsultorFinanceiro() {
  const { data, entityId, entityName, isLoading } = useEntityScope();
  const ref = today();
  const currentMonth = ref.slice(0, 7);
  const previousMonth = previousMonthKey(currentMonth);
  const kpis = computeKpis(data, entityId, ref);
  const scope = buildScope(data, entityId);
  const summaries = entitySummaries(data, ref);
  const proj = projection(data, entityId, ref);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: "assistant",
      text: "Eu respondo usando somente os dados reais do seu finance_space. Posso comparar meses, empresas, categorias, contas abertas, reservas e projeções. Quando os dados não forem suficientes, eu aviso em vez de adivinhar.",
    },
  ]);

  const monthTotals = useMemo(() => {
    const aggregate = (month: string): MonthlyTotals => {
      let income = 0;
      let expense = 0;

      for (const tx of data.transactions) {
        if (tx.deleted_at || tx.status === "cancelled" || tx.kind === "transfer") continue;
        if (!scope.matchesEntity(tx.entity_id) || !tx.competence_date.startsWith(month)) continue;
        if (tx.kind === "income") income = addMoney(income, Number(tx.amount));
        if (tx.kind === "expense") expense = addMoney(expense, Number(tx.amount));
      }

      for (const purchase of data.purchases) {
        if (!scope.matchesEntity(purchase.entity_id) || !purchase.purchase_date.startsWith(month)) continue;
        expense = addMoney(expense, Number(purchase.total_amount));
      }

      return {
        income: roundMoney(income),
        expense: roundMoney(expense),
        result: roundMoney(addMoney(income, -expense)),
      };
    };

    return {
      current: aggregate(currentMonth),
      previous: aggregate(previousMonth),
    };
  }, [currentMonth, data.purchases, data.transactions, previousMonth, scope]);

  const categoryTotals = useMemo(() => {
    const aggregate = (month: string): CategoryTotal[] => {
      const totals = new Map<string, number>();

      for (const tx of data.transactions) {
        if (tx.kind !== "expense" || tx.deleted_at || tx.status === "cancelled") continue;
        if (!scope.matchesEntity(tx.entity_id) || !tx.competence_date.startsWith(month)) continue;
        const key = tx.category_id ?? "__sem_categoria__";
        totals.set(key, addMoney(totals.get(key) ?? 0, Number(tx.amount)));
      }

      for (const purchase of data.purchases) {
        if (!scope.matchesEntity(purchase.entity_id) || !purchase.purchase_date.startsWith(month)) continue;
        const key = purchase.category_id ?? "__sem_categoria__";
        totals.set(key, addMoney(totals.get(key) ?? 0, Number(purchase.total_amount)));
      }

      return [...totals.entries()]
        .map(([categoryId, total]) => ({
          categoryId,
          name: categoryId === "__sem_categoria__"
            ? "Sem categoria"
            : data.categories.find((category) => category.id === categoryId)?.name ?? "Categoria removida",
          total: roundMoney(total),
        }))
        .sort((a, b) => b.total - a.total);
    };

    return {
      current: aggregate(currentMonth),
      previous: aggregate(previousMonth),
    };
  }, [currentMonth, data.categories, data.purchases, data.transactions, previousMonth, scope]);

  const visibleSummaries = useMemo(
    () => entityId === ALL ? summaries : summaries.filter((item) => item.entity.id === entityId),
    [entityId, summaries],
  );

  const rankedEntities = useMemo(
    () => [...visibleSummaries].sort((a, b) => b.result - a.result),
    [visibleSummaries],
  );

  const bestEntity = rankedEntities[0] ?? null;
  const worstEntity = rankedEntities.length ? rankedEntities[rankedEntities.length - 1] : null;
  const expenseChange = percentChange(monthTotals.current.expense, monthTotals.previous.expense);
  const incomeChange = percentChange(monthTotals.current.income, monthTotals.previous.income);
  const resultChange = percentChange(monthTotals.current.result, monthTotals.previous.result);
  const topCategory = categoryTotals.current[0] ?? null;
  const topCategoryShare = topCategory && monthTotals.current.expense > 0
    ? topCategory.total / monthTotals.current.expense
    : 0;

  const insights = useMemo<Insight[]>(() => {
    const list: Insight[] = [];

    if (monthTotals.current.result < 0) {
      list.push({
        title: "Resultado mensal negativo",
        body: `As saídas superam as entradas em ${brl(Math.abs(monthTotals.current.result))} neste mês.`,
        tone: "critical",
      });
    } else if (monthTotals.current.result > 0) {
      list.push({
        title: "Mês no positivo",
        body: `O resultado acumulado do mês está positivo em ${brl(monthTotals.current.result)}.`,
        tone: "positive",
      });
    }

    if (expenseChange !== null && expenseChange >= 20) {
      list.push({
        title: "Despesas aceleraram",
        body: `As despesas estão ${pctLabel(expenseChange)} acima do mês anterior (${brl(monthTotals.previous.expense)} → ${brl(monthTotals.current.expense)}).`,
        tone: "warning",
      });
    } else if (expenseChange !== null && expenseChange <= -15) {
      list.push({
        title: "Despesas recuaram",
        body: `As despesas caíram ${Math.abs(expenseChange).toFixed(1).replace(".", ",")}% frente ao mês anterior.`,
        tone: "positive",
      });
    }

    if (kpis.overduePayables > 0) {
      list.push({
        title: "Contas vencidas exigem atenção",
        body: `Há ${brl(kpis.overduePayables)} em contas a pagar vencidas.`,
        tone: "critical",
      });
    }

    if (kpis.overdueReceivables > 0) {
      list.push({
        title: "Recebimentos vencidos",
        body: `Há ${brl(kpis.overdueReceivables)} a receber já vencidos.`,
        tone: "warning",
      });
    }

    if (kpis.freeCash < 0) {
      list.push({
        title: "Caixa livre pressionado",
        body: `Depois de compromissos, parcelas e reservas, o dinheiro livre em 30 dias está em ${brl(kpis.freeCash)}.`,
        tone: "critical",
      });
    } else {
      list.push({
        title: "Caixa livre em 30 dias",
        body: `Depois dos compromissos conhecidos, a estimativa de dinheiro livre é ${brl(kpis.freeCash)}.`,
        tone: "info",
      });
    }

    if (topCategory && topCategoryShare >= 0.4 && monthTotals.current.expense > 0) {
      list.push({
        title: "Gasto concentrado em uma categoria",
        body: `${topCategory.name} representa ${(topCategoryShare * 100).toFixed(0)}% das despesas do mês (${brl(topCategory.total)}).`,
        tone: "warning",
      });
    } else if (topCategory) {
      list.push({
        title: `Maior gasto: ${topCategory.name}`,
        body: `${brl(topCategory.total)} nesta categoria no mês atual.`,
        tone: "info",
      });
    }

    if (entityId === ALL && worstEntity && worstEntity.result < 0) {
      list.push({
        title: `Atenção em ${worstEntity.entity.name}`,
        body: `É o pior resultado do mês entre as entidades: ${brl(worstEntity.result)}.`,
        tone: "warning",
      });
    }

    return list.slice(0, 6);
  }, [entityId, expenseChange, kpis.freeCash, kpis.overduePayables, kpis.overdueReceivables, monthTotals.current.expense, monthTotals.current.result, monthTotals.previous.expense, topCategory, topCategoryShare, worstEntity]);

  const answerQuestion = (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    const normalized = q.toLocaleLowerCase("pt-BR");
    let answer: string;

    const mentionedEntity = data.entities.find((entity) =>
      normalized.includes(entity.name.toLocaleLowerCase("pt-BR")),
    );
    const mentionedSummary = mentionedEntity
      ? summaries.find((item) => item.entity.id === mentionedEntity.id)
      : null;

    if (/onde.*gast|gastei mais|maior.*categoria|categoria.*gasto/.test(normalized)) {
      const top = topCategory;
      answer = top
        ? `Neste mês, sua maior categoria de gasto em ${entityName} é ${top.name}, com ${brl(top.total)}. Isso representa ${monthTotals.current.expense > 0 ? `${((top.total / monthTotals.current.expense) * 100).toFixed(0)}%` : "0%"} das despesas do período.`
        : `Ainda não há despesas suficientes neste mês em ${entityName} para apontar uma categoria líder.`;
    } else if (/despesa.*aument|gasto.*aument|gastando mais|compar.*m[eê]s|m[eê]s anterior/.test(normalized)) {
      answer = expenseChange === null
        ? `O mês anterior não tem base suficiente para uma comparação percentual. Neste mês as despesas estão em ${brl(monthTotals.current.expense)}.`
        : `As despesas deste mês estão em ${brl(monthTotals.current.expense)}, contra ${brl(monthTotals.previous.expense)} no mês anterior: ${pctLabel(expenseChange)}.`;
    } else if (/receita.*aument|entrada.*aument|fatur.*compar/.test(normalized)) {
      answer = incomeChange === null
        ? `Não há base comparável no mês anterior. As entradas deste mês são ${brl(monthTotals.current.income)}.`
        : `As entradas deste mês são ${brl(monthTotals.current.income)}, contra ${brl(monthTotals.previous.income)} no mês anterior: ${pctLabel(incomeChange)}.`;
    } else if (/melhor.*empresa|empresa.*melhor|mais.*lucro|mais.*resultado|lucrou mais/.test(normalized)) {
      answer = bestEntity
        ? `${bestEntity.entity.name} tem o melhor resultado do mês: ${brl(bestEntity.result)}. Entradas ${brl(bestEntity.income)} e saídas ${brl(bestEntity.expense)}.`
        : "Não há dados de entidades suficientes para comparar resultados neste mês.";
    } else if (/pior.*empresa|preju[ií]zo|dando preju[ií]zo|resultado negativo/.test(normalized)) {
      const negative = rankedEntities.filter((item) => item.result < 0);
      answer = negative.length
        ? `As entidades com resultado negativo são: ${negative.map((item) => `${item.entity.name} (${brl(item.result)})`).join(", ")}.`
        : "Nenhuma entidade do escopo atual está com resultado mensal negativo.";
    } else if (mentionedSummary && /resultado|lucro|preju[ií]zo|entrada|sa[ií]da|fatur/.test(normalized)) {
      answer = `${mentionedSummary.entity.name}: entradas ${brl(mentionedSummary.income)}, saídas ${brl(mentionedSummary.expense)} e resultado ${brl(mentionedSummary.result)} neste mês.`;
    } else if (/vencid|atrasad/.test(normalized)) {
      answer = `Há ${brl(kpis.overduePayables)} em contas a pagar vencidas e ${brl(kpis.overdueReceivables)} em recebimentos vencidos.`;
    } else if (/pagar|devo|contas.*pagar/.test(normalized)) {
      answer = `Você tem ${brl(kpis.payables)} a pagar. Desse total, ${brl(kpis.overduePayables)} está vencido.`;
    } else if (/receber|tenho.*receber/.test(normalized)) {
      answer = `Você tem ${brl(kpis.receivables)} a receber. Desse total, ${brl(kpis.overdueReceivables)} está vencido.`;
    } else if (/saldo|quanto.*tenho|caixa atual/.test(normalized)) {
      answer = `O saldo realizado em ${entityName} é ${brl(kpis.balance)}. O dinheiro livre estimado para os próximos 30 dias é ${brl(kpis.freeCash)}.`;
    } else if (/90 dias/.test(normalized)) {
      const p90 = proj.find((item) => item.days === 90);
      answer = p90
        ? `A projeção para 90 dias é saldo de ${brl(p90.balance)}, com ${brl(p90.inflow)} de entradas e ${brl(p90.outflow)} de saídas previstas no horizonte.`
        : "Não há projeção de 90 dias disponível no momento.";
    } else if (/60 dias/.test(normalized)) {
      const p60 = proj.find((item) => item.days === 60);
      answer = p60
        ? `A projeção para 60 dias é saldo de ${brl(p60.balance)}, com ${brl(p60.inflow)} de entradas e ${brl(p60.outflow)} de saídas previstas.`
        : "Não há projeção de 60 dias disponível no momento.";
    } else if (/proje|30 dias|futuro|caixa.*pr[oó]xim/.test(normalized)) {
      const p30 = proj.find((item) => item.days === 30) ?? proj[2];
      answer = p30
        ? `A projeção de saldo para 30 dias em ${entityName} é ${brl(p30.balance)}. Entradas previstas: ${brl(p30.inflow)}. Saídas previstas: ${brl(p30.outflow)}.`
        : `O saldo projetado conhecido é ${brl(kpis.projectedBalance)}.`;
    } else if (/resultado|lucro|margem/.test(normalized)) {
      const margin = monthTotals.current.income > 0
        ? (monthTotals.current.result / monthTotals.current.income) * 100
        : null;
      answer = `O resultado deste mês em ${entityName} é ${brl(monthTotals.current.result)}: entradas de ${brl(monthTotals.current.income)} e saídas de ${brl(monthTotals.current.expense)}.${margin === null ? " Não há receita suficiente para calcular margem." : ` Margem sobre entradas: ${margin.toFixed(1).replace(".", ",")}%.`} Comparação do resultado com o mês anterior: ${pctLabel(resultChange)}.`;
    } else if (/reserva/.test(normalized)) {
      answer = `Há ${brl(kpis.reserves)} alocados em reservas no escopo atual.`;
    } else if (/recorr|compromisso fixo|mensalidade/.test(normalized)) {
      answer = `Os compromissos recorrentes ainda não materializados nos próximos 30 dias somam ${brl(kpis.commitments)}.`;
    } else {
      answer = "Não encontrei base suficiente para responder isso com segurança. Posso responder sobre gastos e categorias, comparação com o mês anterior, resultado por empresa, contas vencidas, saldo, reservas, recorrências e projeções de 30/60/90 dias.";
    }

    const now = Date.now();
    setMessages((current) => [
      ...current,
      { id: now, role: "user", text: q },
      { id: now + 1, role: "assistant", text: answer },
    ]);
    setQuestion("");
  };

  const projection7 = proj.find((item) => item.days === 7);
  const projection30 = proj.find((item) => item.days === 30) ?? proj[2];
  const projection90 = proj.find((item) => item.days === 90);

  return (
    <div className="min-w-0">
      <PageHeader
        title="Consultor IA"
        subtitle={`${entityName} · ${monthLabel(ref)} · leitura segura dos dados reais do seu financeiro`}
      />

      {isLoading ? <p className="mb-4 text-sm text-muted-foreground">Carregando dados financeiros…</p> : null}

      <div className="panel relative overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-primary">
              <Sparkles className="size-5" />
              <span className="text-xs font-semibold uppercase tracking-[0.18em]">Leitura executiva</span>
            </div>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              O consultor cruza resultado, comparação mensal, caixa, contas abertas, cartões, reservas, recorrências e projeções. Ele não cria lançamentos e não inventa números.
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
        <Metric label="Resultado do mês" value={brl(monthTotals.current.result)} icon={monthTotals.current.result >= 0 ? TrendingUp : TrendingDown} tone={monthTotals.current.result >= 0 ? "positive" : "negative"} hint={`vs. mês anterior: ${pctLabel(resultChange)}`} />
        <Metric label="Despesas do mês" value={brl(monthTotals.current.expense)} icon={TrendingDown} tone={expenseChange !== null && expenseChange > 20 ? "negative" : "neutral"} hint={`vs. mês anterior: ${pctLabel(expenseChange)}`} />
        <Metric label="Dinheiro livre 30d" value={brl(kpis.freeCash)} icon={CircleDollarSign} tone={kpis.freeCash >= 0 ? "positive" : "negative"} hint={`A pagar: ${brl(kpis.payables)}`} />
        <Metric label="Vencidos" value={brl(addMoney(kpis.overduePayables, kpis.overdueReceivables))} icon={AlertTriangle} tone={(kpis.overduePayables + kpis.overdueReceivables) > 0 ? "negative" : "positive"} hint={`Pagar ${brl(kpis.overduePayables)} · receber ${brl(kpis.overdueReceivables)}`} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="panel p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2"><Lightbulb className="size-4 text-primary" /><h2 className="text-sm font-semibold">Alertas e insights</h2></div>
          <div className="space-y-3">
            {insights.length ? insights.map((item) => <InsightCard key={item.title} insight={item} />) : (
              <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted-foreground">Ainda não há dados suficientes para gerar insights.</p>
            )}
          </div>
        </section>

        <section className="panel flex min-h-[520px] flex-col p-4 sm:p-5">
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
              placeholder="Ex.: minhas despesas aumentaram?"
              className="min-h-12 resize-none"
            />
            <Button size="icon" className="size-12 shrink-0" onClick={() => answerQuestion(question)} disabled={!question.trim()} aria-label="Perguntar">
              <Send className="size-4" />
            </Button>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">Respostas calculadas com os dados já autorizados do finance_space. Nenhuma pergunta cria ou altera lançamentos.</p>
        </section>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <section className="panel p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div><h2 className="text-sm font-semibold">Comparativo por empresa</h2><p className="text-xs text-muted-foreground">Resultado do mês atual.</p></div>
            <Gauge className="size-4 text-primary" />
          </div>
          <div className="space-y-2.5">
            {rankedEntities.slice(0, 8).map((item, index) => (
              <div key={item.entity.id} className="rounded-xl border border-border bg-surface p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0"><p className="truncate text-sm font-medium">{index + 1}. {item.entity.name}</p><p className="text-[11px] text-muted-foreground">Entradas {brl(item.income)} · Saídas {brl(item.expense)}</p></div>
                  <p className={`num shrink-0 text-sm font-semibold ${item.result >= 0 ? "text-emerald-500" : "text-destructive"}`}>{brl(item.result)}</p>
                </div>
              </div>
            ))}
            {!rankedEntities.length ? <p className="text-sm text-muted-foreground">Sem entidades para comparar.</p> : null}
          </div>
        </section>

        <section className="panel p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div><h2 className="text-sm font-semibold">Categorias que mais pesam</h2><p className="text-xs text-muted-foreground">Participação nas despesas deste mês.</p></div>
            <TrendingDown className="size-4 text-primary" />
          </div>
          <div className="space-y-3">
            {categoryTotals.current.slice(0, 6).map((item) => {
              const share = monthTotals.current.expense > 0 ? item.total / monthTotals.current.expense : 0;
              return (
                <div key={item.categoryId}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-xs"><span className="truncate text-foreground">{item.name}</span><span className="num shrink-0 text-muted-foreground">{brl(item.total)} · {(share * 100).toFixed(0)}%</span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, share * 100)}%` }} /></div>
                </div>
              );
            })}
            {!categoryTotals.current.length ? <p className="text-sm text-muted-foreground">Sem despesas categorizadas no período.</p> : null}
          </div>
        </section>
      </div>

      <section className="panel mt-4 p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div><h2 className="text-sm font-semibold">Projeção executiva</h2><p className="text-xs text-muted-foreground">Horizontes calculados com contas abertas, parcelas e recorrências conhecidas.</p></div>
          <ShieldCheck className="size-4 text-primary" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ProjectionCard label="7 dias" balance={projection7?.balance ?? kpis.balance} inflow={projection7?.inflow ?? 0} outflow={projection7?.outflow ?? 0} />
          <ProjectionCard label="30 dias" balance={projection30?.balance ?? kpis.projectedBalance} inflow={projection30?.inflow ?? 0} outflow={projection30?.outflow ?? 0} />
          <ProjectionCard label="90 dias" balance={projection90?.balance ?? kpis.projectedBalance} inflow={projection90?.inflow ?? 0} outflow={projection90?.outflow ?? 0} />
        </div>
      </section>
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

function Metric({
  label,
  value,
  icon: Icon,
  tone,
  hint,
}: {
  label: string;
  value: string;
  icon: typeof TrendingUp;
  tone: "positive" | "negative" | "neutral";
  hint?: string;
}) {
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <Icon className={`size-4 ${tone === "positive" ? "text-emerald-500" : tone === "negative" ? "text-destructive" : "text-primary"}`} />
      </div>
      <p className={`num mt-2 text-xl font-semibold ${tone === "positive" ? "text-emerald-500" : tone === "negative" ? "text-destructive" : "text-foreground"}`}>{value}</p>
      {hint ? <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function ProjectionCard({ label, balance, inflow, outflow }: { label: string; balance: number; inflow: number; outflow: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`num mt-1 text-lg font-semibold ${balance >= 0 ? "text-foreground" : "text-destructive"}`}>{brl(balance)}</p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="text-emerald-500">+ {brl(inflow)}</span>
        <span className="text-destructive">− {brl(outflow)}</span>
      </div>
    </div>
  );
}
