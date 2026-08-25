import type { Category } from "./finance";

export const FALLBACK_CATEGORY_NAME = {
  income: "Outras receitas",
  expense: "Outras despesas",
} as const;

export const MAX_AI_DESCRIPTION = 180;
export const MAX_AI_KEYWORDS = 16;
export const MAX_AI_KEYWORD_LENGTH = 40;

const STOPWORDS = new Set([
  "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas",
  "para", "pra", "com", "por", "um", "uma", "uns", "umas",
  "o", "a", "os", "as", "e", "ou", "ao", "aos", "que", "se",
  "meu", "minha", "foi", "fui", "paguei", "gastei", "comprei", "recebi",
]);

export function normalizeCategoryName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function isCategoryActive(category: { active?: boolean }): boolean {
  return category.active !== false;
}

export function selectableCategories(
  categories: Category[],
  kind?: Category["kind"],
): Category[] {
  return categories.filter(
    (category) => isCategoryActive(category) && (!kind || category.kind === kind),
  );
}

export function parseKeywordInput(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\n]+/)) {
    const value = part.trim().slice(0, MAX_AI_KEYWORD_LENGTH);
    if (value.length < 2) continue;
    const key = normalizeCategoryName(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= MAX_AI_KEYWORDS) break;
  }
  return out;
}

export function formatKeywordInput(keywords: string[] | null | undefined): string {
  return (keywords ?? []).join(", ");
}

export function clipAiDescription(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().slice(0, MAX_AI_DESCRIPTION);
  return trimmed || null;
}

export type SemanticRecord = {
  id: string;
  name: string;
  description?: string | null;
  ai_keywords?: string[] | null;
};

export type SemanticMatch = {
  id: string | null;
  confidence: number;
  ambiguous: boolean;
  source: "preferred" | "name" | "keyword" | "description" | "fallback" | "none";
};

const BUILTIN_ALIASES: Record<string, string[]> = {
  veiculo: ["moto", "motocicleta", "carro", "van", "saveiro", "caminhao"],
  manutencao: ["conserto", "reparo", "oficina", "pneu", "oleo"],
  combustivel: ["gasolina", "etanol", "alcool", "posto", "abastecer", "abastecimento", "diesel"],
  alimentacao: ["comida", "almoco", "janta", "jantar", "mercado", "restaurante", "lanche"],
  "energia eletrica": ["conta de luz", "luz", "energia", "cpfl"],
  comissoes: ["comissao", "comparta", "indicacao"],
  vendas: ["vendi", "venda", "faturei", "faturamento"],
  transporte: ["uber", "taxi", "onibus", "pedagio", "estacionamento", "frete"],
  "marketing / publicidade": ["meta ads", "facebook ads", "google ads", "anuncio", "trafego", "campanha"],
  moradia: ["aluguel", "condominio", "residencia"],
  saude: ["remedio", "farmacia", "medico", "consulta", "exame"],
  lazer: ["cinema", "passeio", "viagem", "diversao"],
  "internet e telefone": ["internet", "telefone", "celular", "claro", "vivo", "tim"],
  fornecedores: ["fornecedor", "mercadoria", "insumo", "materia-prima"],
};

