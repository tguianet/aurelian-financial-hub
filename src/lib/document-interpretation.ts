import { z } from "zod";
import { isValidDateIso, parseLooseDate } from "./date";
import { parseBRLMoney, roundMoney } from "./money";
import { blendSemanticConfidence, matchEntityRecord, resolveCategoryMatch } from "./categories";

export const DOCUMENT_INTERPRETATION_VERSION = 1;

export const ALLOWED_DOCUMENT_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
] as const;

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export const PAYMENT_METHODS = ["pix", "cash", "debit", "credit", "boleto", "transfer", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const DOCUMENT_STATUSES = [
  "uploaded",
  "processing",
  "interpreted",
  "confirmed",
  "linked",
  "failed",
  "archived",
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_STATUS_LABEL: Record<string, string> = {
  uploaded: "Enviado",
  processing: "Processando",
  interpreted: "Aguardando confirmação",
  confirmed: "Confirmado",
  linked: "Lançado",
  failed: "Falhou",
  archived: "Arquivado",
};

export const PROCESSING_LOCK_MS = 10 * 60 * 1000;

export function documentConfirmIdempotencyKey(documentId: string, version: number) {
  return `financial-document:${documentId}:confirm:v${Math.max(version, 1)}`;
}

export function isProcessingStale(startedAt: string | Date | null | undefined, now = Date.now()) {
  if (!startedAt) return true;
  const ts = startedAt instanceof Date ? startedAt.getTime() : Date.parse(startedAt);
  if (!Number.isFinite(ts)) return true;
  return now - ts > PROCESSING_LOCK_MS;
}

export type ClaimDecision = "claim" | "use_cached" | "in_progress" | "blocked";

export function claimDocumentProcessingDecision(input: {
  status: string;
  interpretationJson?: unknown;
  processingStartedAt?: string | null;
  processingBy?: string | null;
  currentUserId: string;
  force?: boolean;
  now?: number;
}): ClaimDecision {
  if (["linked", "confirmed", "archived"].includes(input.status)) return "blocked";
  const stale = isProcessingStale(input.processingStartedAt ?? null, input.now);
  if (input.status === "interpreted" && input.interpretationJson && !input.force) return "use_cached";
  if (input.status === "processing" && !stale) return "in_progress";
  if (["uploaded", "failed", "interpreted", "processing"].includes(input.status)) return "claim";
  return "blocked";
}

export function confirmDocumentDecision(
  status: string,
  transactionId: string | null | undefined,
  purchaseId: string | null | undefined,
) {
  if ((status === "linked" || status === "confirmed") && (transactionId || purchaseId)) {
    return "return_existing" as const;
  }
  if (status === "interpreted") return "create" as const;
  return "reject" as const;
}

export function documentUsesCreditCard(kind: string, paymentMethod: string) {
  return kind === "expense" && paymentMethod === "credit";
}

export function isDuplicateInSameSpace(
  existing: { spaceId: string; hash: string },
  incoming: { spaceId: string; hash: string },
) {
  return existing.spaceId === incoming.spaceId && existing.hash === incoming.hash && Boolean(existing.hash);
}

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function looksLikeUuid(value: string | null | undefined): boolean {
  return Boolean(value && uuidRe.test(value.trim()));
}

function boundedString(max: number) {
  return z.string().trim().max(max);
}

export const aiDocumentSuggestionSchema = z.object({
  kind: z.enum(["income", "expense"]),
  description: boundedString(180).optional().nullable(),
  amount: z.union([z.number(), z.string()]),
  competence_date: boundedString(32).optional().nullable(),
  due_date: boundedString(32).optional().nullable(),
  payment_method: boundedString(32).optional().nullable(),
  category_name: boundedString(80).optional().nullable(),
  entity_name: boundedString(80).optional().nullable(),
  confidence: z.number().optional().nullable(),
  notes: boundedString(240).optional().nullable(),
  possible_recurring: z.boolean().optional().nullable(),
});

export type AiDocumentSuggestion = z.infer<typeof aiDocumentSuggestionSchema>;

export type ResolvedDocumentSuggestion = {
  kind: "income" | "expense";
  description: string;
  amount: number;
  competence_date: string | null;
  due_date: string | null;
  payment_method: PaymentMethod;
  category_name: string | null;
  entity_name: string | null;
  confidence: number;
  notes: string | null;
  possible_recurring: boolean;
  category_id: string | null;
  entity_id: string | null;
  account_id: string | null;
  ambiguous_entity: boolean;
  ambiguous_category: boolean;
};

function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number") {
    const value = roundMoney(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof raw === "string") {
    const parsed = parseBRLMoney(raw);
    return parsed !== null && parsed > 0 ? parsed : null;
  }
  return null;
}

function parsePaymentMethod(raw: string | null | undefined): PaymentMethod {
  const value = (raw ?? "").trim().toLowerCase();
  if ((PAYMENT_METHODS as readonly string[]).includes(value)) return value as PaymentMethod;
  if (["credito", "cartao", "cartão"].includes(value)) return "credit";
  if (["dinheiro"].includes(value)) return "cash";
  if (["debito", "débito"].includes(value)) return "debit";
  return "other";
}

export function stripInventedIds(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed || looksLikeUuid(trimmed)) return null;
  return trimmed.slice(0, 80);
}

