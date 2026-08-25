import "./lib/error-capture";

import { createClient } from "@supabase/supabase-js";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { compactAiCategory, compactAiEntity, matchEntityRecord, acceptedEntityId, resolveCategoryMatch, blendSemanticConfidence } from "./lib/categories";
import { parseLooseDate } from "./lib/date";
import { parseBRLMoney, roundMoney } from "./lib/money";
import {
  ALLOWED_DOCUMENT_MIME,
  DOCUMENT_INTERPRETATION_VERSION,
  MAX_DOCUMENT_BYTES,
  documentAiJsonSchema,
  resolveDocumentSuggestion,
  type ResolvedDocumentSuggestion,
} from "./lib/document-interpretation";
import type { Database, Json } from "./integrations/supabase/types";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

type FinanceContext = {
  entities?: Array<{ id: string; name: string; slug?: string; description?: string | null; ai_keywords?: string[] | null }>;
  categories?: Array<{ id: string; name: string; kind: string; description?: string | null; ai_keywords?: string[] | null }>;
  accounts?: Array<{ id: string; name: string; entity_id: string }>;
  selected_entity_id?: string | null;
};

type FinanceInterpretBody = FinanceContext & {
  text?: string;
};

type DocumentInterpretBody = {
  document_id?: string;
  text?: string;
  force?: boolean;
  selected_entity_id?: string | null;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

function envValue(env: unknown, key: string): string | undefined {
  if (env && typeof env === "object") {
    const value = (env as Record<string, unknown>)[key];
    if (typeof value === "string" && value) return value;
  }
  const processValue = typeof process !== "undefined" ? process.env?.[key] : undefined;
  return processValue || undefined;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getSupabaseConfig(env: unknown) {
  const supabaseUrl =
    envValue(env, "SUPABASE_URL") ||
    envValue(env, "VITE_SUPABASE_URL") ||
    import.meta.env["VITE_SUPABASE_URL"];
  const publishableKey =
    envValue(env, "SUPABASE_PUBLISHABLE_KEY") ||
    envValue(env, "VITE_SUPABASE_PUBLISHABLE_KEY") ||
    import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  return { supabaseUrl, publishableKey };
}

async function verifySupabaseUser(request: Request, env: unknown) {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;

  const { supabaseUrl, publishableKey } = getSupabaseConfig(env);
  if (!supabaseUrl || !publishableKey) return false;

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: publishableKey,
      authorization: auth,
    },
  });
  return response.ok;
}

function userSupabase(request: Request, env: unknown) {
  const auth = request.headers.get("authorization") ?? "";
  const { supabaseUrl, publishableKey } = getSupabaseConfig(env);
  if (!supabaseUrl || !publishableKey || !auth.startsWith("Bearer ")) return null;
  return createClient<Database>(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}

function extractResponseText(payload: any): string | null {
  if (typeof payload?.output_text === "string" && payload.output_text) return payload.output_text;
  for (const item of payload?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (typeof content?.text === "string" && content.text) return content.text;
    }
  }
  return null;
}

function financeSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["income", "expense"] },
      amount: { type: "number" },
      entity_name: { type: ["string", "null"] },
      category_name: { type: ["string", "null"] },
      account_id: { type: ["string", "null"] },
      description: { type: "string" },
      document_date: { type: ["string", "null"] },
      vendor: { type: ["string", "null"] },
      confidence: { type: "number" },
    },
    required: [
      "kind",
      "amount",
      "entity_name",
      "category_name",
      "account_id",
      "description",
      "document_date",
      "vendor",
      "confidence",
    ],
  };
}