export const DEFAULT_CATEGORY_SEMANTICS: Array<{
  name: string;
  kind: "income" | "expense";
  description: string;
  keywords: string[];
}> = [
  { name: "Vendas", kind: "income", description: "Receitas provenientes da venda de produtos.", keywords: ["venda", "cliente", "pedido", "produto", "mercadoria", "faturamento"] },
  { name: "Serviços", kind: "income", description: "Receitas pela prestação de serviços.", keywords: ["servico", "prestacao", "projeto", "mensalidade", "consultoria"] },
  { name: "Comissões", kind: "income", description: "Receitas de comissão por vendas, indicações ou intermediação.", keywords: ["comissao", "indicacao", "percentual", "intermediacao"] },
  { name: "Salário / Pró-labore", kind: "income", description: "Remuneração pessoal, salário ou pró-labore.", keywords: ["salario", "pro labore", "pro-labore", "retirada", "remuneracao"] },
  { name: "Rendimentos", kind: "income", description: "Rendimentos de aplicações, juros ou ganhos financeiros.", keywords: ["rendimento", "juros", "investimento", "aplicacao"] },
  { name: "Reembolsos", kind: "income", description: "Valores recebidos como devolução de gastos.", keywords: ["reembolso", "devolucao", "ressarcimento"] },
  { name: "Outras receitas", kind: "income", description: "Receitas que não se encaixam nas demais categorias.", keywords: ["outra receita", "entrada diversa", "receita diversa"] },
  { name: "Alimentação", kind: "expense", description: "Gastos com refeições, comida e alimentação.", keywords: ["almoco", "jantar", "lanche", "comida", "restaurante", "mercado"] },
  { name: "Combustível", kind: "expense", description: "Gastos com abastecimento de veículos.", keywords: ["gasolina", "etanol", "alcool", "diesel", "posto", "combustivel", "abastecimento", "abastecer"] },
  { name: "Fornecedores", kind: "expense", description: "Pagamentos a fornecedores e compra de mercadorias ou insumos.", keywords: ["fornecedor", "mercadoria", "materia-prima", "insumo", "compra para estoque"] },
  { name: "Funcionários", kind: "expense", description: "Custos relacionados a funcionários e equipe.", keywords: ["salario", "funcionario", "folha", "diaria", "vale", "beneficio", "equipe"] },
  { name: "Energia elétrica", kind: "expense", description: "Contas e despesas com energia elétrica.", keywords: ["energia", "conta de luz", "cpfl", "eletricidade"] },
  { name: "Água", kind: "expense", description: "Contas e despesas relacionadas ao consumo de água.", keywords: ["agua", "conta de agua", "saneamento"] },
  { name: "Internet e telefone", kind: "expense", description: "Internet, telefone fixo, celular e telecomunicações.", keywords: ["internet", "telefone", "celular", "claro", "vivo", "tim", "oi"] },
  { name: "Software e assinaturas", kind: "expense", description: "Softwares, plataformas e assinaturas digitais.", keywords: ["software", "assinatura", "mensalidade", "saas", "app", "sistema", "licenca"] },
  { name: "Impostos", kind: "expense", description: "Tributos, impostos, taxas e obrigações fiscais.", keywords: ["imposto", "das", "mei", "simples", "iss", "icms", "taxa", "tributo"] },
  { name: "Veículo", kind: "expense", description: "Gastos gerais relacionados a veículos que não sejam combustível ou manutenção.", keywords: ["veiculo", "carro", "moto", "documento", "licenciamento", "seguro", "ipva"] },
  { name: "Manutenção", kind: "expense", description: "Consertos, revisões e manutenção de veículos, equipamentos ou estrutura.", keywords: ["manutencao", "oficina", "revisao", "conserto", "peca", "pneu", "oleo", "reparo"] },
  { name: "Saúde", kind: "expense", description: "Gastos médicos, medicamentos, consultas e saúde.", keywords: ["medico", "consulta", "remedio", "medicamento", "farmacia", "exame", "saude"] },
  { name: "Moradia", kind: "expense", description: "Despesas relacionadas à residência.", keywords: ["aluguel", "condominio", "casa", "residencia", "moradia"] },
  { name: "Transporte", kind: "expense", description: "Gastos de deslocamento que não sejam abastecimento próprio.", keywords: ["uber", "taxi", "onibus", "passagem", "pedagio", "estacionamento", "frete"] },
  { name: "Marketing / Publicidade", kind: "expense", description: "Gastos para divulgação, anúncios e aquisição de clientes.", keywords: ["marketing", "publicidade", "anuncio", "trafego", "meta ads", "facebook ads", "google ads", "campanha"] },
  { name: "Lazer", kind: "expense", description: "Gastos pessoais com lazer, passeio e entretenimento.", keywords: ["lazer", "passeio", "cinema", "viagem", "diversao", "entretenimento"] },
  { name: "Educação", kind: "expense", description: "Gastos com cursos, escola, faculdade e capacitação.", keywords: ["curso", "escola", "faculdade", "mensalidade escolar", "treinamento", "educacao"] },
  { name: "Tarifas bancárias", kind: "expense", description: "Taxas, tarifas e custos cobrados por bancos e meios de pagamento.", keywords: ["tarifa", "taxa bancaria", "juros bancarios", "banco", "maquininha"] },
  { name: "Outras despesas", kind: "expense", description: "Despesas que não se encaixam nas demais categorias.", keywords: ["outra despesa", "despesa diversa", "gasto diverso"] },
];