export function matchEntityByName<T extends { id: string; name: string; active?: boolean; slug?: string | null; description?: string | null; ai_keywords?: string[] | null }>(
  entities: T[],
  suggestedName: string | null,
  preferredId?: string | null,
  extraHint?: string | null,
): { id: string | null; ambiguous: boolean } {
  const match = matchEntityRecord(
    entities.map((entity) => ({
      id: entity.id,
      name: entity.name,
      slug: entity.slug ?? null,
      active: entity.active !== false,
      description: entity.description ?? null,
      ai_keywords: entity.ai_keywords ?? null,
    })),
    [suggestedName, extraHint].filter(Boolean).join(" "),
    preferredId,
  );
  return { id: match.id, ambiguous: match.ambiguous };
}

export function pickAccountForEntity<T extends { id: string; entity_id: string; active?: boolean }>(
  accounts: T[],
  entityId: string | null,
): string | null {
  if (!entityId) return null;
  const pool = accounts.filter((account) => account.entity_id === entityId);
  return (pool.find((account) => account.active !== false) ?? pool[0])?.id ?? null;
}

export function parseAiDocumentSuggestion(raw: unknown): AiDocumentSuggestion {
  return aiDocumentSuggestionSchema.parse(raw);
}

export function resolveDocumentSuggestion(
  raw: unknown,
  context: {
    entities: Array<{ id: string; name: string; active?: boolean; slug?: string | null; description?: string | null; ai_keywords?: string[] | null }>;
    categories: Array<{ id: string; name: string; kind: "income" | "expense"; active?: boolean; description?: string | null; ai_keywords?: string[] | null }>;
    accounts: Array<{ id: string; entity_id: string; active?: boolean }>;
    preferredEntityId?: string | null;
  },
): ResolvedDocumentSuggestion {
  const parsed = parseAiDocumentSuggestion(raw);
  const amount = parseAmount(parsed.amount);
  if (amount === null) throw new Error("amount_invalid");

  const kind = parsed.kind;
  const categoryName = stripInventedIds(parsed.category_name);
  const entityName = stripInventedIds(parsed.entity_name);
  const categoryHint = `${categoryName ?? ""} ${parsed.description ?? ""}`;
  const categoryMatch = resolveCategoryMatch(
    context.categories.map((category) => ({
      id: category.id,
      name: category.name,
      kind: category.kind,
      active: category.active !== false,
      description: category.description ?? null,
      ai_keywords: category.ai_keywords ?? null,
    })),
    kind,
    categoryHint,
  );
  const categoryId = categoryMatch.ambiguous ? null : categoryMatch.id;

  const entityMatch = matchEntityByName(
    context.entities,
    entityName,
    context.preferredEntityId ?? null,
    parsed.description,
  );
  const competence = parseLooseDate(parsed.competence_date ?? null);
  const due = parseLooseDate(parsed.due_date ?? null) ?? competence;
  if (competence && !isValidDateIso(competence)) throw new Error("date_invalid");
  if (due && !isValidDateIso(due)) throw new Error("date_invalid");

  let confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = blendSemanticConfidence(Math.min(1, Math.max(0, confidence)), categoryMatch);

  const description = (parsed.description?.trim() || entityName || "Lançamento importado de documento").slice(0, 180);

  return {
    kind,
    description,
    amount,
    competence_date: competence,
    due_date: due,
    payment_method: parsePaymentMethod(parsed.payment_method),
    category_name: categoryName,
    entity_name: entityName,
    confidence,
    notes: parsed.notes?.trim() ? parsed.notes.trim().slice(0, 240) : null,
    possible_recurring: Boolean(parsed.possible_recurring),
    category_id: categoryId,
    entity_id: entityMatch.id,
    account_id: pickAccountForEntity(context.accounts, entityMatch.id),
    ambiguous_entity: entityMatch.ambiguous,
    ambiguous_category: categoryMatch.ambiguous,
  };
}

