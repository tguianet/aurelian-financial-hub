import { useMemo, useRef, useState } from "react";
import { Check, Mic, MicOff, RotateCcw, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { useRefreshFinance } from "@/hooks/useFinance";
import { useEntityScope } from "./EntityContext";
import type { UploadedDocument } from "./QuickDocumentUpload";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { brl, type TxKind } from "@/lib/finance";
import { acceptedEntityId, compactAiCategory, compactAiEntity, matchEntityRecord, resolveCategoryId, resolveCategoryMatch, selectableCategories } from "@/lib/categories";
import { isValidDateIso, localDateIso, parseLooseDate } from "@/lib/date";
import { parseBRLMoney, roundMoney } from "@/lib/money";
import { newIdempotencyKey } from "@/lib/idempotency";
import { rpcErrorMessage } from "@/lib/rpc-error";
import { DocumentReviewDialog } from "./DocumentReviewDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  requestDocumentInterpretation,
  type ResolvedDocumentSuggestion,
} from "@/lib/document-interpretation";

type Draft = {
  kind: Exclude<TxKind, "transfer">;
  amount: number;
  entityId: string | null;
  categoryId: string | null;
  accountId: string | null;
  description: string;
  originalText: string;
  parser: "local" | "openai";
  installmentCount?: number;
  totalAmount?: number;
  documentDate?: string | null;
  vendor?: string | null;
  pending?: boolean;
};

