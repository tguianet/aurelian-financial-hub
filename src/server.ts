import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

type FinanceInterpretBody = {
  text?: string;
  entities?: Array<{ id: string; name: string; slug?: string }>;
  categories?: Array<{ id: string; name: string; kind: string }>;
  accounts?: Array<{ id: string; name: string; entity_id: string }>;
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

async function verifySupabaseUser(request: Request, env: unknown) {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;

  const supabaseUrl =
    envValue(env, "SUPABASE_URL") ||
    envValue(env, "VITE_SUPABASE_URL") ||
    import.meta.env["VITE_SUPABASE_URL"];
  const publishableKey =
    envValue(env, "SUPABASE_PUBLISHABLE_KEY") ||
    envValue(env, "VITE_SUPABASE_PUBLISHABLE_KEY") ||
    import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];

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
  const context = {
    entities: (body.entities ?? []).slice(0, 30),
    categories: (body.categories ?? []).slice(0, 80),
    accounts: (body.accounts ?? []).slice(0, 80),
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "Voce interpreta lancamentos financeiros pessoais e empresariais em portugues do Brasil. Nunca invente IDs. Use apenas IDs fornecidos. Escolha income para dinheiro que entrou e expense para dinheiro que saiu. Extraia o valor monetario principal. Se uma entidade, categoria ou conta nao puder ser determinada com seguranca, retorne null nesse ID. Descricao deve ser curta e util. Confidence vai de 0 a 1.",
        },
        {
          role: "user",
          content: `Comando: ${text}\n\nOpcoes disponiveis:\n${JSON.stringify(context)}`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "finance_interpretation",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: { type: "string", enum: ["income", "expense"] },
              amount: { type: "number", exclusiveMinimum: 0 },
              entity_id: { type: ["string", "null"] },
              category_id: { type: ["string", "null"] },
              account_id: { type: ["string", "null"] },
              description: { type: "string", minLength: 1, maxLength: 100 },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: [
              "kind",
              "amount",
              "entity_id",
              "category_id",
              "account_id",
              "description",
              "confidence",
            ],
          },
        },
      },
      max_output_tokens: 220,
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

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
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
      if (url.pathname === "/api/finance/interpret") {
        return await handleFinanceInterpret(request, env);
      }

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
