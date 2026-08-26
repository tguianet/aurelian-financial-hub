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
import { compactAiCategory, compactAiEntity, selectableCategories } from "@/lib/categories";
import { isValidDateIso, localDateIso, parseLooseDate } from "@/lib/date";
import { parseBRLMoney, roundMoney } from "@/lib/money";
import { newIdempotencyKey } from "@/lib/idempotency";
import { rpcErrorMessage } from "@/lib/rpc-error";
import { resolveQuickEntryFields, type QuickEntryResolution } from "@/lib/semantic-rules";
import { DocumentReviewDialog } from "./DocumentReviewDialog";
import { DisambiguationDialog } from "./DisambiguationDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  requestDocumentInterpretation,
  type ResolvedDocumentSuggestion,
} from "@/lib/document-interpretation";

type PaymentMethod = "pix" | "cash" | "debit" | "credit" | "boleto" | "transfer" | "other";

type Draft = {
  kind: TxKind;
  amount: number;
  entityId: string | null;
  categoryId: string | null;
  accountId: string | null;
  toAccountId: string | null;
  creditCardId: string | null;
  paymentMethod: PaymentMethod;
  description: string;
  originalText: string;
  parser: "local" | "openai";
  installmentCount?: number;
  totalAmount?: number;
  documentDate?: string | null;
  vendor?: string | null;
  pending?: boolean;
};