function normalizeInterpretation(raw: any): { ok: true; value: any } | { ok: false } {
  if (!raw || typeof raw !== "object") return { ok: false };
  const parsedAmount =
    typeof raw.amount === "string" ? parseBRLMoney(raw.amount) : Number(raw.amount);
  const amount = parsedAmount === null ? NaN : roundMoney(Number(parsedAmount));
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false };
  let confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.min(1, Math.max(0, confidence));
  const kind = raw.kind === "income" ? "income" : "expense";
  const description = typeof raw.description === "string" && raw.description.trim()
    ? raw.description.trim().slice(0, 120)
    : "Lançamento importado de documento";
  const documentDate = parseLooseDate(
    typeof raw.document_date === "string" ? raw.document_date : null,
  );
  return {
    ok: true,
    value: { ...raw, kind, amount, confidence, description, document_date: documentDate },
  };
}


function compactFinanceCatalog(body: FinanceContext) {
  return {
    entities: (body.entities ?? []).slice(0, 30).map((entity) => compactAiEntity(entity)),
    categories: (body.categories ?? [])
      .filter((category) => category.kind === "income" || category.kind === "expense")
      .slice(0, 80)
      .map((category) => compactAiCategory({
        id: category.id,
        name: category.name,
        kind: category.kind as "income" | "expense",
        description: category.description ?? null,
        ai_keywords: category.ai_keywords ?? null,
      })),
    accounts: (body.accounts ?? []).slice(0, 80).map((account) => ({
      id: account.id,
      name: account.name,
      entity_id: account.entity_id,
    })),
  };
}

function sanitizeInterpretation(raw: any, context: FinanceContext, originalText: string) {
  const normalized = normalizeInterpretation(raw);
  if (!normalized.ok) return normalized;
  const kind = normalized.value.kind as "income" | "expense";
  const allowed = (context.categories ?? [])
    .filter((category) => category.kind === "income" || category.kind === "expense")
    .map((category) => ({
      id: category.id,
      name: category.name,
      kind: category.kind as "income" | "expense",
      active: true,
      description: category.description ?? null,
      ai_keywords: category.ai_keywords ?? null,
    }));
  const categoryHint = [
    typeof normalized.value.category_name === "string" ? normalized.value.category_name : "",
    normalized.value.description ?? "",
    normalized.value.vendor ?? "",
    originalText,
  ].join(" ");
  const categoryMatch = resolveCategoryMatch(allowed, kind, categoryHint);
  const categoryId = categoryMatch.ambiguous ? null : categoryMatch.id;
  const entityMatch = matchEntityRecord(
    (context.entities ?? []).map((entity) => ({
      id: entity.id,
      name: entity.name,
      slug: entity.slug ?? null,
      active: true,
      description: entity.description ?? null,
      ai_keywords: entity.ai_keywords ?? null,
    })),
    originalText,
    context.selected_entity_id ?? null,
  );
  const accountIds = new Set((context.accounts ?? []).map((account) => account.id));
  const entityId = acceptedEntityId(entityMatch);
  return {
    ok: true as const,
    value: {
      ...normalized.value,
      category_id: categoryId,
      entity_id: entityId,
      account_id: accountIds.has(normalized.value.account_id) ? normalized.value.account_id : null,
      confidence: blendSemanticConfidence(normalized.value.confidence, categoryMatch),
      ambiguous_category: categoryMatch.ambiguous,
      ambiguous_entity: entityMatch.ambiguous,
    },
  };
}

async function handleAiStatus(request: Request, env: unknown): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (!(await verifySupabaseUser(request, env))) return json({ error: "unauthorized" }, 401);

  const configured = Boolean(envValue(env, "OPENAI_API_KEY"));
  const model = envValue(env, "OPENAI_MODEL") || "gpt-5.6-luna";
  return json({ configured, model });
}