type Props = {
  documents?: UploadedDocument[];
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

function parseBrazilianNumber(rawValue: string) {
  const value = parseBRLMoney(rawValue);
  return value !== null && value > 0 ? value : null;
}

function parseInstallment(text: string) {
  const match = text.match(/\b(\d{1,2})\s*x\s*(?:de\s*)?(?:r\$\s*)?(\d[\d.,]*)/i);
  if (!match) return null;
  const count = Number(match[1]);
  const installmentAmount = parseBrazilianNumber(match[2] ?? "");
  if (!Number.isInteger(count) || count < 2 || count > 60 || !installmentAmount) return null;
  return {
    count,
    installmentAmount,
    totalAmount: roundMoney(count * installmentAmount),
    matchedText: match[0],
  };
}

function parseAmount(text: string) {
  const installment = parseInstallment(text);
  if (installment) return installment.installmentAmount;
  const matches = text.match(/\d[\d.,]*/g) ?? [];
  for (const raw of matches) {
    const amount = parseBrazilianNumber(raw);
    if (amount) return amount;
  }
  return null;
}

function inferKind(text: string): Draft["kind"] {
  const n = normalize(text);
  const incomeWords = ["recebi", "receber", "entrou", "entrada", "vendi", "venda", "ganhei", "comissao", "faturei"];
  return incomeWords.some((word) => n.includes(word)) ? "income" : "expense";
}

function inferPending(text: string, kind: Draft["kind"]) {
  const n = normalize(text);
  if (kind === "income") return /(para (eu )?receber|a receber|vou receber|ainda vou receber|nao recebi)/.test(n);
  return /(para pagar|a pagar|vou pagar|ainda vou pagar|nao paguei)/.test(n);
}

function removeEntityMention(text: string, entityName?: string) {
  if (!entityName) return normalize(text);
  return normalize(text).replaceAll(normalize(entityName), " ").replace(/\s+/g, " ").trim();
}

export function MobileQuickEntry({ documents = [] }: Props) {
  const { data, entityId: selectedEntityId } = useEntityScope();
  const { user } = useAuthUser();
  const { canWrite } = useFinanceAccess();
  const refresh = useRefreshFinance();
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [listening, setListening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [interpreting, setInterpreting] = useState(false);
  const [review, setReview] = useState<{ documentId: string; suggestion: ResolvedDocumentSuggestion } | null>(null);
  const recognitionRef = useRef<InstanceType<SpeechRecognitionCtor> | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  const speechSupported = useMemo(
    () => typeof window !== "undefined" && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    [],
  );

  const resolveAiDraft = (ai: {
    kind?: "income" | "expense";
    amount?: number;
    entity_id?: string | null;
    category_id?: string | null;
    category_name?: string | null;
    entity_name?: string | null;
    account_id?: string | null;
    description?: string;
    document_date?: string | null;
    vendor?: string | null;
    confidence?: number;
  }, originalText: string): Draft | null => {
    if (!ai?.kind || !ai.amount || Number(ai.amount) <= 0 || (ai.confidence ?? 0) < 0.5) return null;
    const preferredEntityId = selectedEntityId !== "all" ? selectedEntityId : null;
    const entityMatch = matchEntityRecord(data.entities, originalText, preferredEntityId);
    const entityId = acceptedEntityId(entityMatch);
    const entity = entityId ? data.entities.find((e) => e.id === entityId) : undefined;
    const categoryId = resolveCategoryId(
      data.categories,
      ai.kind,
      null,
      `${ai.category_name ?? ""} ${ai.description ?? ""} ${ai.vendor ?? ""} ${originalText}`,
    );
    const account = entity
      ? data.accounts.find((a) => a.id === ai.account_id && a.entity_id === entity.id && a.active)
        ?? data.accounts.find((a) => a.entity_id === entity.id && a.active)
        ?? data.accounts.find((a) => a.entity_id === entity.id)
      : undefined;
    return {
      kind: ai.kind,
      amount: roundMoney(Number(ai.amount)),
      entityId: entity?.id ?? null,
      categoryId,
      accountId: account?.id ?? null,
      description: ai.description?.trim() || ai.vendor?.trim() || originalText || "Documento financeiro",
      originalText,
      parser: "openai",
      documentDate: parseLooseDate(typeof ai.document_date === "string" ? ai.document_date : null),
      vendor: ai.vendor ?? null,
      pending: inferPending(originalText, ai.kind),
    };
  };

  const localInterpret = (originalText: string) => {
    const installment = parseInstallment(originalText);
    const amount = installment?.installmentAmount ?? parseAmount(originalText);
    if (!amount) return null;
    const kind = inferKind(originalText);
    const preferredEntityId = selectedEntityId !== "all" ? selectedEntityId : null;
    const entityMatch = matchEntityRecord(data.entities, originalText, preferredEntityId);
    const entityId = acceptedEntityId(entityMatch);
    const entity = entityId ? data.entities.find((e) => e.id === entityId) : undefined;
    const account = entity
      ? data.accounts.find((a) => a.entity_id === entity.id && a.active) ?? data.accounts.find((a) => a.entity_id === entity.id)
      : undefined;

    const categoryText = removeEntityMention(originalText, entity?.name);
    const categories = selectableCategories(data.categories, kind);
    const categoryMatch = resolveCategoryMatch(categories, kind, categoryText);
    const categoryId = categoryMatch.ambiguous ? null : categoryMatch.id;

    let stripped = originalText;
    if (installment) stripped = stripped.replace(installment.matchedText, "");
    stripped = stripped.replace(/\b(parcelei|financiei|comprei|gastei|paguei|recebi|entrou|vendi|ganhei|faturei|reais|real|r\$|em|de|da|do)\b/gi, " ")
      .replace(/\d[\d.,]*/g, " ").replace(/\s+/g, " ").trim();
    if (entity?.name) stripped = removeEntityMention(stripped, entity.name);

    const result: Draft = {
      kind, amount, entityId: entity?.id ?? null, categoryId, accountId: account?.id ?? null,
      description: stripped || (kind === "income" ? "Entrada rápida" : "Saída rápida"),
      originalText, parser: "local", ...(installment ? { installmentCount: installment.count, totalAmount: installment.totalAmount } : {}),
      vendor: stripped || null,
      pending: inferPending(originalText, kind),
    };
    const confident = !categoryMatch.ambiguous && categoryMatch.confidence >= 0.8;
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
        selected_entity_id: selectedEntityId !== "all" ? selectedEntityId : null,
        entities: data.entities.map((entity) => compactAiEntity(entity)),
        categories: selectableCategories(data.categories).map((category) => compactAiCategory(category)),
        accounts: data.accounts.filter((a) => a.active).map(({ id, name, entity_id }) => ({ id, name, entity_id })),
      }),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { interpretation?: Parameters<typeof resolveAiDraft>[0] };
    return payload.interpretation ? resolveAiDraft(payload.interpretation, originalText) : null;
  };

  const documentInterpret = async (originalText: string) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const document = documents.find((item) => item.id);
    if (!token || !document?.id) {
      throw new Error("O documento precisa estar catalogado antes da leitura.");
    }
    return requestDocumentInterpretation({
      documentId: document.id,
      token,
      text: originalText,
      selectedEntityId: selectedEntityId !== "all" ? selectedEntityId : null,
    });
  };

  const interpret = async (value = text) => {
    const originalText = value.trim();
    if (!canWrite) { toast.error("Seu acesso é somente leitura."); return; }
    if (!originalText && !documents.length) { toast.error("Digite, fale ou anexe um documento."); return; }
    if (!documents.length && !parseAmount(originalText)) { toast.error("Não encontrei o valor. Ex.: gastei 180 combustível."); return; }

    setInterpreting(true);
    if (documents.length) {
      try {
        const result = await documentInterpret(originalText);
        const document = documents.find((item) => item.id);
        setInterpreting(false);
        if (!document?.id) {
          toast.error("Documento sem metadata. Recatalogue em Documentos.");
          return;
        }
        setReview({ documentId: document.id, suggestion: result.interpretation });
        toast.success("Documento lido. Confira os dados antes de confirmar.");
        return;
      } catch (error) {
        setInterpreting(false);
        const code = (error as Error & { code?: string }).code;
        if (code === "processing_in_progress") {
          toast.message("Este documento já está sendo lido. Aguarde e tente de novo.");
        } else {
          toast.error(error instanceof Error ? error.message : "Não consegui ler o documento.");
        }
        return;
      }
    }

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
    toast.error("Não consegui interpretar. Ajuste o texto ou anexe um documento.");
  };

  const startVoice = () => {
    if (!speechSupported) { toast.error("Reconhecimento de voz não disponível neste navegador."); return; }
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
    if (!canWrite) { toast.error("Seu acesso é somente leitura."); return; }
    if (!draft.entityId) { toast.error("Selecione a entidade."); return; }
    if (!draft.accountId) { toast.error("Selecione a conta da entidade."); return; }
    if (saving) return;
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = newIdempotencyKey();
    setSaving(true);
    const today = localDateIso();
    const txDate = draft.documentDate && isValidDateIso(draft.documentDate) ? draft.documentDate : today;
    const source = draft.parser === "openai" ? (documents.length ? "document_openai" : "mobile_openai") : "mobile_quick_entry";
    const installments = draft.installmentCount && draft.installmentCount > 1 ? draft.installmentCount : 1;
    const isPending = Boolean(draft.pending);

    const { data: txId, error } = await supabase.rpc("create_transaction", {
      p_entity_id: draft.entityId,
      p_account_id: draft.accountId,
      p_kind: draft.kind,
      p_description: draft.description,
      p_amount: draft.amount,
      p_category_id: draft.categoryId ?? undefined,
      p_to_account_id: undefined,
      p_payment_method: "other",
      p_competence_date: txDate,
      p_due_date: txDate,
      p_status: isPending ? "pending" : "paid",
      p_notes: `Comando original: ${draft.originalText || "Documento anexado"}${draft.vendor ? ` | Documento: ${draft.vendor}` : ""}`,
      p_installments: installments,
      p_amount_mode: installments > 1 ? "each" : "total",
      p_shift_competence: installments > 1,
      p_source: source,
      p_idempotency_key: idempotencyKeyRef.current,
    } as never);
    if (error || !txId) {
      setSaving(false);
      toast.error(rpcErrorMessage(error, "Não foi possível confirmar o lançamento."));
      return;
    }

    setSaving(false);
    idempotencyKeyRef.current = null;
    if (installments > 1) {
      toast.success(`${installments} parcelas criadas no contas a pagar.`);
    } else {
      toast.success(isPending ? (draft.kind === "income" ? "Conta a receber criada." : "Conta a pagar criada.") : "Lançamento confirmado.");
    }
    setDraft(null);
    setText("");
    refresh();
  };

  const category = draft ? data.categories.find((c) => c.id === draft.categoryId) : null;
  const account = draft ? data.accounts.find((a) => a.id === draft.accountId) : null;

  return (
    <section className="rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/10 to-card p-4 shadow-sm md:p-5">
      <div className="mb-3">
        <div className="flex items-center gap-2 text-primary"><Sparkles className="size-4" /><span className="text-xs font-semibold uppercase tracking-[0.16em]">Lançamento rápido</span></div>
        <h2 className="mt-1 text-lg font-semibold">Digite, fale ou anexe um documento</h2>
        <p className="mt-1 text-xs text-muted-foreground">Com anexo, a IA lê a nota/PDF e extrai os dados financeiros.</p>
      </div>

      {review ? (
        <DocumentReviewDialog
          key={review.documentId}
          open
          documentId={review.documentId}
          suggestion={review.suggestion}
          onOpenChange={(open) => { if (!open) setReview(null); }}
          onConfirmed={() => {
            setReview(null);
            setText("");
            refresh();
          }}
        />
      ) : null}

      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={documents.length ? "Opcional: ex. nota da Comparta para eu receber" : "Recebi 2.607 da Energia..."} className="resize-none bg-background/70 text-base" />

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-11 gap-2" onClick={listening ? stopVoice : startVoice}>
          {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}{listening ? "Parar" : "Falar"}
        </Button>
        <Button className="h-11 gap-2" disabled={interpreting} onClick={() => void interpret()}>
          <Send className="size-4" /> {interpreting ? (documents.length ? "Lendo documento..." : "Entendendo...") : "Interpretar"}
        </Button>
      </div>

      {draft ? (
        <div className="mt-4 rounded-xl border border-border bg-background/75 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Confirme antes de salvar</p>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{documents.length ? "IA + documento" : draft.parser === "openai" ? "IA" : "Local"}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><span className="block text-[11px] text-muted-foreground">Tipo</span><strong>{draft.kind === "income" ? "Entrada" : "Saída"}</strong></div>
            <div><span className="block text-[11px] text-muted-foreground">{draft.installmentCount ? "Valor da parcela" : "Valor"}</span><strong className={draft.kind === "income" ? "text-success" : "text-destructive"}>{brl(draft.amount)}</strong></div>
            <div className="col-span-2">
              <span className="block text-[11px] text-muted-foreground">Entidade</span>
              <Select
                value={draft.entityId ?? ""}
                onValueChange={(value) => {
                  const chosen = data.entities.find((item) => item.id === value);
                  const nextAccount = chosen
                    ? data.accounts.find((item) => item.entity_id === chosen.id && item.active)
                      ?? data.accounts.find((item) => item.entity_id === chosen.id)
                    : undefined;
                  setDraft({ ...draft, entityId: value, accountId: nextAccount?.id ?? null });
                }}
              >
                <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Selecione a entidade" /></SelectTrigger>
                <SelectContent>
                  {data.entities.filter((item) => item.active).map((item) => (
                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!draft.entityId ? (
                <p className="mt-1 text-[11px] text-muted-foreground">O texto não indicou a entidade. Escolha antes de confirmar.</p>
              ) : null}
            </div>
            <div><span className="block text-[11px] text-muted-foreground">Categoria</span><strong>{category?.name ?? "Sem categoria"}</strong></div>
            <div><span className="block text-[11px] text-muted-foreground">Status</span><strong>{draft.pending ? (draft.kind === "income" ? "A receber" : "A pagar") : "Liquidado"}</strong></div>
            <div><span className="block text-[11px] text-muted-foreground">Data</span><strong>{draft.documentDate ?? "Hoje"}</strong></div>
            {draft.vendor ? <div className="col-span-2"><span className="block text-[11px] text-muted-foreground">Documento / fornecedor</span><strong>{draft.vendor}</strong></div> : null}
            {draft.installmentCount ? <><div><span className="block text-[11px] text-muted-foreground">Parcelas</span><strong>{draft.installmentCount}x</strong></div><div><span className="block text-[11px] text-muted-foreground">Total contratado</span><strong>{brl(draft.totalAmount ?? draft.amount * draft.installmentCount)}</strong></div></> : null}
            <div className="col-span-2"><span className="block text-[11px] text-muted-foreground">Conta</span><strong>{account?.name ?? "—"}</strong></div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button variant="ghost" className="gap-2" onClick={() => setDraft(null)}><RotateCcw className="size-4" /> Corrigir</Button>
            <Button className="gap-2" disabled={saving || !canWrite || !draft.entityId} onClick={confirm}><Check className="size-4" /> {saving ? "Salvando..." : "Confirmar"}</Button>
          </div>
        </div>
      ) : null}

      {!speechSupported ? <p className="mt-3 text-[11px] text-muted-foreground">Seu navegador não expõe reconhecimento de voz. Texto e documentos continuam funcionando normalmente.</p> : null}
    </section>
  );
}
