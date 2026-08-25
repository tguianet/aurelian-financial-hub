import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { brl, type Category, type FinancialEntity, type TxKind } from "@/lib/finance";
import { disambiguationConfirmLabel, disambiguationTitle } from "@/lib/semantic-rules";

type Props = {
  open: boolean;
  amount: number;
  kind: Exclude<TxKind, "transfer">;
  hint: string;
  categoryName?: string | null;
  needsEntity: boolean;
  needsCategory: boolean;
  entities: FinancialEntity[];
  categories: Category[];
  suggestedEntityId?: string | null;
  suggestedCategoryId?: string | null;
  canRemember: boolean;
  onCancel: () => void;
  onComplete: (choice: { entityId: string | null; categoryId: string | null; remember: boolean }) => void;
};

export function DisambiguationDialog({
  open,
  amount,
  kind,
  hint,
  categoryName,
  needsEntity,
  needsCategory,
  entities,
  categories,
  suggestedEntityId,
  suggestedCategoryId,
  canRemember,
  onCancel,
  onComplete,
}: Props) {
  const [entityId, setEntityId] = useState(suggestedEntityId ?? "");
  const [categoryId, setCategoryId] = useState(suggestedCategoryId ?? "");
  const [remember, setRemember] = useState(false);

  const activeEntities = useMemo(() => entities.filter((item) => item.active), [entities]);
  const activeCategories = useMemo(() => categories.filter((item) => item.active !== false), [categories]);
  const selectedCategory = activeCategories.find((item) => item.id === categoryId);
  const canSubmit =
    (!needsEntity || Boolean(entityId))
    && (!needsCategory || Boolean(categoryId));

  const summaryCategory = needsCategory
    ? (selectedCategory?.name ?? "Categoria a definir")
    : (categoryName || selectedCategory?.name || "Categoria a definir");

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="max-w-[min(100%,24rem)] rounded-2xl border-primary/25 bg-card p-5 sm:rounded-2xl">
        <DialogHeader>
          <DialogTitle>{disambiguationTitle(needsEntity, needsCategory)}</DialogTitle>
          <DialogDescription className="text-xs">
            A IA não escolheu sozinha. Isso só completa a interpretação — nada é lançado ainda.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
          <p className="font-semibold text-foreground">{brl(amount)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[hint || "Sem fornecedor", kind === "income" ? "Entrada" : "Saída", summaryCategory].join(" · ")}
          </p>
        </div>

        {needsEntity && needsCategory ? (
          <div className="grid gap-3">
            <div>
              <p className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">Entidade</p>
              <Select value={entityId} onValueChange={setEntityId}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Selecione a empresa" /></SelectTrigger>
                <SelectContent>
                  {activeEntities.map((item) => (
                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">Categoria</p>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Selecione a categoria" /></SelectTrigger>
                <SelectContent>
                  {activeCategories.map((item) => (
                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : needsEntity ? (
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {activeEntities.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setEntityId(item.id)}
                className={`min-h-11 w-full rounded-xl border px-4 text-left text-sm transition-colors ${
                  entityId === item.id
                    ? "border-primary bg-primary/15 text-foreground"
                    : "border-border bg-background/70 text-foreground hover:border-primary/40"
                }`}
              >
                {item.name}
              </button>
            ))}
          </div>
        ) : (
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {activeCategories.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setCategoryId(item.id)}
                className={`min-h-11 w-full rounded-xl border px-4 text-left text-sm transition-colors ${
                  categoryId === item.id
                    ? "border-primary bg-primary/15 text-foreground"
                    : "border-border bg-background/70 text-foreground hover:border-primary/40"
                }`}
              >
                {item.name}
              </button>
            ))}
          </div>
        )}

        {canRemember ? (
          <label className="flex min-h-11 items-start gap-3 rounded-xl border border-border bg-background/60 px-3 py-2 text-sm">
            <Checkbox
              className="mt-0.5 size-5"
              checked={remember}
              onCheckedChange={(value) => setRemember(value === true)}
            />
            <span>Lembrar esta escolha para lançamentos parecidos</span>
          </label>
        ) : null}

        <DialogFooter className="gap-2 sm:justify-stretch">
          <Button variant="ghost" className="h-11" onClick={onCancel}>Cancelar</Button>
          <Button
            className="h-11"
            disabled={!canSubmit}
            onClick={() => onComplete({
              entityId: entityId || null,
              categoryId: categoryId || null,
              remember: canRemember && remember,
            })}
          >
            {disambiguationConfirmLabel(needsEntity, needsCategory)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
