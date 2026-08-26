import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CircleDollarSign,
  Gauge,
  Lightbulb,
  Send,
  Sparkles,
  TrendingDown,
  TrendingUp,
  WalletCards,
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
  projection,
  today,
} from "@/lib/finance";
import { detectTransactionAnomalies } from "@/lib/finance-anomalies";
import { addMoney, roundMoney } from "@/lib/money";

export const Route = createFileRoute("/_authenticated/consultor")({
  head: () => ({ meta: [{ title: "Aurelian IA — Aurelian Finance" }] }),
  component: AurelianAdvisor,
});

type ChatMessage = { id: number; role: "user" | "assistant"; text: string };
type MonthlyTotals = { income: number; expense: number; result: number };
type CategoryTotal = { categoryId: string; name: string; total: number };

type Priority = {
  title: string;
  body: string;
  tone: "critical" | "warning" | "positive" | "info";
  to?: "/pendencias" | "/revisar" | "/projecao" | "/lancamentos";
};

const QUICK_QUESTIONS = [
  "Posso gastar quanto hoje?",
  "O que vence esta semana?",
  "Onde estou gastando mais?",
  "Qual empresa está mais apertada?",
  "Como vou estar em 30 dias?",
  "O que eu deveria resolver primeiro?",
];

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function previousMonthKey(value: string) {
  const [year, month] = value.split("-").map(Number);
  return monthKey(new Date(year, month - 2, 1));
}

function percentChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function percentLabel(value: number | null) {
  if (value === null) return "sem base anterior";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1).replace(".", ",")}%`;
}

function AurelianAdvisor() {
  const { data, entityId, entityName, isLoading } = useEntityScope();
  const ref = today();
  const currentMonth = monthKey(ref);
  const previousMonth = previousMonthKey(currentMonth);
  const scope = buildScope(data, entityId);
  const kpis = computeKpis(data, entityId, ref);
  const projections = projection(data, entityId, ref);
  const summaries = entitySummaries(data, ref);
  const anomalies = useMemo(() => detectTransactionAnomalies(data, entityId), [data, entityId]);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: "assistant",
      text: "Eu já estou olhando seu caixa, contas a pagar e receber, projeção e movimentações fora do padrão. Pergunte do seu jeito e eu respondo com base nos dados que já existem no Aurelian.",
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
    return { current: aggregate(currentMonth), previous: aggregate(previousMonth) };
  }, [currentMonth, data.purchases, data.transactions, previousMonth, scope]);

  const categoryTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const tx of data.transactions) {
      if (tx.kind !== "expense" || tx.deleted_at || tx.status === "cancelled") continue;
      if (!scope.matchesEntity(tx.entity_id) || !tx.competence_date.startsWith(currentMonth)) continue;
      const key = tx.category_id ?? "__sem_categoria__";
      totals.set(key, addMoney(totals.get(key) ?? 0, Number(tx.amount)));
    }
    for (const purchase of data.purchases) {
      if (!scope.matchesEntity(purchase.entity_id) || !purchase.purchase_date.startsWith(currentMonth)) continue;
      const key = purchase.category_id ?? "__sem_categoria__";
      totals.set(key, addMoney(totals.get(key) ?? 0, Number(purchase.total_amount)));
    }
    return [...totals.entries()]
      .map(([categoryId, total]): CategoryTotal => ({
        categoryId,
        name: categoryId === "__sem_categoria__"
          ? "Sem categoria"
          : data.categories.find((category) => category.id === categoryId)?.name ?? "Categoria removida",
        total: roundMoney(total),
      }))
      .sort((a, b) => b.total - a.total);
  }, [currentMonth, data.categories, data.purchases, data.transactions, scope]);

  const visibleSummaries = useMemo(
    () => entityId === ALL ? summaries : summaries.filter((item) => item.entity.id === entityId),
    [entityId, summaries],
  );
  const rankedEntities = useMemo(() => [...visibleSummaries].sort((a, b) => b.result - a.result), [visibleSummaries]);
  const bestEntity = rankedEntities[0] ?? null;
  const worstEntity = rankedEntities.length ? rankedEntities[rankedEntities.length - 1] : null;
  const topCategory = categoryTotals[0] ?? null;
  const expenseChange = percentChange(monthTotals.current.expense, monthTotals.previous.expense);
  const p30 = projections.find((item) => item.days === 30) ?? null;

  const priorities = useMemo<Priority[]>(() => {
    const list: Priority[] = [];
    if (kpis.overduePayables > 0) {
      list.push({
        title: "Você tem contas vencidas",
        body: `${brl(kpis.overduePayables)} já passaram do vencimento. Eu resolveria isso primeiro para proteger o caixa e evitar juros.`,
        tone: "critical",
        to: "/pendencias",
      });
    }
    if (anomalies.length > 0) {
      list.push({
        title: anomalies[0].title,
        body: anomalies[0].body,
        tone: anomalies[0].severity === "critical" ? "critical" : "warning",
        to: "/revisar",
      });
    }
    if (kpis.freeCash < 0) {
      list.push({
        title: "Seu dinheiro livre está negativo",
        body: `Considerando compromissos conhecidos e reservas, o valor livre em 30 dias está em ${brl(kpis.freeCash)}.`,
        tone: "critical",
        to: "/projecao",
      });
    } else {
      list.push({
        title: "Quanto você pode usar sem apertar o caixa",
        body: `Pelos compromissos que já estão no sistema, seu dinheiro livre estimado é ${brl(kpis.freeCash)}.`,
        tone: "positive",
        to: "/projecao",
      });
    }
    if (expenseChange !== null && expenseChange >= 20) {
      list.push({
        title: "Seus gastos aceleraram",
        body: `As despesas estão ${percentLabel(expenseChange)} acima do mês anterior. Vale conferir os maiores gastos antes de assumir novos compromissos.`,
        tone: "warning",
        to: "/lancamentos",
      });
    }
    if (topCategory && monthTotals.current.expense > 0 && topCategory.total / monthTotals.current.expense >= 0.4) {
      list.push({
        title: `${topCategory.name} está pesando no mês`,
        body: `${topCategory.name} representa ${((topCategory.total / monthTotals.current.expense) * 100).toFixed(0)}% das despesas atuais.`,
        tone: "warning",
        to: "/lancamentos",
      });
    }
    return list.slice(0, 4);
  }, [anomalies, expenseChange, kpis.freeCash, kpis.overduePayables, monthTotals.current.expense, topCategory]);

  const executiveReading = useMemo(() => {
    if (kpis.overduePayables > 0 && kpis.freeCash < 0) return `O caixa de ${entityName} está pressionado: existem contas vencidas e o dinheiro livre projetado está negativo. Eu priorizaria regularizar vencidos e segurar novas saídas não essenciais.`;
    if (kpis.overduePayables > 0) return `O caixa ainda tem margem, mas existem contas vencidas. Eu resolveria essas pendências antes de assumir novos compromissos.`;
    if (kpis.freeCash < 0) return `O saldo atual pode parecer confortável, mas os próximos compromissos pressionam o caixa. O ponto de atenção está nos próximos 30 dias.`;
    if (monthTotals.current.result < 0) return `O mês está negativo em ${brl(Math.abs(monthTotals.current.result))}, embora o dinheiro livre projetado ainda esteja em ${brl(kpis.freeCash)}. Vale atacar os gastos que mais cresceram.`;
    return `O cenário de ${entityName} está controlado no momento. O mês está em ${brl(monthTotals.current.result)} e o dinheiro livre estimado para 30 dias é ${brl(kpis.freeCash)}.`;
  }, [entityName, kpis.freeCash, kpis.overduePayables, monthTotals.current.result]);

  const answerQuestion = (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    const normalized = q.toLocaleLowerCase("pt-BR");
    let answer = "Ainda não tenho dados suficientes para responder isso com segurança. Tente perguntar sobre caixa, vencimentos, gastos, empresas ou projeção.";

    if (/posso gastar|quanto.*usar|dinheiro livre|quanto.*disponivel|quanto.*disponível/.test(normalized)) {
      answer = kpis.freeCash >= 0
        ? `Pelos compromissos e reservas que já estão no Aurelian, você tem ${brl(kpis.freeCash)} de dinheiro livre estimado para os próximos 30 dias. Eu trataria esse valor como teto, não como meta de gasto.`
        : `Hoje eu não consideraria seguro aumentar gastos. O dinheiro livre projetado está em ${brl(kpis.freeCash)}.`;
    } else if (/vence|vencid|atrasad|semana/.test(normalized)) {
      answer = `Você tem ${brl(kpis.payables)} a pagar no total e ${brl(kpis.overduePayables)} já vencidos. A tela Contas a pagar e receber mostra exatamente quais itens precisam ser resolvidos.`;
    } else if (/onde.*gast|gastando mais|maior gasto|categoria/.test(normalized)) {
      answer = topCategory
        ? `Seu maior grupo de gastos neste mês é ${topCategory.name}, com ${brl(topCategory.total)}. Isso representa ${monthTotals.current.expense > 0 ? `${((topCategory.total / monthTotals.current.expense) * 100).toFixed(0)}%` : "0%"} das despesas.`
        : "Ainda não há despesas suficientes neste mês para apontar um grupo dominante.";
    } else if (/empresa.*apert|pior.*empresa|preju[ií]zo|dando preju[ií]zo/.test(normalized)) {
      answer = worstEntity
        ? `${worstEntity.entity.name} é a área mais pressionada no momento, com resultado de ${brl(worstEntity.result)} no mês. Entradas: ${brl(worstEntity.income)}. Saídas: ${brl(worstEntity.expense)}.`
        : "Ainda não há dados suficientes para comparar as empresas.";
    } else if (/melhor.*empresa|mais.*resultado|mais.*lucro/.test(normalized)) {
      answer = bestEntity
        ? `${bestEntity.entity.name} tem o melhor resultado do mês: ${brl(bestEntity.result)}. Entradas: ${brl(bestEntity.income)}. Saídas: ${brl(bestEntity.expense)}.`
        : "Ainda não há dados suficientes para comparar as empresas.";
    } else if (/30 dias|proje|futuro|como vou estar/.test(normalized)) {
      answer = p30
        ? `Daqui a 30 dias, a projeção atual de saldo é ${brl(p30.balance)}, considerando ${brl(p30.inflow)} de entradas e ${brl(p30.outflow)} de saídas previstas.`
        : `O dinheiro livre estimado para 30 dias é ${brl(kpis.freeCash)}.`;
    } else if (/resolver primeiro|prioridade|o que fazer|o que devo/.test(normalized)) {
      const first = priorities[0];
      answer = first ? `Eu começaria por isto: ${first.title}. ${first.body}` : "Não encontrei nenhuma prioridade crítica agora. O cenário está estável com os dados atuais.";
    } else if (/saldo|quanto.*tenho|caixa atual/.test(normalized)) {
      answer = `Seu saldo realizado em ${entityName} é ${brl(kpis.balance)}. Depois dos compromissos conhecidos, o dinheiro livre projetado fica em ${brl(kpis.freeCash)}.`;
    } else if (/receber/.test(normalized)) {
      answer = `Você tem ${brl(kpis.receivables)} a receber, sendo ${brl(kpis.overdueReceivables)} vencidos.`;
    } else if (/resultado|lucro|sobrou|margem/.test(normalized)) {
      answer = `Neste mês entraram ${brl(monthTotals.current.income)} e saíram ${brl(monthTotals.current.expense)}. O resultado até agora é ${brl(monthTotals.current.result)}.`;
    }

    setMessages((current) => [
      ...current,
      { id: Date.now(), role: "user", text: q },
      { id: Date.now() + 1, role: "assistant", text: answer },
    ]);
    setQuestion("");
  };

  if (isLoading) {
    return <div className="panel p-6 text-sm text-muted-foreground">Analisando seus números…</div>;
  }

  return (
    <div className="min-w-0">
      <PageHeader title="Aurelian IA" subtitle={`${entityName} · eu analiso seus números e mostro o que merece atenção`} />

      <section className="panel overflow-hidden border-primary/20 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-primary">
              <Sparkles className="size-4" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">O que eu vejo agora</span>
            </div>
            <h2 className="mt-2 text-xl font-semibold sm:text-2xl">{executiveReading}</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">A leitura usa apenas dados que já estão registrados no sistema. Quando faltar informação, eu não invento.</p>
          </div>
          <Bot className="size-9 shrink-0 text-primary" />
        </div>
      </section>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={CircleDollarSign} label="Saldo agora" value={brl(kpis.balance)} detail="dinheiro realizado nas contas" />
        <MetricCard icon={Gauge} label="Posso usar" value={brl(kpis.freeCash)} detail="estimativa livre para 30 dias" danger={kpis.freeCash < 0} />
        <MetricCard icon={TrendingUp} label="Sobrou no mês" value={brl(monthTotals.current.result)} detail={`${brl(monthTotals.current.income)} entrou · ${brl(monthTotals.current.expense)} saiu`} danger={monthTotals.current.result < 0} />
        <MetricCard icon={WalletCards} label="Está atrasado" value={brl(kpis.overduePayables)} detail={`${brl(kpis.overdueReceivables)} a receber vencido`} danger={kpis.overduePayables > 0} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="panel p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">O que merece sua atenção</p>
              <h2 className="mt-1 text-base font-semibold">Minhas prioridades para você</h2>
            </div>
            <Lightbulb className="size-5 text-primary" />
          </div>
          <div className="mt-4 space-y-2">
            {priorities.length ? priorities.map((item, index) => (
              <div key={`${item.title}-${index}`} className="rounded-xl border border-border bg-surface p-3">
                <div className="flex items-start gap-3">
                  {item.tone === "critical" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" /> : item.tone === "warning" ? <TrendingDown className="mt-0.5 size-4 shrink-0 text-amber-500" /> : <TrendingUp className="mt-0.5 size-4 shrink-0 text-primary" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.body}</p>
                    {item.to ? <Link to={item.to} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Resolver agora <ArrowRight className="size-3" /></Link> : null}
                  </div>
                </div>
              </div>
            )) : <p className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">Não encontrei nenhuma prioridade importante agora.</p>}
          </div>
        </section>

        <section className="panel p-4 sm:p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Como seu dinheiro pode ficar</p>
          <h2 className="mt-1 text-base font-semibold">Próximos 30 dias</h2>
          <div className="mt-4 rounded-xl border border-border bg-surface p-4">
            <p className="text-xs text-muted-foreground">Saldo projetado</p>
            <p className="num mt-1 text-2xl font-semibold">{brl(p30?.balance ?? kpis.projectedBalance)}</p>
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div><span className="block text-muted-foreground">Pode entrar</span><strong className="num text-success">{brl(p30?.inflow ?? 0)}</strong></div>
              <div><span className="block text-muted-foreground">Pode sair</span><strong className="num text-destructive">{brl(p30?.outflow ?? 0)}</strong></div>
            </div>
          </div>
          <Button variant="outline" className="mt-3 w-full" asChild><Link to="/projecao">Ver projeção completa</Link></Button>
        </section>
      </div>

      <section className="panel mt-4 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Bot className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Pergunte ao Aurelian</p>
            <h2 className="mt-1 text-base font-semibold">Pergunte aos seus números do seu jeito</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK_QUESTIONS.map((item) => <Button key={item} variant="outline" size="sm" className="h-auto whitespace-normal text-left text-xs" onClick={() => answerQuestion(item)}>{item}</Button>)}
            </div>
            <div className="mt-4 max-h-80 space-y-2 overflow-y-auto rounded-xl border border-border bg-surface p-3">
              {messages.map((message) => (
                <div key={message.id} className={`max-w-[92%] rounded-xl px-3 py-2 text-xs leading-relaxed ${message.role === "assistant" ? "bg-primary/8 text-foreground" : "ml-auto bg-muted text-foreground"}`}>
                  {message.text}
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={2} placeholder="Ex.: posso gastar R$ 5.000 esta semana sem apertar o caixa?" className="resize-none" />
              <Button className="gap-2 sm:self-stretch" onClick={() => answerQuestion(question)} disabled={!question.trim()}><Send className="size-4" /> Perguntar</Button>
            </div>
          </div>
        </div>
      </section>

      {entityId === ALL && rankedEntities.length > 0 ? (
        <section className="panel mt-4 p-4 sm:p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Como cada área está indo</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {rankedEntities.map((item) => (
              <div key={item.entity.id} className="rounded-xl border border-border bg-surface p-3">
                <p className="text-sm font-medium">{item.entity.name}</p>
                <p className={`num mt-1 text-lg font-semibold ${item.result < 0 ? "text-destructive" : "text-success"}`}>{brl(item.result)}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">Entrou {brl(item.income)} · saiu {brl(item.expense)}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {categoryTotals.length > 0 ? (
        <section className="panel mt-4 p-4 sm:p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Onde seu dinheiro mais está indo</p>
          <div className="mt-3 space-y-2">
            {categoryTotals.slice(0, 5).map((item) => {
              const share = monthTotals.current.expense > 0 ? item.total / monthTotals.current.expense : 0;
              return (
                <div key={item.categoryId} className="rounded-xl border border-border bg-surface p-3">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium">{item.name}</span>
                    <span className="num">{brl(item.total)} · {(share * 100).toFixed(0)}%</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, share * 100)}%` }} /></div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, detail, danger = false }: {
  icon: typeof CircleDollarSign;
  label: string;
  value: string;
  detail: string;
  danger?: boolean;
}) {
  return (
    <section className={`panel p-4 ${danger ? "border-destructive/25" : ""}`}>
      <div className="flex items-center gap-2 text-muted-foreground"><Icon className={`size-4 ${danger ? "text-destructive" : "text-primary"}`} /><span className="text-[10px] font-semibold uppercase tracking-[0.15em]">{label}</span></div>
      <p className={`num mt-2 text-xl font-semibold ${danger ? "text-destructive" : ""}`}>{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
    </section>
  );
}
