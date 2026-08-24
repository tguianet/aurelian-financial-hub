import { useMemo, useRef, useState } from "react";
import { Check, Mic, MicOff, RotateCcw, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useRefreshFinance } from "@/hooks/useFinance";
import { useEntityScope } from "./EntityContext";
import type { UploadedDocument } from "./QuickDocumentUpload";
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
  const raw = rawValue.replace(/[^\d.,]/g, "");
  if (!raw) return null;
  let clean: string;
  if (raw.includes(",")) clean = raw.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) clean = raw.replace(/\./g, "");
  else clean = raw;
  const value = Number(clean);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseInstallment(text: string) {
  const match = text.match(/\b(\d{1,2})\s*x\s*(?:de\s*)?(?:r\$\s*)?(\d[\d.,]*)/i);
  if (!match) return null;
  const count = Number(match[1]);
  const installmentAmount = parseBrazilianNumber(match[2]);
  if (!Number.isInteger(count) || count < 2 || count > 60 || !installmentAmount) return null;
  return { count, installmentAmount, totalAmount: Math.round(count * installmentAmount * 100) / 100, matchedText: match[0] };
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

function monthlyIsoDate(baseIso: string, monthOffset: number) {
  const [year, month, day] = baseIso.split("-").map(Number);
  const monthIndex = month - 1 + monthOffset;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonthIndex = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  return new Date(Date.UTC(targetYear, targetMonthIndex, targetDay)).toISOString().slice(0, 10);
}

export function MobileQuickEntry({ documents = [] }: Props) {
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

  const resolveAiDraft = (ai: {
    kind?: "income" | "expense";
    amount?: number;
    entity_id?: string | null;
    category_id?: string | null;
    account_id?: string | null;
    description?: string;
    document_date?: string | null;
    vendor?: string | null;
    confidence?: number;
  }, originalText: string): Draft | null => {
    if (!ai?.kind || !ai.amount || ai.amount <= 0 || (ai.confidence ?? 0) < 0.5) return null;
    const entity = data.entities.find((e) => e.id === ai.entity_id) ??
      (selectedEntityId !== "all" ? data.entities.find((e) => e.id === selectedEntityId) : undefined) ??
      data.entities.find((e) => e.slug === "pessoal") ?? data.entities[0];
    if (!entity) return null;
    const category = data.categories.find((c) => c.id === ai.category_id && c.kind === ai.kind) ?? null;
    const account = data.accounts.find((a) => a.id === ai.account_id && a.entity_id === entity.id && a.active) ??
      data.accounts.find((a) => a.entity_id === entity.id && a.active) ?? data.accounts.find((a) => a.entity_id === entity.id);
    if (!account) return null;
    return {
      kind: ai.kind,
      amount: Number(ai.amount),
      entityId: entity.id,
      categoryId: category?.id ?? null,
      accountId: account.id,
      description: ai.description?.trim() || ai.vendor?.trim() || originalText || "Documento financeiro",
      originalText,
      parser: "openai",
      documentDate: ai.document_date ?? null,
      vendor: ai.vendor ?? null,
      pending: inferPending(originalText, ai.kind),
    };
  };

  const localInterpret = (originalText: string) => {
    const installment = parseInstallment(originalText);
    const amount = installment?.installmentAmount ?? parseAmount(originalText);
    if (!amount) return null;
    const n = normalize(originalText);
    const kind = inferKind(originalText);
    const explicitEntity = data.entities.find((e) => n.includes(normalize(e.name)));
    const entity = explicitEntity ??
      (selectedEntityId !== "all" ? data.entities.find((e) => e.id === selectedEntityId) : undefined) ??
      data.entities.find((e) => e.slug === "pessoal") ?? data.entities[0];
    if (!entity) return null;
    const account = data.accounts.find((a) => a.entity_id === entity.id && a.active) ?? data.accounts.find((a) => a.entity_id === entity.id);
    if (!account) return null;

    const categoryText = removeEntityMention(originalText, explicitEntity?.name);
    const categories = data.categories.filter((c) => c.kind === kind);
    const category = categories.find((c) => categoryText.includes(normalize(c.name))) ?? categories.find((c) => {
      const cn = normalize(c.name);
      if (cn.includes("veiculo") && /(moto|motocicleta|carro|veiculo|van|saveiro|caminhao)/.test(categoryText)) return true;
      if (cn.includes("manutencao") && /(manutencao|conserto|reparo|oficina)/.test(categoryText)) return true;
      if (cn.includes("combustivel") && /(gasolina|etanol|alcool|posto|combustivel)/.test(categoryText)) return true;
      if (cn.includes("alimentacao") && /(comida|almoco|janta|mercado)/.test(categoryText)) return true;
      if (cn.includes("energia") && /(conta de luz|energia eletrica|luz)/.test(categoryText)) return true;
      if (cn.includes("comiss") && /(comissao|comparta|energia por assinatura)/.test(categoryText)) return true;
      if (cn.includes("venda") && /(vendi|venda|faturei)/.test(categoryText)) return true;
      return false;
    }) ?? null;

    let stripped = originalText;
    if (installment) stripped = stripped.replace(installment.matchedText, "");
    stripped = stripped.replace(/\b(parcelei|financiei|comprei|gastei|paguei|recebi|entrou|vendi|ganhei|faturei|reais|real|r\$|em|de)\b/gi, " ")
      .replace(/\d[\d.,]*/g, " ").replace(/\s+/g, " ").trim();

    const result: Draft = {
      kind, amount, entityId: entity.id, categoryId: category?.id ?? null, accountId: account.id,
      description: stripped || (kind === "income" ? "Entrada rápida" : "Saída rápida"),
      originalText, parser: "local", installmentCount: installment?.count, totalAmount: installment?.totalAmount,
      pending: inferPending(originalText, kind),
    };
    const confident = Boolean(category) && (Boolean(installment) || Boolean(explicitEntity) || selectedEntityId !== "all");
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
    const payload = await response.json() as { interpretation?: Parameters<typeof resolveAiDraft>[0] };
    return payload.interpretation ? resolveAiDraft(payload.interpretation, originalText) : null;
  };

  const documentInterpret = async (originalText: string): Promise<Draft | null> => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token || !documents.length) return null;

    const signedDocuments = [];
    for (const document of documents.slice(0, 3)) {
      const { data: signed, error } = await supabase.storage.from("financial-documents").createSignedUrl(document.path, 300);
      if (error || !signed?.signedUrl) throw new Error(`Não consegui preparar ${document.name} para leitura.`);
      signedDocuments.push({ name: document.name, mime_type: document.mimeType, signed_url: signed.signedUrl });
    }

    const response = await fetch("/api/finance/document-interpret", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        text: originalText,
        documents: signedDocuments,
        entities: data.entities.map(({ id, name, slug }) => ({ id, name, slug })),
        categories: data.categories.map(({ id, name, kind }) => ({ id, name, kind })),
        accounts: data.accounts.filter((a) => a.active).map(({ id, name, entity_id }) => ({ id, name, entity_id })),
      }),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(detail.error || "Falha ao ler documento.");
    }
    const payload = await response.json() as { interpretation?: Parameters<typeof resolveAiDraft>[0] };
    return payload.interpretation ? resolveAiDraft(payload.interpretation, originalText) : null;
  };

  const interpret = async (value = text) => {
    const originalText = value.trim();
    if (!originalText && !documents.length) { toast.error("Digite, fale ou anexe um documento."); return; }
    if (!documents.length && !parseAmount(originalText)) { toast.error("Não encontrei o valor. Ex.: gastei 180 combustível."); return; }

    setInterpreting(true);
    if (documents.length) {
      try {
        const docDraft = await documentInterpret(originalText);
        setInterpreting(false);
        if (docDraft) {
          setDraft(docDraft);
          toast.success("Documento lido. Confira os dados antes de confirmar.");
          return;
        }
        toast.error("Li o documento, mas não consegui identificar um lançamento com segurança.");
        return;
      } catch (error) {
        setInterpreting(false);
        toast.error(error instanceof Error ? error.message : "Não consegui ler o documento.");
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
    setSaving(true);
    const today = new Date().toISOString().slice(0, 10);
    const txDate = draft.documentDate && /^\d{4}-\d{2}-\d{2}$/.test(draft.documentDate) ? draft.documentDate : today;
    const source = draft.parser === "openai" ? (documents.length ? "document_openai" : "mobile_openai") : "mobile_quick_entry";

    if (draft.installmentCount && draft.installmentCount > 1) {
      const rows = Array.from({ length: draft.installmentCount }, (_, index) => ({
        user_id: user.id, entity_id: draft.entityId, kind: draft.kind, description: draft.description, amount: draft.amount,
        category_id: draft.categoryId, account_id: draft.accountId, payment_method: "other",
        competence_date: monthlyIsoDate(txDate, index), due_date: monthlyIsoDate(txDate, index), paid_at: null,
        status: "pending", recurrence: "none", installment_no: index + 1, installment_total: draft.installmentCount,
        source, notes: `Comando original: ${draft.originalText || "Documento anexado"}`,
      }));
      const { error } = await supabase.from("transactions").insert(rows);
      setSaving(false);
      if (error) { toast.error(error.message); return; }
      toast.success(`${draft.installmentCount} parcelas criadas no contas a pagar.`);
    } else {
      const isPending = Boolean(draft.pending);
      const { error } = await supabase.from("transactions").insert({
        user_id: user.id, entity_id: draft.entityId, kind: draft.kind, description: draft.description, amount: draft.amount,
        category_id: draft.categoryId, account_id: draft.accountId, payment_method: "other",
        competence_date: txDate, due_date: txDate, paid_at: isPending ? null : txDate,
        status: isPending ? "pending" : draft.kind === "income" ? "received" : "paid",
        recurrence: "none", source,
        notes: `Comando original: ${draft.originalText || "Documento anexado"}${draft.vendor ? ` | Documento: ${draft.vendor}` : ""}`,
      });
      setSaving(false);
      if (error) { toast.error(error.message); return; }
      toast.success(isPending ? (draft.kind === "income" ? "Conta a receber criada." : "Conta a pagar criada.") : "Lançamento confirmado.");
    }

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
        <h2 className="mt-1 text-lg font-semibold">Digite, fale ou anexe um documento</h2>
        <p className="mt-1 text-xs text-muted-foreground">Com anexo, a IA lê a nota/PDF e extrai os dados financeiros.</p>
      </div>

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
            <div><span className="block text-[11px] text-muted-foreground">Entidade</span><strong>{entity?.name ?? "—"}</strong></div>
            <div><span className="block text-[11px] text-muted-foreground">Categoria</span><strong>{category?.name ?? "Sem categoria"}</strong></div>
            <div><span className="block text-[11px] text-muted-foreground">Status</span><strong>{draft.pending ? (draft.kind === "income" ? "A receber" : "A pagar") : "Liquidado"}</strong></div>
            <div><span className="block text-[11px] text-muted-foreground">Data</span><strong>{draft.documentDate ?? "Hoje"}</strong></div>
            {draft.vendor ? <div className="col-span-2"><span className="block text-[11px] text-muted-foreground">Documento / fornecedor</span><strong>{draft.vendor}</strong></div> : null}
            {draft.installmentCount ? <><div><span className="block text-[11px] text-muted-foreground">Parcelas</span><strong>{draft.installmentCount}x</strong></div><div><span className="block text-[11px] text-muted-foreground">Total contratado</span><strong>{brl(draft.totalAmount ?? draft.amount * draft.installmentCount)}</strong></div></> : null}
            <div className="col-span-2"><span className="block text-[11px] text-muted-foreground">Conta</span><strong>{account?.name ?? "—"}</strong></div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button variant="ghost" className="gap-2" onClick={() => setDraft(null)}><RotateCcw className="size-4" /> Corrigir</Button>
            <Button className="gap-2" disabled={saving} onClick={confirm}><Check className="size-4" /> {saving ? "Salvando..." : "Confirmar"}</Button>
          </div>
        </div>
      ) : null}

      {!speechSupported ? <p className="mt-3 text-[11px] text-muted-foreground">Seu navegador não expõe reconhecimento de voz. Texto e documentos continuam funcionando normalmente.</p> : null}
    </section>
  );
}