async function handleFinanceInterpret(request: Request, env: unknown): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!(await verifySupabaseUser(request, env))) return json({ error: "unauthorized" }, 401);

  let body: FinanceInterpretBody;
  try {
    body = (await request.json()) as FinanceInterpretBody;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const text = body.text?.trim();
  if (!text || text.length > 500) return json({ error: "invalid_text" }, 400);

  const apiKey = envValue(env, "OPENAI_API_KEY");
  if (!apiKey) return json({ error: "ai_not_configured" }, 503);

  const model = envValue(env, "OPENAI_MODEL") || "gpt-5.6-luna";
  const catalog = compactFinanceCatalog(body);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "Voce interpreta lancamentos financeiros pessoais e empresariais em portugues do Brasil. Nunca invente IDs nem UUIDs. Os IDs no catalogo sao apenas referencia tecnica. Devolva category_name e entity_name exatamente como no catalogo, ou null se houver duvida. Nao escolha entity_name se o texto nao indicar qual entidade esta envolvida. A ausencia de entidade e valida. Retorne entity_name=null em vez de adivinhar. selected_entity_id e apenas contexto preferencial e nunca deve substituir evidencia textual clara. Use description e keywords do catalogo para desambiguar categorias. Escolha income para dinheiro que entrou e expense para dinheiro que saiu. Extraia o valor monetario principal. Descricao deve ser curta e util. document_date use YYYY-MM-DD quando houver data explicita, senao null. Confidence vai de 0 a 1. Se duas categorias ou entidades forem plausiveis, retorne null nesse nome.",
        },
        { role: "user", content: `Comando: ${text}\n\nOpcoes disponiveis:\n${JSON.stringify(catalog)}` },
      ],
      text: { format: { type: "json_schema", name: "finance_interpretation", strict: true, schema: financeSchema() } },
      max_output_tokens: 260,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error(`[OpenAI finance interpret] ${response.status}: ${detail.slice(0, 500)}`);
    return json({ error: "ai_unavailable" }, 502);
  }

  const payload = await response.json();
  const output = extractResponseText(payload);
  if (!output) return json({ error: "ai_empty_response" }, 502);

  try {
    const parsed = JSON.parse(output);
    const sanitized = sanitizeInterpretation(parsed, body, text);
    if (!sanitized.ok) return json({ error: "ai_invalid_response" }, 502);
    return json({ source: "openai", interpretation: sanitized.value });
  } catch {
    return json({ error: "ai_invalid_response" }, 502);
  }
}