function simpleStem(word: string): string {
  if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function tokenize(normalized: string): string[] {
  return normalized
    .split(/[^a-z0-9]+/)
    .map(simpleStem)
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word));
}

function keywordMatchesHint(keyword: string, hint: string, hintTokens: Set<string>): boolean {
  if (keyword.includes(" ")) return hint.includes(keyword);
  const stem = simpleStem(keyword);
  if (stem.length <= 3) return hintTokens.has(stem) || hintTokens.has(keyword);
  return hint.includes(keyword) || hintTokens.has(stem);
}

function keywordList(record: SemanticRecord): string[] {
  const nameKey = normalizeCategoryName(record.name);
  const extra = BUILTIN_ALIASES[nameKey] ?? [];
  const stored = (record.ai_keywords ?? []).map((item) => normalizeCategoryName(item)).filter(Boolean);
  const seed = DEFAULT_CATEGORY_SEMANTICS.find(
    (item) => normalizeCategoryName(item.name) === nameKey,
  )?.keywords ?? [];
  return [...new Set([...stored, ...extra, ...seed])];
}

function scoreRecord(record: SemanticRecord, hint: string): { score: number; source: SemanticMatch["source"] } {
  if (!hint) return { score: 0, source: "none" };
  const name = normalizeCategoryName(record.name);
  if (!name) return { score: 0, source: "none" };

  if (hint === name) return { score: 100, source: "name" };

  const nameTokens = tokenize(name);
  const hintTokens = new Set(tokenize(hint));
  if (nameTokens.length && nameTokens.every((token) => hintTokens.has(token))) {
    return { score: 92, source: "name" };
  }
  if (name.length >= 4 && hint.includes(name)) return { score: 80, source: "name" };

  const keywords = keywordList(record).filter((item) => item.length >= 2);
  const hits = keywords.filter((keyword) => keywordMatchesHint(keyword, hint, hintTokens));
  if (hits.length >= 2) return { score: 88, source: "keyword" };
  if (hits.length === 1) {
    const longest = hits[0] ?? "";
    return { score: longest.length >= 5 || longest.includes(" ") ? 68 : 52, source: "keyword" };
  }

  const description = normalizeCategoryName(record.description ?? "");
  if (description) {
    const overlap = tokenize(description).filter((token) => hintTokens.has(token) && token.length >= 4);
    if (overlap.length >= 2) return { score: 48, source: "description" };
  }

  return { score: 0, source: "none" };
}

