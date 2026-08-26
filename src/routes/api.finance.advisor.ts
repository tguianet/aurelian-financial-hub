import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

type AdvisorContext = {
  scope?: { entityId?: string; entityName?: string };
  period?: string;
  kpis?: Record<string, number>;
  projections?: Array<Record<string, number>>;
  entities?: Array<Record<string, string | number>>;
  categories?: Array<Record<string, string | number | null>>;
  alerts?: Array<Record<string, string>>;
  dueSoon?: Array<Record<string, string | number>>;
  health?: { score?: number; label?: string; reasons?: string[] };
};

type AdvisorHistoryItem = { role?: "user" | "assistant"; text?: string };

type AdvisorBody = {
  question?: string;
  context?: AdvisorContext;
  history?: AdvisorHistoryItem[];
};

function envValue(key: string) {
  const processValue = typeof process !== "undefined" ? process.env?.[key] : undefined;
  if (processValue) return processValue;
  const viteValue = import.meta.env[key];
  return typeof viteValue === "string" && viteValue ? viteValue : undefined;
}

function textFromResponse(payload: any): string | null {
  if (typeof payload?.output_text === "string" && payload.output_text) return payload.output_text;
  for (const item of payload?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (typeof content?.text === "string" && content.text) return content.text;
    }
  }
  return null;
}

async function verifyUser(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const url = envValue("SUPABASE_URL") || envValue("VITE_SUPABASE_URL");
  const key = envValue("SUPABASE_PUBLISHABLE_KEY") || envValue("VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) return false;
  const supabase = createClient(url, key, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data, error } = await supabase.auth.getUser();
  return !error && Boolean(data.user);
}

function sanitizeContext(context: AdvisorContext | undefined) {
  if (!context || typeof context !== "object") return null;
  return {
    scope: {
      entityName: String(context.scope?.entityName ?? "Todas as entidades").slice(0, 80),
    },
    period: String(context.period ?? "").slice(0, 10),
    kpis: context.kpis ?? {},
    projections: Array.isArray(context.projections) ? context.projections.slice(0, 5) : [],
    entities: Array.isArray(context.entities) ? context.entities.slice(0, 20) : [],
    categories: Array.isArray(context.categories) ? context.categories.slice(0, 15) : [],
    alerts: Array.isArray(context.alerts) ? context.alerts.slice(0, 8) : [],
    dueSoon: Array.isArray(context.dueSoon) ? context.dueSoon.slice(0, 12) : [],
    health: context.health ?? {},
  };
}

function sanitizeHistory(history: AdvisorHistoryItem[] | undefined) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.text === "string")
    .slice(-6)
    .map((item) => ({ role: item.role, text: String(item.text).slice(0, 700) }));
}

export const Route = createFileRoute("/api/finance/advisor")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await verifyUser(request))) {
          return Response.json({ message: "Sessão inválida." }, { status: 401 });
        }

        let body: AdvisorBody;
        try {
          body = await request.json() as AdvisorBody;
        } catch {
          return Response.json({ message: "Requisição inválida." }, { status: 400 });
        }

        const question = body.question?.trim();
        if (!question || question.length > 500) {
          return Response.json({ message: "Pergunta inválida." }, { status: 400 });
        }

        const context = sanitizeContext(body.context);
        if (!context) {
          return Response.json({ message: "Contexto financeiro ausente." }, { status: 400 });
        }
        const history = sanitizeHistory(body.history);

        const apiKey = envValue("OPENAI_API_KEY");
        if (!apiKey) {
          return Response.json({ message: "Consultor IA ainda não está configurado." }, { status: 503 });
        }

        const model = envValue("OPENAI_MODEL") || "gpt-5.6-luna";
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
                  "Voce e o Consultor Financeiro do Aurelian Finance. Responda em portugues do Brasil, de forma objetiva e executiva. Use SOMENTE os numeros, nomes e datas presentes no contexto JSON e no historico controlado fornecido. Nunca invente valor, empresa, categoria, data, margem ou previsao. Se o contexto nao trouxer dados suficientes, diga claramente que nao ha base suficiente. Nao sugira executar SQL, nao peca acesso ao banco e nao crie lancamentos. Diferencie fato calculado de recomendacao. Recomendacoes devem ser prudentes, acionaveis e baseadas nos alertas e indicadores fornecidos. Para vencimentos, use dueSoon quando disponivel. Nao exponha IDs internos. Valores monetarios devem ser apresentados em reais quando fizer sentido.",
              },
              {
                role: "user",
                content: `Historico recente controlado:\n${JSON.stringify(history)}\n\nPergunta atual: ${question}\n\nContexto financeiro controlado:\n${JSON.stringify(context)}`,
              },
            ],
            max_output_tokens: 520,
          }),
        });

        if (!response.ok) {
          const detail = await response.text();
          console.error(`[Advisor OpenAI] ${response.status}: ${detail.slice(0, 500)}`);
          return Response.json({ message: "O Consultor IA está temporariamente indisponível." }, { status: 502 });
        }

        const payload = await response.json();
        const answer = textFromResponse(payload)?.trim();
        if (!answer) {
          return Response.json({ message: "O Consultor IA não retornou uma resposta válida." }, { status: 502 });
        }

        return Response.json({ answer, source: "openai", model });
      },
    },
  },
});
