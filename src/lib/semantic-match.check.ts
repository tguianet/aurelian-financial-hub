import {
  DEFAULT_CATEGORY_SEMANTICS,
  acceptedEntityId,
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
    { id: "tguianet", name: "TGuiaNet", slug: "tguianet", active: true, ai_keywords: [] as string[] },
    { id: "joias", name: "empresa de joias", slug: "empresa-de-joias", active: true, ai_keywords: [] as string[] },
    { id: "restaurante", name: "Restaurante", slug: "restaurante", active: true, ai_keywords: [] as string[] },
  ];

  const entityIdOf = (name: string) => entities.find((item) => item.name === name)?.id ?? null;
  const categoryFor = (phrase: string, kind: "income" | "expense" = "expense") =>
    nameOf(resolveCategoryMatch(catalog, kind, phrase).id);
  const acceptedEntity = (phrase: string, preferred?: string | null) =>
    acceptedEntityId(matchEntityRecord(entities, phrase, preferred));

  assert(categoryFor("padaria r$ 10") === "Alimentação", "padaria r$ 10 → Alimentação");
  assert(acceptedEntity("padaria r$ 10") === null, "padaria r$ 10 → entidade null");

  assert(categoryFor("padaria r$ 10 da Shopee") === "Alimentação", "padaria Shopee → Alimentação");
  assert(acceptedEntity("padaria r$ 10 da Shopee") === "shopee", "padaria Shopee → Shopee");

  assert(categoryFor("gasolina 150") === "Combustível", "gasolina 150 → Combustível");
  assert(acceptedEntity("gasolina 150") === null, "gasolina 150 → entidade null");

  assert(categoryFor("gasolina 150 Shopee") === "Combustível", "gasolina Shopee → Combustível");
  assert(acceptedEntity("gasolina 150 Shopee") === "shopee", "gasolina Shopee → Shopee");

  assert(categoryFor("meta ads 800 tguianet") === "Marketing / Publicidade", "meta ads tguianet → Marketing");
  assert(acceptedEntity("meta ads 800 tguianet") === "tguianet", "meta ads tguianet → TGuiaNet");

  assert(categoryFor("troquei dois pneus por 900") === "Manutenção", "pneus → Manutenção");
  assert(acceptedEntity("troquei dois pneus por 900") === null, "pneus → entidade null");

  assert(categoryFor("troquei dois pneus da empresa de joias por 900") === "Manutenção", "pneus joias → Manutenção");
  assert(acceptedEntity("troquei dois pneus da empresa de joias por 900") === "joias", "pneus joias → empresa de joias");

  const preferredJoias = matchEntityRecord(entities, "padaria r$ 10", "joias");
  assert(preferredJoias.source === "preferred" && preferredJoias.confidence <= 0.3, "topo é baixa confiança");
  assert(acceptedEntityId(preferredJoias) === null, "padaria com joias no topo NÃO aplica entidade");

  assert(acceptedEntity("padaria 35 restaurante") === "restaurante", "padaria restaurante → Restaurante");
  assert(acceptedEntity("comprei pneu 900 para a Shopee") === "shopee", "pneu Shopee → Shopee");

  const duplicates = [
    ...entities,
    { id: "tguianet-dup", name: "tguianet", slug: "tguianet-dup", active: true, ai_keywords: [] as string[] },
  ];
  const duplicateMatch = matchEntityRecord(duplicates, "meta ads 800 tguianet", null);
  assert(duplicateMatch.ambiguous && acceptedEntityId(duplicateMatch) === null, "tguianet duplicado fica ambíguo");

  assert(matchEntityRecord(entities, "gastei 20 no posto", "pessoal").source === "preferred", "sem menção: só preferred baixa");
  assert(acceptedEntityId(matchEntityRecord(entities, "entrega da shopee", "pessoal")) === "shopee", "nome explícito prevalece sobre o topo");
  assert(acceptedEntity("pacote da rota") === "shopee", "keyword exclusiva da entidade");
  assert(entityIdOf("TGuiaNet") === "tguianet", "catálogo de teste estável");

  console.log("categorias/entidades semanticas: frases, confiança e isolamento ok");
}

runSemanticMatchChecks();
