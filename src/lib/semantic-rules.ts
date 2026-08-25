import {
  acceptedCategoryId,
  acceptedEntityId,
  matchEntityRecord,
  normalizeCategoryName,
  resolveCategoryMatch,
  type SemanticMatch,
} from "./categories";
import type { SemanticRule } from "./finance";

const HINT_STOPWORDS = new Set([
  "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas",
  "para", "pra", "com", "por", "um", "uma", "uns", "umas",
  "o", "a", "os", "as", "e", "ou", "ao", "aos", "que", "se",
  "meu", "minha", "foi", "fui", "hoje", "agora", "ainda",
  "paguei", "gastei", "comprei", "recebi", "abasteci", "entrou",
  "vendi", "ganhei", "faturei", "parcelei", "financiei", "troquei",
  "peguei", "lancar", "lancamento", "reais", "real", "centavos",
  "rs",
]);

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phraseIn(needle: string, haystack: string) {
  const normalized = normalizeCategoryName(needle);
  if (normalized.length < 3) return false;
  const pattern = escapeRegExp(normalized).replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|[^a-z0-9])${pattern}(?:$|[^a-z0-9])`).test(haystack);
}

function stripHintNoise(text: string) {
  return text
    .replace(/r\s*\$/gi, " ")
    .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{1,2}\s*x\b/gi, " ")
    .replace(/\b\d[\d.,]*\b/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractSemanticHint(text: string): { normalized: string; original: string } {
  const cleaned = stripHintNoise(text ?? "");
  if (!cleaned) return { normalized: "", original: "" };

  const keptOriginal: string[] = [];
  for (const token of cleaned.split(" ")) {
    const key = normalizeCategoryName(token);
    if (!key || HINT_STOPWORDS.has(key) || /^\d+$/.test(key)) continue;
    keptOriginal.push(token);
  }

  const original = keptOriginal.join(" ").trim();
  const normalized = normalizeCategoryName(original);
  return { normalized, original };
}

export function findExactSemanticRule(
  hint: string,
  rules: Array<Pick<SemanticRule, "id" | "normalized_hint" | "entity_id" | "category_id" | "active" | "rule_type" | "original_hint">>,
) {
  const key = normalizeCategoryName(hint);
  if (key.length < 3) return null;
  const matches = rules.filter((rule) => rule.active !== false && normalizeCategoryName(rule.normalized_hint) === key);
  return matches[0] ?? null;
}

export function findPartialSemanticRules(
  hint: string,
  rules: Array<Pick<SemanticRule, "id" | "normalized_hint" | "entity_id" | "category_id" | "active" | "rule_type" | "original_hint">>,
) {
  const key = normalizeCategoryName(hint);
  if (key.length < 3) return [];
  return rules.filter((rule) => {
    if (rule.active === false) return false;
    const ruleHint = normalizeCategoryName(rule.normalized_hint);
    if (!ruleHint || ruleHint === key) return false;
    const shorter = ruleHint.length <= key.length ? ruleHint : key;
    const tokens = shorter.split(" ").filter(Boolean);
    if (tokens.length < 2 && shorter.length < 8) return false;
    return phraseIn(ruleHint, key) || phraseIn(key, ruleHint);
  });
}

export type QuickEntryResolution = {
  hint: string;
  originalHint: string;
  entityId: string | null;
  categoryId: string | null;
  entityMatch: SemanticMatch;
  categoryMatch: SemanticMatch;
  appliedRule: Pick<SemanticRule, "id" | "normalized_hint" | "entity_id" | "category_id" | "rule_type" | "original_hint"> | null;
  partialRules: Array<Pick<SemanticRule, "id" | "normalized_hint" | "entity_id" | "category_id" | "rule_type" | "original_hint">>;
  needsEntity: boolean;
  needsCategory: boolean;
};

export function resolveQuickEntryFields(input: {
  text: string;
  kind: "income" | "expense";
  entities: Array<{
    id: string;
    name: string;
    active?: boolean;
    description?: string | null;
    ai_keywords?: string[] | null;
    slug?: string | null;
  }>;
  categories: Array<{
    id: string;
    name: string;
    kind: "income" | "expense";
    active?: boolean;
    description?: string | null;
    ai_keywords?: string[] | null;
  }>;
  rules: Array<Pick<SemanticRule, "id" | "normalized_hint" | "entity_id" | "category_id" | "active" | "rule_type" | "original_hint">>;
  preferredEntityId?: string | null;
  categoryHint?: string | null;
}): QuickEntryResolution {
  const extracted = extractSemanticHint(input.text);
  const entityMatch = matchEntityRecord(input.entities, input.text, input.preferredEntityId);
  const categoryMatch = resolveCategoryMatch(input.categories, input.kind, input.categoryHint ?? input.text);

  let entityId = entityMatch.source === "name" ? acceptedEntityId(entityMatch) : null;
  let categoryId = categoryMatch.source === "name" ? acceptedCategoryId(categoryMatch) : null;

  const exact = findExactSemanticRule(extracted.normalized, input.rules);
  const activeEntityIds = new Set(input.entities.filter((item) => item.active !== false).map((item) => item.id));
  const activeCategories = input.categories.filter((item) => item.active !== false);

  let appliedRule: QuickEntryResolution["appliedRule"] = null;
  if (exact) {
    if (!entityId && exact.entity_id && activeEntityIds.has(exact.entity_id)) {
      entityId = exact.entity_id;
      appliedRule = exact;
    }
    if (!categoryId && exact.category_id) {
      const category = activeCategories.find((item) => item.id === exact.category_id);
      if (category && category.kind === input.kind) {
        categoryId = category.id;
        appliedRule = exact;
      }
    }
  }

  if (!entityId && entityMatch.source !== "name") {
    entityId = acceptedEntityId(entityMatch);
  }
  if (!categoryId && categoryMatch.source !== "name") {
    categoryId = acceptedCategoryId(categoryMatch);
  }

  const partialRules = findPartialSemanticRules(extracted.normalized, input.rules)
    .filter((rule) => rule.id !== exact?.id);

  return {
    hint: extracted.normalized,
    originalHint: extracted.original,
    entityId,
    categoryId,
    entityMatch,
    categoryMatch,
    appliedRule,
    partialRules,
    needsEntity: !entityId,
    needsCategory: !categoryId,
  };
}

export function disambiguationTitle(needsEntity: boolean, needsCategory: boolean) {
  if (needsEntity && needsCategory) return "Preciso de uma informação";
  if (needsEntity) return "Em qual empresa devo lançar?";
  return "Qual categoria devo usar?";
}

export function disambiguationConfirmLabel(needsEntity: boolean, needsCategory: boolean) {
  if (needsEntity && needsCategory) return "Continuar";
  if (needsEntity) return "Usar esta entidade";
  return "Usar esta categoria";
}
