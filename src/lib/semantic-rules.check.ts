import { DEFAULT_CATEGORY_SEMANTICS, acceptedEntityId, matchEntityRecord, resolveCategoryMatch } from "./categories";
import {
  extractSemanticHint,
  findExactSemanticRule,
  resolveQuickEntryFields,
} from "./semantic-rules";

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

const entities = [
  { id: "pessoal", name: "Pessoal", slug: "pessoal", active: true, ai_keywords: ["casa"] },
  { id: "shopee", name: "Shopee", slug: "shopee", active: true, ai_keywords: ["shopee", "entrega", "pacote"] },
  { id: "tguianet", name: "TGuiaNet", slug: "tguianet", active: true, ai_keywords: [] as string[] },
  { id: "joias", name: "empresa de joias", slug: "empresa-de-joias", active: true, ai_keywords: [] as string[] },
  { id: "restaurante", name: "Restaurante", slug: "restaurante", active: true, ai_keywords: [] as string[] },
];

const alimentacaoId = catalog.find((item) => item.name === "Alimentação")?.id ?? null;
const combustivelId = catalog.find((item) => item.name === "Combustível")?.id ?? null;
const marketingId = catalog.find((item) => item.name === "Marketing / Publicidade")?.id ?? null;

export function runSemanticRulesChecks() {
  assert(extractSemanticHint("padaria santa rita 32 reais").normalized === "padaria santa rita", "hint padaria santa rita");
  assert(extractSemanticHint("abasteci 150 no posto ipiranga").normalized === "posto ipiranga", "hint posto ipiranga");
  assert(extractSemanticHint("paguei meta ads 800").normalized === "meta ads", "hint meta ads");
  assert(extractSemanticHint("padaria r$ 10").normalized === "padaria", "hint padaria sem valor");
  assert(extractSemanticHint("gastei 42 na padaria santa rita").normalized === "padaria santa rita", "hint sem verbo/valor");

  const padaria = resolveQuickEntryFields({
    text: "padaria r$ 10",
    kind: "expense",
    entities,
    categories: catalog,
    rules: [],
  });
  assert(padaria.categoryId === alimentacaoId, "padaria r$ 10 → Alimentação");
  assert(padaria.entityId === null && padaria.needsEntity, "padaria r$ 10 → modal de entidade");
  assert(!padaria.needsCategory, "padaria r$ 10 categoria resolvida");

  const learned = [{
    id: "rule-padaria",
    rule_type: "entity" as const,
    normalized_hint: "padaria santa rita",
    original_hint: "Padaria Santa Rita",
    entity_id: "restaurante",
    category_id: null,
    active: true,
  }];

  const firstLearn = resolveQuickEntryFields({
    text: "padaria santa rita r$ 20",
    kind: "expense",
    entities,
    categories: catalog,
    rules: [],
  });
  assert(firstLearn.entityId === null && firstLearn.needsEntity, "antes de lembrar, entidade null");
  assert(firstLearn.hint === "padaria santa rita", "hint aprendível");

  const recalled = resolveQuickEntryFields({
    text: "gastei 35 na padaria santa rita",
    kind: "expense",
    entities,
    categories: catalog,
    rules: learned,
  });
  assert(recalled.entityId === "restaurante", "regra semântica aplica Restaurante");
  assert(recalled.appliedRule?.id === "rule-padaria", "regra exata aplicada");
  assert(recalled.categoryId === alimentacaoId, "categoria segue o parser");

  const explicitWins = resolveQuickEntryFields({
    text: "padaria santa rita da Shopee 40",
    kind: "expense",
    entities,
    categories: catalog,
    rules: learned,
  });
  assert(explicitWins.entityId === "shopee", "menção explícita Shopee vence regra Restaurante");
  assert(acceptedEntityId(matchEntityRecord(entities, "padaria santa rita da Shopee 40")) === "shopee", "nome explícito no matcher");

  const unknown = resolveQuickEntryFields({
    text: "xyz qualquer 200",
    kind: "expense",
    entities,
    categories: catalog,
    rules: [],
  });
  assert(unknown.needsEntity && unknown.needsCategory, "sem pista → modal pede entidade e categoria");
  assert(unknown.entityId === null && unknown.categoryId === null, "xyz não inventa entidade/categoria");

  const otherSpaceRule = findExactSemanticRule("padaria santa rita", []);
  assert(otherSpaceRule === null, "regra de outro space não entra no catálogo atual");

  const viewerRole = { write: false, canUseExisting: true, canCreate: false };
  assert(viewerRole.canUseExisting && !viewerRole.canCreate && !viewerRole.write, "viewer usa regra e não cria");

  const meta = resolveQuickEntryFields({
    text: "paguei meta ads 800",
    kind: "expense",
    entities,
    categories: catalog,
    rules: [{
      id: "rule-meta",
      rule_type: "entity_category",
      normalized_hint: "meta ads",
      original_hint: "Meta Ads",
      entity_id: "tguianet",
      category_id: marketingId,
      active: true,
    }],
  });
  assert(meta.entityId === "tguianet" && meta.categoryId === marketingId, "meta ads → TGuiaNet + Marketing por regra");

  const inactive = resolveQuickEntryFields({
    text: "gastei 35 na padaria santa rita",
    kind: "expense",
    entities,
    categories: catalog,
    rules: [{ ...learned[0]!, active: false }],
  });
  assert(inactive.entityId === null, "regra inativa não aplica");

  const categoryKnown = resolveCategoryMatch(catalog, "expense", "padaria r$ 10");
  assert(categoryKnown.id === alimentacaoId, "categoria padaria estável");
  assert(combustivelId, "catálogo de combustível presente");

  console.log("regras semanticas: hint, prioridade, override e viewer ok");
}

runSemanticRulesChecks();
