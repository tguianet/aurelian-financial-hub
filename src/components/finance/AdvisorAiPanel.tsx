import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Bot, CircleDollarSign, Loader2, Send, Sparkles, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { brl, computeKpis, today, type FinanceDataset } from "@/lib/finance";
import { advisorFallbackSummary, buildAdvisorAiContext, requestAdvisorAnswer } from "@/lib/finance-advisor-ai";

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
};

type Props = {
  data: FinanceDataset;
  entityId: string;
  entityName: string;
};

const SUGGESTIONS = [
  "O que eu preciso resolver primeiro?",
  "Onde estou gastando mais?",
  "Tem algum risco nos próximos 30 dias?",
  "O que posso fazer para sobrar mais dinheiro?",
];

export function AdvisorAiPanel({ data, entityId, entityName }: Props) {
  const context = useMemo(() => buildAdvisorAiContext(data, entityId, entityName), [data, entityId, entityName]);
  const kpis = useMemo(() => computeKpis(data, entityId, today()), [data, entityId]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      role: "assistant",
      text: "Já olhei seus números. Posso explicar o que está acontecendo em linguagem simples e apontar o que merece atenção primeiro.",
    },
  ]);

  const priority = useMemo(() => {
    if (kpis.overduePayables > 0) {
      return {
        tone: "critical" as const,
        title: "Tem pagamento atrasado",
        body: `${brl(kpis.overduePayables)} já venceu. Eu começaria por isso para evitar juros e aperto no caixa.`,
        to: "/pendencias" as const,
        action: "Ver o que está atrasado",
        icon: AlertTriangle,
      };
    }
    if (kpis.freeCash < 0) {
      return {
        tone: "critical" as const,
        title: "Seu dinheiro está apertado nos próximos 30 dias",
        body: `Depois do que já está comprometido, a previsão fica em ${brl(kpis.freeCash)}. Vale revisar os próximos pagamentos.`,
        to: "/projecao" as const,
        action: "Ver próximos 30 dias",
        icon: AlertTriangle,
      };
    }
    if (kpis.overdueReceivables > 0) {
      return {
        tone: "warning" as const,
        title: "Tem dinheiro que você já deveria ter recebido",
        body: `${brl(kpis.overdueReceivables)} está atrasado para entrar. Cobrar isso pode melhorar seu caixa sem cortar gastos.`,
        to: "/pendencias" as const,
        action: "Ver quem está devendo",
        icon: CircleDollarSign,
      };
    }
    return {
      tone: "positive" as const,
      title: "Seu caixa está sob controle agora",
      body: `Você tem ${brl(kpis.freeCash)} livres considerando os compromissos conhecidos dos próximos 30 dias.`,
      to: "/projecao" as const,
      action: "Ver como fica daqui pra frente",
      icon: TrendingUp,
    };
  }, [kpis.freeCash, kpis.overduePayables, kpis.overdueReceivables]);

  const ask = async (raw: string) => {
    const value = raw.trim();
    if (!value || busy) return;
    const now = Date.now();
    setMessages((current) => [...current, { id: now, role: "user", text: value }]);
    setQuestion("");
    setBusy(true);
    try {
      const answer = await requestAdvisorAnswer(value, context);
      setMessages((current) => [...current, { id: now + 1, role: "assistant", text: answer }]);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Aurelian IA indisponível.";
      const fallback = advisorFallbackSummary(context);
      setMessages((current) => [
        ...current,
        {
          id: now + 1,
          role: "assistant",
          text: `${reason} Mesmo assim, consegui calcular este resumo: ${fallback}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const PriorityIcon = priority.icon;

  return (
    <section className="panel flex min-h-[520px] flex-col p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Bot className="size-4 text-primary" /><h2 className="text-sm font-semibold">Aurelian IA</h2></div>
          <p className="mt-1 text-xs text-muted-foreground">Eu olho seus números e traduzo o que importa. Você não precisa saber termos financeiros.</p>
        </div>
        <Sparkles className="size-4 shrink-0 text-primary" />
      </div>

      <div className={`mb-4 rounded-2xl border p-4 ${priority.tone === "critical" ? "border-destructive/35 bg-destructive/5" : priority.tone === "warning" ? "border-warning/35 bg-warning/5" : "border-primary/25 bg-primary/5"}`}>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-xl bg-background/70 p-2"><PriorityIcon className={`size-4 ${priority.tone === "critical" ? "text-destructive" : priority.tone === "warning" ? "text-warning" : "text-primary"}`} /></div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">O que eu olharia primeiro</p>
            <h3 className="mt-1 text-sm font-semibold">{priority.title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{priority.body}</p>
            <Link to={priority.to} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
              {priority.action} <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniStat label="Tenho hoje" value={brl(kpis.balance)} />
        <MiniStat label="Posso usar" value={brl(kpis.freeCash)} alert={kpis.freeCash < 0} />
        <MiniStat label="Ainda vou pagar" value={brl(kpis.payables)} alert={kpis.overduePayables > 0} />
        <MiniStat label="Ainda vou receber" value={brl(kpis.receivables)} />
      </div>

      <div className="mb-3">
        <p className="mb-2 text-[11px] text-muted-foreground">Você pode me perguntar assim:</p>
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => void ask(item)}
              disabled={busy}
              className="rounded-full border border-border bg-surface px-3 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-border bg-background/40 p-3">
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${message.role === "user" ? "bg-primary text-primary-foreground" : "border border-border bg-surface text-foreground"}`}>
              {message.text}
            </div>
          </div>
        ))}
        {busy ? (
          <div className="flex justify-start"><div className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Estou olhando seus números…</div></div>
        ) : null}
      </div>

      <div className="mt-3 flex gap-2">
        <Textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void ask(question);
            }
          }}
          placeholder="Pergunte do seu jeito. Ex.: consigo pagar tudo este mês?"
          className="min-h-12 resize-none"
          disabled={busy}
        />
        <Button size="icon" className="size-12 shrink-0" onClick={() => void ask(question)} disabled={busy || !question.trim()} aria-label="Perguntar ao Aurelian IA">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </div>
    </section>
  );
}

function MiniStat({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface/60 p-3">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`num mt-1 break-words text-sm font-semibold ${alert ? "text-destructive" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
