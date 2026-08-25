import type { Category } from "@/lib/finance";

export const FALLBACK_CATEGORY_NAME = {
  income: "Outras receitas",
  expense: "Outras despesas",
} as const;

export function normalizeCategoryName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function isCategoryActive(category: Pick<Category, "active">): boolean {
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

const CATEGORY_ALIASES: Record<string, string[]> = {
  veiculo: ["moto", "motocicleta", "carro", "van", "saveiro", "caminhao"],
  manutencao: ["conserto", "reparo", "oficina"],
  combustivel: ["gasolina", "etanol", "alcool", "posto"],
  alimentacao: ["comida", "almoco", "janta", "mercado", "restaurante"],
  "energia eletrica": ["conta de luz", "luz", "energia"],
  comissoes: ["comissao", "comparta"],
  vendas: ["vendi", "venda", "faturei"],
  "outras despesas": ["despesa", "gasto"],
  "outras receitas": ["receita", "entrada"],
};

export function resolveCategoryId(
  categories: Array<Pick<Category, "id" | "name" | "kind" | "active">>,
  kind: "income" | "expense",
  suggestedId?: string | null,
  hintText?: string | null,
): string | null {
  const pool = categories.filter((category) => category.kind === kind && isCategoryActive(category));
  const allowed = new Set(pool.map((category) => category.id));

  if (suggestedId && allowed.has(suggestedId)) return suggestedId;

  const hint = hintText ? normalizeCategoryName(hintText) : "";
  if (hint) {
    const byName = pool.find((category) => {
      const normalized = normalizeCategoryName(category.name);
      return hint === normalized || hint.includes(normalized);
    });
    if (byName) return byName.id;

    const byAlias = pool.find((category) => {
      const key = normalizeCategoryName(category.name);
      const aliases = CATEGORY_ALIASES[key] ?? [];
      return aliases.some((alias) => hint.includes(alias));
    });
    if (byAlias) return byAlias.id;
  }

  const fallbackName = normalizeCategoryName(FALLBACK_CATEGORY_NAME[kind]);
  return pool.find((category) => normalizeCategoryName(category.name) === fallbackName)?.id ?? null;
}
