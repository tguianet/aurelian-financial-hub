import {
  DEFAULT_CATEGORY_SEMANTICS,
  blendSemanticConfidence,
  matchEntityRecord,
  resolveCategoryId,
  resolveCategoryMatch,
} from "./categories";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const catalog = DEFAULT_CATEGORY_SEMANTICS.map((item, index) => ({
  id: `${item.kind}-${index}`,
  name: item.name,
  kind: item.kind,
  active: true,
  description: item.description,
  ai_keywords: item.keywords,
}));

function idOf(name: string) {
  const row = catalog.find((item) => item.name === name);
  if (!row) throw new Error(`categoria ausente no catalogo: ${name}`);
  return row.id;
}

function nameOf(id: string | null) {
  return catalog.find((item) => item.id === id)?.name ?? null;
}

export function runSemanticMatchChecks() {
  const cases: Array<[string, "income" | "expense", string]> = [
    ["Gastei 220 no posto", "expense", "Combustível"],
    ["Troquei dois pneus por 900", "expense", "Manutenção"],
    ["Paguei 150 de internet", "expense", "Internet e telefone"],
    ["Paguei 800 no Meta Ads", "expense", "Marketing / Publicidade"],
    ["Comprei mercadoria do fornecedor por 5 mil", "expense", "Fornecedores"],
    ["Recebi 3% de comissão", "income", "Comissões"],
    ["Paguei o condomínio", "expense", "Moradia"],
    ["Peguei Uber para reunião", "expense", "Transporte"],
    ["Fui ao cinema", "expense", "Lazer"],
    ["Comprei remédio", "expense", "Saúde"],
  ];

  for (const [phrase, kind, expected] of cases) {
    const match = resolveCategoryMatch(catalog, kind, phrase);
    assert(!match.ambiguous, `"${phrase}" não deveria ficar ambígua`);
    assert(nameOf(match.id) === expected, `"${phrase}" → ${nameOf(match.id)} (esperado ${expected})`);
  }

  const exact = resolveCategoryMatch(catalog, "expense", "Combustível");
  assert(exact.source === "name" && exact.confidence >= 0.9, "match no nome exato = alta confiança");

  const twoKeywords = resolveCategoryMatch(catalog, "expense", "Gastei 220 no posto para abastecer");
  assert(twoKeywords.source === "keyword" && twoKeywords.confidence >= 0.8, "2+ keywords = alta confiança");
  assert(nameOf(twoKeywords.id) === "Combustível", "posto + abastecer = Combustível");

  const oneKeyword = resolveCategoryMatch(catalog, "expense", "Gastei 220 no posto");
  assert(oneKeyword.source === "keyword" && oneKeyword.confidence >= 0.6 && oneKeyword.confidence < 0.8, "1 keyword = média");

  const invented = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  assert(
    resolveCategoryId(catalog, "expense", invented, "xyzzy sem pista") === idOf("Outras despesas"),
    "UUID inventado é ignorado e cai no fallback",
  );

  const mixed = [
    { id: "a", name: "Oficina A", kind: "expense" as const, active: true, ai_keywords: ["foobar"] },
    { id: "b", name: "Oficina B", kind: "expense" as const, active: true, ai_keywords: ["foobar"] },
    { id: "c", name: "Outras despesas", kind: "expense" as const, active: true, ai_keywords: [] },
  ];
  const ambiguous = resolveCategoryMatch(mixed, "expense", "paguei foobar hoje");
  assert(ambiguous.ambiguous && ambiguous.id === null, "ambiguidade não decide silenciosamente");
  assert(blendSemanticConfidence(0.9, ambiguous) <= 0.45, "confiança baixa na ambiguidade");

  const entities = [
    { id: "pessoal", name: "Pessoal", slug: "pessoal", active: true, ai_keywords: ["casa"] },
    { id: "shopee", name: "Shopee", slug: "shopee", active: true, ai_keywords: ["shopee", "entrega", "pacote"] },
  ];
  assert(matchEntityRecord(entities, "gastei 20 no posto", "pessoal").id === "pessoal", "entidade do topo prevalece");
  assert(matchEntityRecord(entities, "entrega da shopee", "pessoal").id === "shopee", "nome explícito de outra entidade pode sobrescrever");
  assert(matchEntityRecord(entities, "pacote da rota", null).id === "shopee", "keyword da entidade");

  console.log("categorias/entidades semanticas: frases, confiança e isolamento ok");
}

runSemanticMatchChecks();
