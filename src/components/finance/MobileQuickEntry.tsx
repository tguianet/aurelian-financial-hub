import { useMemo, useRef, useState } from "react";
import { Check, Mic, MicOff, RotateCcw, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useRefreshFinance } from "@/hooks/useFinance";
import { useEntityScope } from "./EntityContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { brl, type TxKind } from "@/lib/finance";

type Draft = {
  kind: Exclude<TxKind, "transfer">;
  amount: number;
  entityId: string;
  categoryId: string | null;
  accountId: string;
  description: string;
  originalText: string;
  parser: "local" | "openai";
};

type SpeechRecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

const normalize = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function parseAmount(text: string) {
  const matches = text.match(/\d[\d.]*([,.]\d{1,2})?/g) ?? [];
  for (const raw of matches) {
    const clean = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
    const amount = Number(clean);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return null;
}

function inferKind(text: string): Draft["kind"] {
  const n = normalize(text);
  const incomeWords = ["recebi", "receber", "entrou", "entrada", "vendi", "venda", "ganhei", "comissao", "faturei"];
  return incomeWords.some((word) => n.includes(word)) ? "income" : "expense";
}

function removeEntityMention(text: string, entityName?: string) {
  if (!entityName) return normalize(text);
  const normalizedText = normalize(text);
  const normalizedEntity = normalize(entityName);
  return normalizedText.replaceAll(normalizedEntity, " ").replace(/\s+/g, " ").trim();
}

export function MobileQuickEntry() {
  const { data, entityId: selectedEntityId } = useEntityScope();
  const { user } = useAuthUser();
  const refresh = useRefreshFinance();
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [listening, setListening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [interpreting, setInterpreting] = useState(false);
  const recognitionRef = useRef<InstanceType<SpeechRecognitionCtor> | null>(null);

  const speechSupported = useMemo(
    () => typeof window !== "undefined" && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    [],
  );

  const localInterpret = (originalText: string) => {
    const amount = parseAmount(originalText);
    if (!amount) return null;
    const n = normalize(originalText);
    const kind = inferKind(originalText);
    const explicitEntity = data.entities.find((e) => n.includes(normalize(e.name)));
    const entity =
      explicitEntity ??
      (selectedEntityId !== "all" ? data.entities.find((e) => e.id === selectedEntityId) : undefined) ??
      data.entities.find((e) => e.slug === "pessoal") ?? data.entities[0];
    if (!entity) return null;

    const account = data.accounts.find((a) => a.entity_id === entity.id && a.active) ??
      data.accounts.find((a) => a.entity_id === entity.id);
    if (!account) return null;

    const categoryText = removeEntityMention(originalText, explicitEntity?.name);
    const categories = data.categories.filter((c) => c.kind === kind);
    const category = categories.find((c) => categoryText.includes(normalize(c.name))) ??
      categories.find((c) => {
        const cn = normalize(c.name);
        if (cn.includes("manutencao") && /(manutencao|conserto|reparo|oficina)/.test(categoryText)) return true;
        if (cn.includes("combustivel") && /(gasolina|etanol|alcool|posto|combustivel)/.test(categoryText)) return true;
        if (cn.includes("alimentacao") && /(comida|almoco|janta|mercado)/.test(categoryText)) return true;
        if (cn.includes("energia") && /(conta de luz|energia eletrica|luz)/.test(categoryText)) return true;
        if (cn.includes("comiss") && /(comissao|comparta|energia por assinatura)/.test(categoryText)) return true;
        if (cn.includes("venda") && /(vendi|venda|faturei)/.test(categoryText)) return true;
        return false;
      }) ?? null;

    const stripped = originalText
      .replace(/\d[\d.]*([,.]\d{1,2})?/, "")
      .replace(/\b(gastei|paguei|comprei|recebi|entrou|vendi|ganhei|faturei|reais|real|r\$)\b/gi, "")
      .replace(/\s+/g, " ").trim();

    const result: Draft = {
      kind,
      amount,
      entityId: entity.id,
      categoryId: category?.id ?? null,
      accountId: account.id,
      description: stripped || (kind === "income" ? "Entrada rápida" : "Saída rápida"),
      originalText,
      parser: "local",
    };

    const confident = Boolean(category) && (Boolean(explicitEntity) || selectedEntityId !== "all");
    return { result, confident };
  };

  const aiInterpret = async (originalText: string): Promise<Draft | null> => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return null;

    const response = await fetch("/api/finance/interpret", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        text: originalText,
        entities: data.entities.map(({ id, name, slug }) => ({ id, name, slug })),
        categories: data.categories.map(({ id, name, kind }) => ({ id, name, kind })),
        accounts: data.accounts.filter((a) => a.active).map(({ id, name, entity_id }) => ({ id, name, entity_id })),
      }),
    });
    if (!response.ok) return null;

    const payload = await response.json() as { interpretation?: {
      kind?: "income" | "expense";
      amount?: number;
      entity_id?: string | null;
      category_id?: string | null;
      account_id?: string | null;
      description?: string;
      confidence?: number;
    } };
    const ai = payload.interpretation;
    if (!ai?.kind || !ai.amount || ai.amount <= 0 || (ai.confidence ?? 0) < 0.55) return null;

    const entity = data.entities.find((e) => e.id === ai.entity_id) ??
      (selectedEntityId !== "all" ? data.entities.find((e) => e.id === selectedEntityId) : undefined) ??
      data.entities.find((e) => e.slug === "pessoal");
    if (!entity) return null;

    const category = data.categories.find((c) => c.id === ai.category_id && c.kind === ai.kind) ?? null;
    const account = data.accounts.find((a) => a.id === ai.account_id && a.entity_id === entity.id && a.active) ??
      data.accounts.find((a) => a.entity_id === entity.id && a.active) ??
      data.accounts.find((a) => a.entity_id === entity.id);
    if (!account) return null;

    return {
      kind: ai.kind,
      amount: Number(ai.amount),
      entityId: entity.id,
      categoryId: category?.id ?? null,
      accountId: account.id,
      description: ai.description?.trim() || originalText,
      originalText,
      parser: "openai",
    };
  };

  const interpret = async (value = text) => {
    const originalText = value.trim();
    if (!originalText) return toast.error("Digite ou fale um lançamento.");
    if (!parseAmount(originalText)) return toast.error("Não encontrei o valor. Ex.: gastei 180 combustível.");

    setInterpreting(true);
    const local = localInterpret(originalText);
    if (local?.confident) {
      setDraft(local.result);
      setInterpreting(false);
      return;
    }

    try {
      const ai = await aiInterpret(originalText);
      if (ai) {
        setDraft(ai);
        setInterpreting(false);
        return;
      }
    } catch (error) {
      console.warn("Fallback OpenAI indisponível", error);
    }

    setInterpreting(false);
    if (local?.result) {
      setDraft(local.result);
      toast.message("Usei a interpretação local. Confira antes de confirmar.");
      return;
    }
    toast.error("Não consegui interpretar. Cadastre uma conta para a entidade ou ajuste o texto.");
  };

  const startVoice = () => {
    if (!speechSupported) return toast.error("Reconhecimento de voz não disponível neste navegador.");
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = "pt-BR";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      setText(transcript);
      void interpret(transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => { setListening(false); toast.error("Não consegui ouvir. Tente novamente."); };
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  };

  const stopVoice = () => { recognitionRef.current?.stop(); setListening(false); };

  const confirm = async () => {
    if (!draft || !user) return;
    setSaving(true);
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase.from("transactions").insert({
      user_id: user.id,
      entity_id: draft.entityId,
      kind: draft.kind,
      description: draft.description,
      amount: draft.amount,
      category_id: draft.categoryId,
      account_id: draft.accountId,
      payment_method: "other",
      competence_date: today,
      due_date: today,
      paid_at: today,
      status: draft.kind === "income" ? "received" : "paid",
      recurrence: "none",
      source: draft.parser === "openai" ? "mobile_openai" : "mobile_quick_entry",
      notes: `Comando original: ${draft.originalText}`,
    });
    setSaving(false);
    if (error) return toast.error(error.message);

    await supabase.from("audit_log").insert({
      user_id: user.id,
      table_name: "transactions",
      action: "insert",
      details: { source: draft.parser, text: draft.originalText, amount: draft.amount },
    });
    toast.success("Lançamento confirmado.");
    setDraft(null);
    setText("");
    refresh();
  };

  const entity = draft ? data.entities.find((e) => e.id === draft.entityId) : null;
  const category = draft ? data.categories.find((c) => c.id === draft.categoryId) : null;
  const account = draft ? data.accounts.find((a) => a.id === draft.accountId) : null;

  return (
    <section className="rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/10 to-card p-4 shadow-sm md:p-5">
      <div className="mb-3">
        <div className="flex items-center gap-2 text-primary"><Sparkles className="size-4" /><span className="text-xs font-semibold uppercase tracking-[0.16em]">Lançamento rápido</span></div>
        <h2 className="mt-1 text-lg font-semibold">Digite ou fale o que aconteceu</h2>
        <p className="mt-1 text-xs text-muted-foreground">Parser local primeiro; IA só entra quando a frase estiver ambígua.</p>
      </div>

      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Recebi 2.607 da Energia..." className="resize-none bg-background/70 text-base" />

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-11 gap-2" onClick={listening ? stopVoice : startVoice}>
          {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}{listening ? "Parar" : "Falar"}
        </Button>
        <Button className="h-11 gap-2" disabled={interpreting} onClick={() => void interpret()}>
          <Send className="size-4" /> {interpreting ? "Entendendo..." : "Interpretar"}
        </Button>
      </div>

      {draft ? (
        <div className="mt-4 rounded-xl border border-border bg-background/75 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Confirme antes de salvar</p>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{draft.parser === "openai" ? "IA" : "Local"}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><span className="block text-[11px] text-muted-foreground">Tipo</span><strong>{draft.kind === "income" ? "Entrada" : "Saída"}</strong></div>
            <div><span className="block text-[11px] text-muted-foreground">Valor</span><strong className={draft.kind === "income" ? "text-success" : "text-destructive"}>{brl(draft.amount)}</strong></div>
            <div><span className="block text-[11px] text-muted-foreground">Entidade</span><strong>{entity?.name ?? "—"}</strong></div>
            <div><span className="block text-[11px] text-muted-foreground">Categoria</span><strong>{category?.name ?? "Sem categoria"}</strong></div>
            <div className="col-span-2"><span className="block text-[11px] text-muted-foreground">Conta</span><strong>{account?.name ?? "—"}</strong></div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button variant="ghost" className="gap-2" onClick={() => setDraft(null)}><RotateCcw className="size-4" /> Corrigir</Button>
            <Button className="gap-2" disabled={saving} onClick={confirm}><Check className="size-4" /> {saving ? "Salvando..." : "Confirmar"}</Button>
          </div>
        </div>
      ) : null}

      {!speechSupported ? <p className="mt-3 text-[11px] text-muted-foreground">Seu navegador não expõe reconhecimento de voz. O lançamento por texto continua funcionando normalmente.</p> : null}
    </section>
  );
}