export function resolveSemanticMatch(
  records: SemanticRecord[],
  hintText: string | null | undefined,
  preferredId?: string | null,
): SemanticMatch {
  if (preferredId && records.some((record) => record.id === preferredId)) {
    return { id: preferredId, confidence: 1, ambiguous: false, source: "preferred" };
  }

  const hint = hintText ? normalizeCategoryName(hintText) : "";
  if (!hint || !records.length) return { id: null, confidence: 0, ambiguous: false, source: "none" };

  const ranked = records
    .map((record) => ({ record, ...scoreRecord(record, hint) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  if (!top) return { id: null, confidence: 0, ambiguous: false, source: "none" };

  const runnerUp = ranked[1];
  const ambiguous = Boolean(runnerUp && runnerUp.score >= top.score - 10 && runnerUp.record.id !== top.record.id && top.score < 90);
  if (ambiguous) {
    return { id: null, confidence: Math.min(0.45, top.score / 100), ambiguous: true, source: top.source };
  }

  return {
    id: top.record.id,
    confidence: Math.min(1, top.score / 100),
    ambiguous: false,
    source: top.source,
  };
}

export function resolveCategoryMatch(
  categories: Array<{
    id: string;
    name: string;
    kind: "income" | "expense";
    active?: boolean;
    description?: string | null;
    ai_keywords?: string[] | null;
  }>,
  kind: "income" | "expense",
  hintText?: string | null,
): SemanticMatch {
  const pool = categories.filter((category) => category.kind === kind && isCategoryActive(category));
  const match = resolveSemanticMatch(pool, hintText);
  if (match.id || match.ambiguous) return match;
  const fallback = pool.find(
    (category) => normalizeCategoryName(category.name) === normalizeCategoryName(FALLBACK_CATEGORY_NAME[kind]),
  );
  return {
    id: fallback?.id ?? null,
    confidence: fallback ? 0.25 : 0,
    ambiguous: false,
    source: fallback ? "fallback" : "none",
  };
}

export function resolveCategoryId(
  categories: Array<{
    id: string;
    name: string;
    kind: "income" | "expense";
    active?: boolean;
    description?: string | null;
    ai_keywords?: string[] | null;
  }>,
  kind: "income" | "expense",
  _suggestedId?: string | null,
  hintText?: string | null,
): string | null {
  return resolveCategoryMatch(categories, kind, hintText).id;
}

export function matchEntityRecord(
  entities: Array<{
    id: string;
    name: string;
    active?: boolean;
    description?: string | null;
    ai_keywords?: string[] | null;
    slug?: string | null;
  }>,
  hintText: string | null | undefined,
  preferredId?: string | null,
): SemanticMatch {
  const active = entities.filter((entity) => entity.active !== false);
  if (preferredId && active.some((entity) => entity.id === preferredId)) {
    const hint = hintText ? normalizeCategoryName(hintText) : "";
    if (hint) {
      const mentioned = active.filter((entity) => {
        const name = normalizeCategoryName(entity.name);
        const slug = normalizeCategoryName(entity.slug ?? "");
        return (name.length >= 3 && hint.includes(name)) || (slug.length >= 3 && hint.includes(slug));
      });
      if (mentioned.length === 1 && mentioned[0]!.id !== preferredId) {
        return { id: mentioned[0]!.id, confidence: 0.9, ambiguous: false, source: "name" };
      }
    }
    return { id: preferredId, confidence: 1, ambiguous: false, source: "preferred" };
  }
  return resolveSemanticMatch(active, hintText);
}

const MAX_AI_PAYLOAD_DESCRIPTION = 120;
const MAX_AI_PAYLOAD_KEYWORDS = 8;

function seedForCategory(name: string, kind?: string) {
  const key = normalizeCategoryName(name);
  return DEFAULT_CATEGORY_SEMANTICS.find(
    (item) => normalizeCategoryName(item.name) === key && (!kind || item.kind === kind),
  );
}

export function compactAiCategory(category: {
  id: string;
  name: string;
  kind: "income" | "expense";
  description?: string | null;
  ai_keywords?: string[] | null;
}) {
  const seed = seedForCategory(category.name, category.kind);
  const storedKeywords = category.ai_keywords ?? [];
  return {
    id: category.id,
    name: category.name,
    kind: category.kind,
    description: (clipAiDescription(category.description) ?? seed?.description ?? null)?.slice(0, MAX_AI_PAYLOAD_DESCRIPTION) || null,
    keywords: (storedKeywords.length ? storedKeywords : seed?.keywords ?? []).slice(0, MAX_AI_PAYLOAD_KEYWORDS),
  };
}

export function compactAiEntity(entity: {
  id: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  ai_keywords?: string[] | null;
}) {
  return {
    id: entity.id,
    name: entity.name,
    slug: entity.slug ?? null,
    description: (clipAiDescription(entity.description) ?? "").slice(0, MAX_AI_PAYLOAD_DESCRIPTION) || null,
    keywords: (entity.ai_keywords ?? []).slice(0, MAX_AI_PAYLOAD_KEYWORDS),
  };
}

export function blendSemanticConfidence(aiConfidence: number, match: SemanticMatch): number {
  const ai = Math.min(1, Math.max(0, aiConfidence));
  if (match.ambiguous) return Math.min(0.45, ai, match.confidence);
  if (match.source === "name" || (match.source === "keyword" && match.confidence >= 0.8)) {
    return Math.max(ai, match.confidence);
  }
  if (match.source === "fallback" || match.source === "none") {
    return Math.min(ai, 0.55);
  }
  return Math.min(1, (ai + match.confidence) / 2);
}
