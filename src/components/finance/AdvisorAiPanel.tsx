import { useMemo, useState } from "react";
import { Bot, Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { FinanceDataset } from "@/lib/finance";
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
  "Onde estou perdendo mais dinheiro?",
  "O que mais merece minha atenção agora?",
  "Qual empresa está pior este mês?",
  "Como está meu caixa nos próximos 30 dias?",
];

export function AdvisorAiPanel({ data, entityId, entityName }: Props) {
  const context = useMemo(() => buildAdvisorAiContext(data, entityId, entityName), [data, entityId, entityName]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      role: "assistant",
      text: "Posso analisar seus números reais e explicar o que merece atenção. Se não houver base suficiente, eu digo isso em vez de inventar.",
    },
  ]);

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
      const reason = error instanceof Error ? error.message : "Consultor IA indisponível.";
      const fallback = advisorFallbackSummary(context);
      setMessages((current) => [
        ...current,
        {
          id: now + 1,
          role: "assistant",
          text: `${reason} Enquanto isso, aqui está o resumo calculado localmente: ${fallback}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel flex min-h-[520px] flex-col p-4 sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Bot className="size-4 text-primary" /><h2 className="text-sm font-semibold">Consultor conversacional</h2></div>
          <p className="mt-1 text-xs text-muted-foreground">A IA recebe somente um resumo financeiro controlado do seu finance_space. Sem SQL livre e sem acesso direto ao banco.</p>
        </div>
        <Sparkles className="size-4 shrink-0 text-primary" />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
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

      <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-border bg-background/40 p-3">
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${message.role === "user" ? "bg-primary text-primary-foreground" : "border border-border bg-surface text-foreground"}`}>
              {message.text}
            </div>
          </div>
        ))}
        {busy ? (
          <div className="flex justify-start"><div className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Analisando seus números…</div></div>
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
          placeholder="Ex.: por que meu caixa apertou este mês?"
          className="min-h-12 resize-none"
          disabled={busy}
        />
        <Button size="icon" className="size-12 shrink-0" onClick={() => void ask(question)} disabled={busy || !question.trim()} aria-label="Perguntar ao Consultor IA">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </div>
    </section>
  );
}