export const resolvedDocumentSuggestionSchema = z.object({
  kind: z.enum(["income", "expense"]),
  description: z.string(),
  amount: z.number().positive(),
  competence_date: z.string().nullable(),
  due_date: z.string().nullable(),
  payment_method: z.enum(PAYMENT_METHODS),
  category_name: z.string().nullable(),
  entity_name: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  notes: z.string().nullable(),
  possible_recurring: z.boolean(),
  category_id: z.string().nullable(),
  entity_id: z.string().nullable(),
  account_id: z.string().nullable(),
  ambiguous_entity: z.boolean(),
  ambiguous_category: z.boolean().optional().default(false),
});

export function parseResolvedDocumentSuggestion(raw: unknown): ResolvedDocumentSuggestion | null {
  const parsed = resolvedDocumentSuggestionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function requestDocumentInterpretation(input: {
  documentId: string;
  token: string;
  text?: string;
  force?: boolean;
  selectedEntityId?: string | null;
}): Promise<{ source: string; interpretation: ResolvedDocumentSuggestion }> {
  const response = await fetch("/api/finance/document-interpret", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.token}`,
    },
    body: JSON.stringify({
      document_id: input.documentId,
      text: input.text || undefined,
      force: Boolean(input.force),
      selected_entity_id: input.selectedEntityId ?? null,
    }),
  });
  const payload = await response.json().catch(() => ({})) as {
    interpretation?: unknown;
    source?: string;
    error_code?: string;
    message?: string;
  };
  if (!response.ok) {
    const error = Object.assign(new Error(payload.message || "Falha ao ler o documento."), {
      code: payload.error_code ?? "",
    });
    throw error;
  }
  const interpretation = parseResolvedDocumentSuggestion(payload.interpretation);
  if (!interpretation) throw new Error("A IA retornou uma sugestão inválida.");
  return { source: payload.source ?? "openai_document", interpretation };
}

export function documentAiJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["income", "expense"] },
      description: { type: "string" },
      amount: { type: "number" },
      competence_date: { type: ["string", "null"] },
      due_date: { type: ["string", "null"] },
      payment_method: { type: ["string", "null"] },
      category_name: { type: ["string", "null"] },
      entity_name: { type: ["string", "null"] },
      confidence: { type: "number" },
      notes: { type: ["string", "null"] },
      possible_recurring: { type: "boolean" },
    },
    required: [
      "kind",
      "description",
      "amount",
      "competence_date",
      "due_date",
      "payment_method",
      "category_name",
      "entity_name",
      "confidence",
      "notes",
      "possible_recurring",
    ],
  };
}
