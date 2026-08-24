import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

type FinanceContext = {
  entities?: Array<{ id: string; name: string; slug?: string }>;
  categories?: Array<{ id: string; name: string; kind: string }>;
  accounts?: Array<{ id: string; name: string; entity_id: string }>;
};

type FinanceInterpretBody = FinanceContext & {
  text?: string;
};

type DocumentInterpretBody = FinanceContext & {
  text?: string;
  documents?: Array<{
    name: string;
    mime_type?: string;
    signed_url: string;
  }>;
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
      entity_id: { type: ["string", "null"] },
      category_id: { type: ["string", "null"] },
      account_id: { type: ["string", "null"] },
      description: { type: "string" },
      document_date: { type: ["string", "null"] },
      vendor: { type: ["string", "null"] },
      confidence: { type: "number" },
    },
    required: [
      "kind",
      "amount",
      "entity_id",
      "category_id",
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
  const amount = Number(raw.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false };
  let confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.min(1, Math.max(0, confidence));
  const kind = raw.kind === "income" ? "income" : "expense";
  const description = typeof raw.description === "string" && raw.description.trim()
    ? raw.description.trim().slice(0, 120)
    : "Lançamento importado de documento";
  return { ok: true, value: { ...raw, kind, amount, confidence, description } };
}


function financeContext(body: FinanceContext) {
  return {
    entities: (body.entities ?? []).slice(0, 30),
    categories: (body.categories ?? []).slice(0, 80),
    accounts: (body.accounts ?? []).slice(0, 80),
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
  const context = financeContext(body);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "Voce interpreta lancamentos financeiros pessoais e empresariais em portugues do Brasil. Nunca invente IDs. Use apenas IDs fornecidos. Escolha income para dinheiro que entrou e expense para dinheiro que saiu. Extraia o valor monetario principal. Se uma entidade, categoria ou conta nao puder ser determinada com seguranca, retorne null nesse ID. Descricao deve ser curta e util. document_date use YYYY-MM-DD quando houver data explicita, senao null. Confidence vai de 0 a 1.",
        },
        { role: "user", content: `Comando: ${text}\n\nOpcoes disponiveis:\n${JSON.stringify(context)}` },
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
    return json({ source: "openai", interpretation: JSON.parse(output) });
  } catch {
    return json({ error: "ai_invalid_response" }, 502);
  }
}

async function uploadDocumentToOpenAI(apiKey: string, signedUrl: string, name: string, mimeType?: string) {
  const source = await fetch(signedUrl);
  if (!source.ok) throw new Error(`document_fetch_${source.status}`);
  const bytes = await source.arrayBuffer();
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("document_too_large");

  const form = new FormData();
  form.append("purpose", "user_data");
  form.append("file", new Blob([bytes], { type: mimeType || source.headers.get("content-type") || "application/octet-stream" }), name);

  const upload = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!upload.ok) {
    const detail = await upload.text();
    throw new Error(`openai_file_upload_${upload.status}:${detail.slice(0, 200)}`);
  }
  const payload = await upload.json() as { id?: string };
  if (!payload.id) throw new Error("openai_file_missing_id");
  return payload.id;
}

async function deleteOpenAIFile(apiKey: string, fileId: string) {
  try {
    await fetch(`https://api.openai.com/v1/files/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${apiKey}` },
    });
  } catch {
    // Limpeza best-effort; nunca bloqueia o lancamento.
  }
}

async function handleDocumentInterpret(request: Request, env: unknown): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!(await verifySupabaseUser(request, env))) return json({ error: "unauthorized" }, 401);

  let body: DocumentInterpretBody;
  try {
    body = (await request.json()) as DocumentInterpretBody;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const documents = (body.documents ?? []).slice(0, 3);
  if (!documents.length) return json({ error: "no_documents" }, 400);

  const { supabaseUrl } = getSupabaseConfig(env);
  if (!supabaseUrl) return json({ error: "backend_not_configured" }, 503);
  const allowedOrigin = new URL(supabaseUrl).origin;
  for (const document of documents) {
    try {
      if (new URL(document.signed_url).origin !== allowedOrigin) return json({ error: "invalid_document_url" }, 400);
    } catch {
      return json({ error: "invalid_document_url" }, 400);
    }
  }

  const apiKey = envValue(env, "OPENAI_API_KEY");
  if (!apiKey) return json({ error: "ai_not_configured" }, 503);
  const model = envValue(env, "OPENAI_MODEL") || "gpt-5.6-luna";
  const context = financeContext(body);
  const uploadedFileIds: string[] = [];

  try {
    const content: Array<Record<string, unknown>> = [];
    content.push({
      type: "input_text",
      text:
        `Leia os documentos anexados como comprovantes financeiros. Contexto opcional do usuario: ${body.text?.trim() || "(sem texto)"}. ` +
        `Identifique o valor principal/total do documento, se e valor a receber (income) ou a pagar/gasto (expense), fornecedor/pagador, data e descricao. ` +
        `Use SOMENTE IDs das opcoes fornecidas. Se o texto do usuario disser que e para receber, priorize income. Opcoes: ${JSON.stringify(context)}`,
    });

    for (const document of documents) {
      const isImage = (document.mime_type || "").startsWith("image/");
      if (isImage) {
        content.push({ type: "input_image", image_url: document.signed_url, detail: "high" });
      } else {
        const fileId = await uploadDocumentToOpenAI(apiKey, document.signed_url, document.name, document.mime_type);
        uploadedFileIds.push(fileId);
        content.push({ type: "input_file", file_id: fileId });
      }
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content:
              "Voce e um extrator financeiro preciso. Leia notas fiscais, recibos, boletos, PDFs, planilhas e documentos financeiros. Nao invente valores nem IDs. Use o valor total principal do documento, nao CNPJ, chave, numero da nota ou codigo de barras. Para comissao ou nota emitida para receber, use income. Para compra, conta, conserto ou despesa, use expense. document_date em YYYY-MM-DD quando identificavel. Confidence de 0 a 1.",
          },
          { role: "user", content },
        ],
        text: { format: { type: "json_schema", name: "financial_document_interpretation", strict: true, schema: financeSchema() } },
        max_output_tokens: 320,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error(`[OpenAI document interpret] ${response.status}: ${detail.slice(0, 800)}`);
      return json({ error: "document_ai_unavailable" }, 502);
    }

    const payload = await response.json();
    const output = extractResponseText(payload);
    if (!output) return json({ error: "ai_empty_response" }, 502);

    try {
      return json({ source: "openai_document", interpretation: JSON.parse(output) });
    } catch {
      return json({ error: "ai_invalid_response" }, 502);
    }
  } catch (error) {
    console.error("[Document interpret]", error);
    return json({ error: "document_processing_failed" }, 502);
  } finally {
    await Promise.all(uploadedFileIds.map((id) => deleteOpenAIFile(apiKey, id)));
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