async function handleDocumentInterpret(request: Request, env: unknown): Promise<Response> {
  if (request.method !== "POST") return json({ error_code: "method_not_allowed", message: "Método não permitido." }, 405);
  if (!(await verifySupabaseUser(request, env))) {
    return json({ error_code: "unauthorized", message: "Sessão expirada. Entre novamente." }, 401);
  }

  const supabase = userSupabase(request, env);
  if (!supabase) return json({ error_code: "backend_not_configured", message: "Backend não configurado." }, 503);

  let body: DocumentInterpretBody;
  try {
    body = (await request.json()) as DocumentInterpretBody;
  } catch {
    return json({ error_code: "invalid_json", message: "Requisição inválida." }, 400);
  }

  const documentId = typeof body.document_id === "string" ? body.document_id : "";
  if (!documentId) {
    return json({ error_code: "document_required", message: "Informe o documento a interpretar." }, 400);
  }

  const claimed = await supabase.rpc("claim_financial_document_processing", {
    p_id: documentId,
    p_force: Boolean(body.force),
  });
  if (claimed.error) {
    const message = claimed.error.message ?? "";
    if (/somente leitura|sem permissao/i.test(message)) {
      return json({ error_code: "forbidden", message: "Seu acesso é somente leitura." }, 403);
    }
    if (/invalido|nao encontrado|vinculado|arquivado/i.test(message)) {
      return json({ error_code: "document_invalid", message: "Documento inválido para este espaço." }, 404);
    }
    return json({ error_code: "claim_failed", message: "Não consegui iniciar a leitura do documento." }, 400);
  }

  const claim = claimed.data?.[0];
  if (!claim) return json({ error_code: "document_invalid", message: "Documento inválido para este espaço." }, 404);

  if (!claim.claimed && claim.already_interpreted && claim.interpretation_json) {
    return json({
      source: "cached",
      interpretation_version: DOCUMENT_INTERPRETATION_VERSION,
      interpretation: claim.interpretation_json,
    });
  }

  if (!claim.claimed) {
    return json({
      error_code: "processing_in_progress",
      message: "Este documento já está sendo lido. Aguarde ou tente de novo em instantes.",
    }, 409);
  }

  const mime = (claim.mime_type || "application/octet-stream").toLowerCase();
  if (!(ALLOWED_DOCUMENT_MIME as readonly string[]).includes(mime)) {
    await supabase.rpc("fail_financial_document_interpretation", {
      p_id: documentId,
      p_error: "tipo de arquivo nao permitido",
    });
    return json({ error_code: "mime_not_allowed", message: "Este tipo de arquivo não pode ser lido." }, 415);
  }
  if (claim.size_bytes != null && Number(claim.size_bytes) > MAX_DOCUMENT_BYTES) {
    await supabase.rpc("fail_financial_document_interpretation", {
      p_id: documentId,
      p_error: "arquivo maior que 20 MB",
    });
    return json({ error_code: "file_too_large", message: "Arquivo maior que 20 MB." }, 413);
  }

  const signed = await supabase.storage.from("financial-documents").createSignedUrl(claim.storage_path, 120);
  if (signed.error || !signed.data?.signedUrl) {
    await supabase.rpc("fail_financial_document_interpretation", {
      p_id: documentId,
      p_error: "nao foi possivel assinar o arquivo",
    });
    return json({ error_code: "signed_url_failed", message: "Não consegui preparar o arquivo para leitura." }, 502);
  }

  const [entities, categories, accounts] = await Promise.all([
    supabase.from("financial_entities").select("id, name, slug, active, description, ai_keywords").eq("is_demo", false),
    supabase.from("categories").select("id, name, kind, active, description, ai_keywords").eq("is_demo", false),
    supabase.from("accounts").select("id, entity_id, active").eq("is_demo", false),
  ]);

  const apiKey = envValue(env, "OPENAI_API_KEY");
  if (!apiKey) {
    await supabase.rpc("fail_financial_document_interpretation", {
      p_id: documentId,
      p_error: "ia nao configurada",
    });
    return json({ error_code: "ai_not_configured", message: "IA não configurada neste ambiente." }, 503);
  }
  const model = envValue(env, "OPENAI_MODEL") || "gpt-5.6-luna";
  const nameContext = {
    entities: (entities.data ?? []).slice(0, 30).map((row) => compactAiEntity({
      id: row.id,
      name: row.name,
      slug: row.slug ?? null,
      description: row.description ?? null,
      ai_keywords: row.ai_keywords ?? null,
    })).map(({ name, slug, description, keywords }) => ({ name, slug, description, keywords })),
    categories: (categories.data ?? [])
      .filter((row) => row.kind === "income" || row.kind === "expense")
      .slice(0, 80)
      .map((row) => compactAiCategory({
        id: row.id,
        name: row.name,
        kind: row.kind as "income" | "expense",
        description: row.description ?? null,
        ai_keywords: row.ai_keywords ?? null,
      }))
      .map(({ name, kind, description, keywords }) => ({ name, kind, description, keywords })),
  };

  const fail = async (code: string, message: string, status = 502, errorText = message) => {
    await supabase.rpc("fail_financial_document_interpretation", {
      p_id: documentId,
      p_error: errorText.slice(0, 300),
    });
    return json({ error_code: code, message }, status);
  };

  try {
    const isImage = mime.startsWith("image/");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content:
              "Voce extrai lancamentos financeiros de documentos em portugues do Brasil. Nunca invente valores. Nunca retorne UUIDs ou IDs internos. Use nomes do catalogo. kind=income para receber e expense para pagar/gasto. Datas em YYYY-MM-DD. payment_method em pix,cash,debit,credit,boleto,transfer,other. possible_recurring so se parecer mensalidade/assinatura. Use description e keywords do catalogo para escolher category_name e entity_name. Nao escolha entity_name se o documento nao indicar qual entidade do catalogo esta envolvida. A ausencia de entidade e valida. Retorne entity_name=null em vez de adivinhar. A entidade selecionada no app e apenas contexto preferencial e nunca deve substituir evidencia do documento. Se houver ambiguidade, retorne null no nome. Confidence 0 a 1.",
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  `Leia o comprovante. Contexto opcional: ${body.text?.trim()?.slice(0, 400) || "(sem texto)"}. ` +
                  `Catalogo do espaco (nomes, nao IDs): ${JSON.stringify(nameContext)}`,
              },
              isImage
                ? { type: "input_image", image_url: signed.data.signedUrl, detail: "high" }
                : { type: "input_file", file_url: signed.data.signedUrl },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "financial_document_interpretation",
            strict: true,
            schema: documentAiJsonSchema(),
          },
        },
        max_output_tokens: 360,
      }),
    });
    clearTimeout(timer);

    if (!response.ok) {
      const detail = await response.text();
      console.error(`[OpenAI document interpret] ${response.status}: ${detail.slice(0, 800)}`);
      return await fail("ai_unavailable", "A leitura do documento falhou. Tente novamente.", 502, `openai_http_${response.status}`);
    }

    const payload = await response.json();
    const output = extractResponseText(payload);
    if (!output) return await fail("ai_empty_response", "A IA não retornou conteúdo para o documento.");

    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      return await fail("ai_invalid_response", "A IA retornou um formato inesperado.");
    }

    let resolved: ResolvedDocumentSuggestion;
    try {
      resolved = resolveDocumentSuggestion(parsed, {
        entities: (entities.data ?? []).map((row) => ({
          id: row.id,
          name: row.name,
          slug: row.slug,
          active: row.active !== false,
          description: row.description ?? null,
          ai_keywords: row.ai_keywords ?? null,
        })),
        categories: (categories.data ?? [])
          .filter((row) => row.kind === "income" || row.kind === "expense")
          .map((row) => ({
            id: row.id,
            name: row.name,
            kind: row.kind as "income" | "expense",
            active: row.active !== false,
            description: row.description ?? null,
            ai_keywords: row.ai_keywords ?? null,
          })),
        accounts: (accounts.data ?? []).map((row) => ({
          id: row.id,
          entity_id: row.entity_id,
          active: row.active !== false,
        })),
        preferredEntityId: typeof body.selected_entity_id === "string" ? body.selected_entity_id : null,
      });
    } catch {
      return await fail("ai_invalid_amount", "Não identifiquei um valor ou data válida no documento.", 422);
    }

    const saved = await supabase.rpc("save_financial_document_interpretation", {
      p_id: documentId,
      p_json: resolved as unknown as Json,
      p_model: model,
      p_possible_recurring: resolved.possible_recurring,
    });
    if (saved.error) {
      return await fail("save_failed", "Li o documento, mas não consegui gravar a sugestão.");
    }

    return json({
      source: "openai_document",
      interpretation_version: DOCUMENT_INTERPRETATION_VERSION,
      interpretation: resolved,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    console.error("[Document interpret]", error);
    return await fail(
      aborted ? "ai_timeout" : "document_processing_failed",
      aborted ? "A leitura demorou demais. O documento continua recuperável." : "Não consegui processar o documento agora.",
    );
  }
}


async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/finance/ai-status") return await handleAiStatus(request, env);
      if (url.pathname === "/api/finance/interpret") return await handleFinanceInterpret(request, env);
      if (url.pathname === "/api/finance/document-interpret") return await handleDocumentInterpret(request, env);

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