type PendingDisambiguation = {
  draft: Draft;
  resolution: QuickEntryResolution;
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
  if (!Number.isInteger(count) || count < 2 || count > 48 || !installmentAmount) return null;
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

function inferKind(text: string): Exclude<TxKind, "transfer"> {
  const n = normalize(text);
  const incomeWords = ["recebi", "receber", "entrou", "entrada", "vendi", "venda", "ganhei", "comissao", "faturei"];
  return incomeWords.some((word) => n.includes(word)) ? "income" : "expense";
}

function inferPending(text: string, kind: TxKind) {
  if (kind === "transfer") return false;
  const n = normalize(text);
  if (kind === "income") return /(para (eu )?receber|a receber|vou receber|ainda vou receber|nao recebi)/.test(n);
  return /(para pagar|a pagar|vou pagar|ainda vou pagar|nao paguei)/.test(n);
}

function inferPaymentMethod(text: string, kind: TxKind): PaymentMethod {
  if (kind === "transfer") return "transfer";
  const n = normalize(text);
  if (/\bpix\b/.test(n)) return "pix";
  if (kind === "expense" && /cartao de credito|credito|no credito/.test(n)) return "credit";
  if (/cartao de debito|debito|no debito/.test(n)) return "debit";
  if (/\bboleto\b/.test(n)) return "boleto";
  if (/transferencia|transferi|ted|doc bancario/.test(n)) return "transfer";
  if (/dinheiro|especie|em especie/.test(n)) return "cash";
  return "other";
}

function paymentMethodLabel(method: PaymentMethod) {
  if (method === "pix") return "Pix";
  if (method === "cash") return "Dinheiro";
  if (method === "debit") return "Débito";
  if (method === "credit") return "Cartão de crédito";
  if (method === "boleto") return "Boleto";
  if (method === "transfer") return "Transferência";
  return "Outro";
}

function hasInternalTransferIntent(text: string, mentionedAccounts: number) {
  const n = normalize(text);
  const explicitOwnMovement = /(entre (as )?minhas contas|de uma conta (para|pra) outra|minha conta.+(para|pra).+minha conta|movi dinheiro|movimentei dinheiro|passei dinheiro)/.test(n);
  const transferVerb = /(transferi|transferencia|movi|movimentei|passei)/.test(n);
  return explicitOwnMovement || (transferVerb && mentionedAccounts >= 2);
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
  const [pending, setPending] = useState<PendingDisambiguation | null>(null);
  const recognitionRef = useRef<InstanceType<SpeechRecognitionCtor> | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  const learnedRules = useMemo(
    () => (data.semanticRules ?? []).filter((rule) => rule.active !== false),
    [data.semanticRules],
  );

  const resolveFields = (originalText: string, kind: Exclude<TxKind, "transfer">, categoryHint?: string | null) =>
    resolveQuickEntryFields({
      text: originalText,
      kind,
      entities: data.entities,
      categories: selectableCategories(data.categories, kind),
      rules: learnedRules,
      preferredEntityId: selectedEntityId !== "all" ? selectedEntityId : null,
      categoryHint: categoryHint ?? originalText,
    });

  const mentionedAccountsInText = (originalText: string) => {
    const normalizedText = normalize(originalText);
    return data.accounts
      .filter((account) => account.active)
      .map((account) => {
        const candidates = [account.name, account.bank ?? ""]
          .map(normalize)
          .filter((value) => value.length >= 3);
        const indexes = candidates
          .map((value) => normalizedText.indexOf(value))
          .filter((index) => index >= 0);
        return { account, index: indexes.length ? Math.min(...indexes) : -1 };
      })
      .filter((item) => item.index >= 0)
      .sort((a, b) => a.index - b.index);
  };

  const accountForEntity = (entityId: string | null, preferredAccountId?: string | null, originalText?: string) => {
    if (!entityId) return null;
    const activeAccounts = data.accounts.filter((account) => account.entity_id === entityId && account.active);
    if (originalText) {
      const normalizedText = normalize(originalText);
      const mentioned = activeAccounts.filter((account) => {
        const name = normalize(account.name);
        const bank = normalize(account.bank ?? "");
        return (name.length >= 3 && normalizedText.includes(name)) || (bank.length >= 3 && normalizedText.includes(bank));
      });
      if (mentioned.length === 1) return mentioned[0]?.id ?? null;
    }
    if (preferredAccountId && activeAccounts.some((account) => account.id === preferredAccountId)) return preferredAccountId;
    return activeAccounts.length === 1 ? activeAccounts[0]?.id ?? null : null;
  };

  const cardForEntity = (entityId: string | null, originalText?: string) => {
    if (!entityId) return null;
    const activeCards = data.cards.filter((card) => card.entity_id === entityId && card.active);
    if (originalText) {
      const normalizedText = normalize(originalText);
      const mentioned = activeCards.filter((card) => {
        const name = normalize(card.name);
        const brand = normalize(card.brand ?? "");
        return (name.length >= 3 && normalizedText.includes(name)) || (brand.length >= 3 && normalizedText.includes(brand));
      });
      if (mentioned.length === 1) return mentioned[0]?.id ?? null;
    }
    return activeCards.length === 1 ? activeCards[0]?.id ?? null : null;
  };

  const presentDraft = (result: Draft, resolution?: QuickEntryResolution) => {
    if (result.kind === "transfer" || !resolution) {
      setPending(null);
      setDraft(result);
      return;
    }
    if (resolution.appliedRule?.id) {
      void supabase.rpc("touch_finance_semantic_rule_usage", { p_id: resolution.appliedRule.id });
    }
    if (resolution.needsEntity || resolution.needsCategory) {
      setDraft(null);
      setPending({ draft: result, resolution });
      return;
    }
    setPending(null);
    setDraft(result);
  };

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
  }, originalText: string): { draft: Draft; resolution: QuickEntryResolution } | null => {
    if (!ai?.kind || !ai.amount || Number(ai.amount) <= 0 || (ai.confidence ?? 0) < 0.5) return null;
    const resolved = resolveFields(originalText, ai.kind, `${ai.category_name ?? ""} ${ai.description ?? ""} ${ai.vendor ?? ""} ${originalText}`);
    const paymentMethod = inferPaymentMethod(originalText, ai.kind);
    return {
      resolution: resolved,
      draft: {
        kind: ai.kind,
        amount: roundMoney(Number(ai.amount)),
        entityId: resolved.entityId,
        categoryId: resolved.categoryId,
        accountId: paymentMethod === "credit" ? null : accountForEntity(resolved.entityId, ai.account_id, originalText),
        toAccountId: null,
        creditCardId: paymentMethod === "credit" ? cardForEntity(resolved.entityId, originalText) : null,
        paymentMethod,
        description: ai.description?.trim() || ai.vendor?.trim() || originalText || "Documento financeiro",
        originalText,
        parser: "openai",
        documentDate: parseLooseDate(typeof ai.document_date === "string" ? ai.document_date : null),
        vendor: ai.vendor ?? resolved.originalHint ?? null,
        pending: inferPending(originalText, ai.kind),
      },
    };
  };

  const localInterpret = (originalText: string) => {
    const installment = parseInstallment(originalText);
    const amount = installment?.installmentAmount ?? parseAmount(originalText);
    if (!amount) return null;

    const mentionedAccounts = mentionedAccountsInText(originalText);
    if (hasInternalTransferIntent(originalText, mentionedAccounts.length)) {
      const source = mentionedAccounts[0]?.account ?? null;
      const destination = mentionedAccounts.find((item) => item.account.id !== source?.id)?.account ?? null;
      const entityId = source?.entity_id ?? (selectedEntityId !== "all" ? selectedEntityId : null);
      const fallbackSource = source?.id ?? accountForEntity(entityId, null, undefined);
      const result: Draft = {
        kind: "transfer",
        amount: roundMoney(amount),
        entityId: source?.entity_id ?? entityId,
        categoryId: null,
        accountId: fallbackSource,
        toAccountId: destination?.id ?? null,
        creditCardId: null,
        paymentMethod: "transfer",
        description: "Transferência entre contas",
        originalText,
        parser: "local",
        documentDate: null,
        vendor: null,
        pending: false,
      };
      return { result, resolved: null, skipAi: true };
    }

    const kind = inferKind(originalText);
    const resolved = resolveFields(originalText, kind);
    const entity = resolved.entityId ? data.entities.find((item) => item.id === resolved.entityId) : undefined;
    const paymentMethod = inferPaymentMethod(originalText, kind);

    let stripped = originalText;
    if (installment) stripped = stripped.replace(installment.matchedText, "");
    stripped = stripped.replace(/\b(parcelei|financiei|comprei|gastei|paguei|recebi|entrou|vendi|ganhei|faturei|reais|real|r\$|pix|boleto|debito|credito|dinheiro|transferencia|em|de|da|do)\b/gi, " ")
      .replace(/\d[\d.,]*/g, " ").replace(/\s+/g, " ").trim();
    if (entity?.name) stripped = removeEntityMention(stripped, entity.name);

    const result: Draft = {
      kind,
      amount,
      entityId: resolved.entityId,
      categoryId: resolved.categoryId,
      accountId: paymentMethod === "credit" ? null : accountForEntity(resolved.entityId, null, originalText),
      toAccountId: null,
      creditCardId: paymentMethod === "credit" ? cardForEntity(resolved.entityId, originalText) : null,
      paymentMethod,
      description: stripped || resolved.originalHint || (kind === "income" ? "Entrada rápida" : "Saída rápida"),
      originalText,
      parser: "local",
      ...(installment ? { installmentCount: installment.count, totalAmount: installment.totalAmount } : {}),
      vendor: stripped || resolved.originalHint || null,
      pending: inferPending(originalText, kind),
    };
    const skipAi = (!resolved.needsEntity && !resolved.needsCategory) || (!resolved.needsCategory && resolved.categoryMatch.confidence >= 0.8);
    return { result, resolved, skipAi };
  };

  const aiInterpret = async (originalText: string) => {
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
    const readyDocuments = documents.filter((item) => item.id);
    if (readyDocuments.length > 1) throw new Error("Para evitar lançar o documento errado, deixe apenas um anexo no lançamento rápido.");
    const document = readyDocuments[0];
    if (!token || !document?.id) throw new Error("O documento precisa estar catalogado antes da leitura.");
    return requestDocumentInterpretation({ documentId: document.id, token, text: originalText, selectedEntityId: selectedEntityId !== "all" ? selectedEntityId : null });
  };

  const interpret = async (value = text) => {
    const originalText = value.trim();
    if (!canWrite) { toast.error("Seu acesso é somente leitura."); return; }
    if (!originalText && !documents.length) { toast.error("Digite, fale ou anexe um documento."); return; }
    if (!documents.length && !parseAmount(originalText)) { toast.error("Não encontrei o valor. Ex.: paguei 180 de combustível no Pix."); return; }

    setPending(null);
    setDraft(null);
    setInterpreting(true);
    if (documents.length) {
      try {
        const result = await documentInterpret(originalText);
        const document = documents.filter((item) => item.id)[0];
        setInterpreting(false);
        if (!document?.id) { toast.error("Documento sem metadata. Recatalogue em Documentos."); return; }
        setReview({ documentId: document.id, suggestion: result.interpretation });
        toast.success("Documento lido. Confira os dados antes de confirmar.");
        return;
      } catch (error) {
        setInterpreting(false);
        const code = (error as Error & { code?: string }).code;
        if (code === "processing_in_progress") toast.message("Este documento já está sendo lido. Aguarde e tente de novo.");
        else toast.error(error instanceof Error ? error.message : "Não consegui ler o documento.");
        return;
      }
    }

    const local = localInterpret(originalText);
    if (local?.skipAi) { presentDraft(local.result, local.resolved ?? undefined); setInterpreting(false); return; }
    try {
      const ai = await aiInterpret(originalText);
      if (ai) { presentDraft(ai.draft, ai.resolution); setInterpreting(false); return; }
    } catch (error) {
      console.warn("Fallback OpenAI indisponível", error);
    }
    setInterpreting(false);
    if (local?.result) { presentDraft(local.result, local.resolved ?? undefined); toast.message("Usei a interpretação local. Confira antes de confirmar."); return; }
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
    if (!draft.entityId) { toast.error("Escolha de quem é essa movimentação."); return; }
    const isTransfer = draft.kind === "transfer";
    const isCreditPurchase = draft.kind === "expense" && draft.paymentMethod === "credit";
    if (isTransfer && !draft.accountId) { toast.error("Escolha de qual conta o dinheiro saiu."); return; }
    if (isTransfer && !draft.toAccountId) { toast.error("Escolha para qual conta o dinheiro foi."); return; }
    if (isTransfer && draft.accountId === draft.toAccountId) { toast.error("A conta de origem e a conta de destino precisam ser diferentes."); return; }
    if (isCreditPurchase && !draft.creditCardId) { toast.error("Escolha qual cartão de crédito foi usado."); return; }
    if (!isTransfer && !isCreditPurchase && !draft.accountId) { toast.error("Escolha em qual conta o dinheiro entrou ou saiu."); return; }
    if (saving) return;

    setSaving(true);
    const txDate = draft.documentDate && isValidDateIso(draft.documentDate) ? draft.documentDate : localDateIso();
    const installments = draft.installmentCount && draft.installmentCount > 1 ? draft.installmentCount : 1;

    if (isCreditPurchase) {
      const totalAmount = roundMoney(draft.totalAmount ?? draft.amount * installments);
      const { error } = await supabase.rpc("create_credit_card_purchase", {
        _credit_card_id: draft.creditCardId,
        _category_id: draft.categoryId ?? undefined,
        _description: draft.description,
        _total_amount: totalAmount,
        _purchase_date: txDate,
        _installments: installments,
      } as never);
      setSaving(false);
      if (error) { toast.error(rpcErrorMessage(error, "Não foi possível registrar a compra no cartão.")); return; }
      toast.success("Compra no cartão registrada sem duplicar a despesa quando a fatura for paga.");
      setDraft(null);
      setText("");
      refresh();
      return;
    }

    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = newIdempotencyKey();
    const source = draft.parser === "openai" ? (documents.length ? "document_openai" : "mobile_openai") : "mobile_quick_entry";
    const isPending = Boolean(draft.pending);
    const { data: txId, error } = await supabase.rpc("create_transaction", {
      p_entity_id: draft.entityId,
      p_account_id: draft.accountId,
      p_kind: draft.kind,
      p_description: draft.description,
      p_amount: draft.amount,
      p_category_id: isTransfer ? undefined : draft.categoryId ?? undefined,
      p_to_account_id: isTransfer ? draft.toAccountId ?? undefined : undefined,
      p_payment_method: isTransfer ? "transfer" : draft.paymentMethod,
      p_competence_date: txDate,
      p_due_date: txDate,
      p_status: isTransfer ? "paid" : isPending ? "pending" : draft.kind === "income" ? "received" : "paid",
      p_notes: `Comando original: ${draft.originalText || "Documento anexado"}${draft.vendor ? ` | Documento: ${draft.vendor}` : ""}`,
      p_installments: isTransfer ? 1 : installments,
      p_amount_mode: isTransfer ? "total" : installments > 1 ? "each" : "total",
      p_shift_competence: isTransfer ? false : installments > 1,
      p_source: source,
      p_idempotency_key: idempotencyKeyRef.current,
    } as never);
    setSaving(false);
    if (error || !txId) { toast.error(rpcErrorMessage(error, isTransfer ? "Não foi possível transferir entre as contas." : "Não foi possível confirmar o lançamento.")); return; }

    idempotencyKeyRef.current = null;
    if (isTransfer) toast.success("Transferência registrada sem contar como receita ou despesa.");
    else if (installments > 1) toast.success(`${installments} parcelas criadas no contas a pagar.`);
    else toast.success(isPending ? (draft.kind === "income" ? "Conta a receber criada." : "Conta a pagar criada.") : "Lançamento confirmado.");
    setDraft(null);
    setText("");
    refresh();
  };

  const account = draft ? data.accounts.find((a) => a.id === draft.accountId) : null;
  const toAccount = draft ? data.accounts.find((a) => a.id === draft.toAccountId) : null;
  const card = draft ? data.cards.find((c) => c.id === draft.creditCardId) : null;
  const isTransfer = draft?.kind === "transfer";
  const isCreditPurchase = draft?.kind === "expense" && draft.paymentMethod === "credit";
  const entityAccounts = draft?.entityId ? data.accounts.filter((a) => a.entity_id === draft.entityId && a.active) : [];
  const destinationAccounts = data.accounts.filter((a) => a.active && a.id !== draft?.accountId);
  const entityCards = draft?.entityId ? data.cards.filter((c) => c.entity_id === draft.entityId && c.active) : [];

  return (
    <section className="rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/10 to-card p-4 shadow-sm md:p-5">
      <div className="mb-3">
        <div className="flex items-center gap-2 text-primary"><Sparkles className="size-4" /><span className="text-xs font-semibold uppercase tracking-[0.16em]">Lançamento rápido</span></div>
        <h2 className="mt-1 text-lg font-semibold">Conte o que aconteceu</h2>
        <p className="mt-1 text-xs text-muted-foreground">Ex.: “Paguei 430 de combustível da TGuiaNet no Pix pelo Inter” ou “Transferi 500 do Inter para o Nubank”.</p>
      </div>

      {review ? (
        <DocumentReviewDialog key={review.documentId} open documentId={review.documentId} suggestion={review.suggestion} onOpenChange={(open) => { if (!open) setReview(null); }} onConfirmed={() => { setReview(null); setText(""); refresh(); }} />
      ) : null}

      {pending ? (
        <DisambiguationDialog
          key={`${pending.draft.originalText}-${pending.draft.amount}`}
          open
          amount={pending.draft.amount}
          kind={pending.draft.kind === "transfer" ? "expense" : pending.draft.kind}
          hint={pending.resolution.originalHint || pending.draft.vendor || pending.draft.description}
          categoryName={data.categories.find((item) => item.id === pending.draft.categoryId)?.name ?? null}
          needsEntity={pending.resolution.needsEntity}
          needsCategory={pending.resolution.needsCategory}
          entities={data.entities}
          categories={pending.draft.kind === "transfer" ? [] : selectableCategories(data.categories, pending.draft.kind)}
          suggestedEntityId={pending.resolution.partialRules.find((rule) => rule.entity_id)?.entity_id ?? pending.draft.entityId}
          suggestedCategoryId={pending.resolution.partialRules.find((rule) => rule.category_id)?.category_id ?? pending.draft.categoryId}
          canRemember={canWrite && pending.resolution.hint.length >= 3}
          onCancel={() => setPending(null)}
          onComplete={(choice) => {
            const entityId = pending.resolution.needsEntity ? choice.entityId : pending.draft.entityId;
            const categoryId = pending.resolution.needsCategory ? choice.categoryId : pending.draft.categoryId;
            if (choice.remember && canWrite && pending.resolution.hint.length >= 3) {
              const args: { p_normalized_hint: string; p_original_hint: string; p_entity_id?: string; p_category_id?: string } = {
                p_normalized_hint: pending.resolution.hint,
                p_original_hint: pending.resolution.originalHint || pending.resolution.hint,
              };
              if (entityId) args.p_entity_id = entityId;
              if (categoryId) args.p_category_id = categoryId;
              void supabase.rpc("upsert_finance_semantic_rule", args).then(({ error }) => {
                if (error) toast.error(rpcErrorMessage(error, "Não consegui lembrar esta escolha."));
                else refresh();
              });
            }
            const paymentMethod = pending.draft.paymentMethod;
            setPending(null);
            setDraft({
              ...pending.draft,
              entityId,
              categoryId,
              accountId: paymentMethod === "credit" ? null : accountForEntity(entityId, pending.draft.accountId, pending.draft.originalText),
              toAccountId: null,
              creditCardId: paymentMethod === "credit" ? cardForEntity(entityId, pending.draft.originalText) : null,
            });
          }}
        />
      ) : null}

      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={documents.length ? "Opcional: diga o que é esse documento" : "Ex.: transferi 500 do Inter para o Nubank"} className="resize-none bg-background/70 text-base" />

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-11 gap-2" onClick={listening ? stopVoice : startVoice}>
          {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}{listening ? "Parar" : "Falar"}
        </Button>
        <Button className="h-11 gap-2" disabled={interpreting} onClick={() => void interpret()}>
          <Send className="size-4" /> {interpreting ? (documents.length ? "Lendo documento..." : "Entendendo...") : "Entender"}
        </Button>
      </div>

      {draft ? (
        <div className="mt-4 rounded-xl border border-border bg-background/75 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Foi isso que aconteceu?</p>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{documents.length ? "IA + documento" : draft.parser === "openai" ? "IA" : "Local"}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><span className="block text-[11px] text-muted-foreground">O que aconteceu</span><strong>{isTransfer ? "Movi dinheiro entre contas" : draft.kind === "income" ? "Dinheiro entrou" : "Dinheiro saiu"}</strong></div>
            <div><span className="block text-[11px] text-muted-foreground">{draft.installmentCount && !isTransfer ? "Valor da parcela" : "Valor"}</span><strong className={isTransfer ? "" : draft.kind === "income" ? "text-success" : "text-destructive"}>{brl(draft.amount)}</strong></div>
            <div className="col-span-2">
              <span className="block text-[11px] text-muted-foreground">{isTransfer ? "De quem é o dinheiro" : "De quem é"}</span>
              <Select value={draft.entityId ?? ""} onValueChange={(value) => {
                const paymentMethod = draft.paymentMethod;
                setDraft({ ...draft, entityId: value, accountId: isTransfer ? accountForEntity(value, null, undefined) : paymentMethod === "credit" ? null : accountForEntity(value, null, draft.originalText), toAccountId: isTransfer ? null : draft.toAccountId, creditCardId: paymentMethod === "credit" ? cardForEntity(value, draft.originalText) : null });
              }}>
                <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Escolha" /></SelectTrigger>
                <SelectContent>{data.entities.filter((item) => item.active).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
              </Select>
              {!draft.entityId ? <p className="mt-1 text-[11px] text-muted-foreground">Não consegui identificar. Escolha antes de confirmar.</p> : null}
            </div>
            {!isTransfer ? (
              <div>
                <span className="block text-[11px] text-muted-foreground">Organizar em</span>
                <Select value={draft.categoryId ?? ""} onValueChange={(value) => setDraft({ ...draft, categoryId: value })}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Escolha a categoria" /></SelectTrigger>
                  <SelectContent>{selectableCategories(data.categories, draft.kind).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ) : null}
            <div><span className="block text-[11px] text-muted-foreground">Situação</span><strong>{isTransfer ? "Transferência interna" : draft.pending ? (draft.kind === "income" ? "Ainda vou receber" : "Ainda vou pagar") : (draft.kind === "income" ? "Já recebi" : "Já paguei")}</strong></div>
            <div><span className="block text-[11px] text-muted-foreground">Quando</span><strong>{draft.documentDate ?? "Hoje"}</strong></div>
            {!isTransfer ? (
              <div>
                <span className="block text-[11px] text-muted-foreground">Como</span>
                <Select value={draft.paymentMethod} onValueChange={(value) => {
                  const paymentMethod = value as PaymentMethod;
                  setDraft({ ...draft, paymentMethod, accountId: paymentMethod === "credit" ? null : accountForEntity(draft.entityId, draft.accountId, draft.originalText), creditCardId: paymentMethod === "credit" ? cardForEntity(draft.entityId, draft.originalText) : null });
                }}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue>{paymentMethodLabel(draft.paymentMethod)}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pix">Pix</SelectItem><SelectItem value="cash">Dinheiro</SelectItem><SelectItem value="debit">Débito</SelectItem>
                    {draft.kind === "expense" ? <SelectItem value="credit">Cartão de crédito</SelectItem> : null}
                    <SelectItem value="boleto">Boleto</SelectItem><SelectItem value="transfer">Transferência</SelectItem><SelectItem value="other">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {draft.vendor && !isTransfer ? <div className="col-span-2"><span className="block text-[11px] text-muted-foreground">O que foi</span><strong>{draft.vendor}</strong></div> : null}
            {draft.installmentCount && !isTransfer ? <><div><span className="block text-[11px] text-muted-foreground">Parcelas</span><strong>{draft.installmentCount}x</strong></div><div><span className="block text-[11px] text-muted-foreground">Total</span><strong>{brl(draft.totalAmount ?? draft.amount * draft.installmentCount)}</strong></div></> : null}
            {isTransfer ? (
              <>
                <div className="col-span-2">
                  <span className="block text-[11px] text-muted-foreground">De qual conta saiu?</span>
                  <Select value={draft.accountId ?? ""} onValueChange={(value) => {
                    const selected = data.accounts.find((item) => item.id === value);
                    setDraft({ ...draft, accountId: value, entityId: selected?.entity_id ?? draft.entityId, toAccountId: draft.toAccountId === value ? null : draft.toAccountId });
                  }}>
                    <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Escolha a conta de origem" /></SelectTrigger>
                    <SelectContent>{entityAccounts.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}{item.bank ? ` · ${item.bank}` : ""}</SelectItem>)}</SelectContent>
                  </Select>
                  {!account ? <p className="mt-1 text-[11px] text-muted-foreground">Escolha a conta de onde o dinheiro saiu.</p> : null}
                </div>
                <div className="col-span-2">
                  <span className="block text-[11px] text-muted-foreground">Para qual conta foi?</span>
                  <Select value={draft.toAccountId ?? ""} onValueChange={(value) => setDraft({ ...draft, toAccountId: value })}>
                    <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Escolha a conta de destino" /></SelectTrigger>
                    <SelectContent>{destinationAccounts.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}{item.bank ? ` · ${item.bank}` : ""}</SelectItem>)}</SelectContent>
                  </Select>
                  {!toAccount ? <p className="mt-1 text-[11px] text-muted-foreground">Escolha a conta que recebeu o dinheiro.</p> : null}
                </div>
                <div className="col-span-2 rounded-lg border border-primary/20 bg-primary/5 p-2 text-[11px] text-muted-foreground">Essa movimentação altera os saldos das contas, mas não entra como receita nem despesa.</div>
              </>
            ) : isCreditPurchase ? (
              <div className="col-span-2">
                <span className="block text-[11px] text-muted-foreground">Cartão</span>
                <Select value={draft.creditCardId ?? ""} onValueChange={(value) => setDraft({ ...draft, creditCardId: value })}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Escolha o cartão" /></SelectTrigger>
                  <SelectContent>{entityCards.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}{item.brand ? ` · ${item.brand}` : ""}</SelectItem>)}</SelectContent>
                </Select>
                {!card ? <p className="mt-1 text-[11px] text-muted-foreground">Escolha o cartão para eu tratar a fatura sem duplicar essa despesa.</p> : null}
              </div>
            ) : (
              <div className="col-span-2">
                <span className="block text-[11px] text-muted-foreground">Conta</span>
                <Select value={draft.accountId ?? ""} onValueChange={(value) => setDraft({ ...draft, accountId: value })}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Escolha a conta" /></SelectTrigger>
                  <SelectContent>{entityAccounts.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}{item.bank ? ` · ${item.bank}` : ""}</SelectItem>)}</SelectContent>
                </Select>
                {!account ? <p className="mt-1 text-[11px] text-muted-foreground">Escolha a conta quando houver mais de uma possibilidade.</p> : null}
              </div>
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button variant="ghost" className="gap-2" onClick={() => { setDraft(null); setPending(null); }}><RotateCcw className="size-4" /> Corrigir</Button>
            <Button className="gap-2" disabled={saving || !canWrite || !draft.entityId || (isTransfer ? !draft.accountId || !draft.toAccountId || draft.accountId === draft.toAccountId : isCreditPurchase ? !draft.creditCardId : !draft.accountId)} onClick={confirm}><Check className="size-4" /> {saving ? "Salvando..." : "Sim, confirmar"}</Button>
          </div>
        </div>
      ) : null}

      {!speechSupported ? <p className="mt-3 text-[11px] text-muted-foreground">A voz não está disponível neste navegador. Texto e documentos continuam funcionando normalmente.</p> : null}
    </section>
  );
}
