import { useMemo, useState } from "react";
import { Pencil, Power, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { rpcErrorMessage } from "@/lib/rpc-error";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { useRefreshFinance } from "@/hooks/useFinance";
import { useEntityScope } from "@/components/finance/EntityContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { extractSemanticHint } from "@/lib/semantic-rules";
import type { SemanticRule } from "@/lib/finance";

export function SemanticLearningSection() {
  const { data } = useEntityScope();
  const { canWrite } = useFinanceAccess();
  const refresh = useRefreshFinance();
  const [editing, setEditing] = useState<SemanticRule | null>(null);
  const [hint, setHint] = useState("");
  const [entityId, setEntityId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [busy, setBusy] = useState(false);

  const rules = useMemo(
    () => [...(data.semanticRules ?? [])].sort((a, b) => a.normalized_hint.localeCompare(b.normalized_hint, "pt-BR")),
    [data.semanticRules],
  );

  const entityName = (id: string | null) => data.entities.find((item) => item.id === id)?.name ?? null;
  const categoryName = (id: string | null) => data.categories.find((item) => item.id === id)?.name ?? null;

  const openEdit = (rule: SemanticRule) => {
    setEditing(rule);
    setHint(rule.original_hint || rule.normalized_hint);
    setEntityId(rule.entity_id ?? "");
    setCategoryId(rule.category_id ?? "");
  };

  const save = async () => {
    if (!editing || !canWrite) return;
    const extracted = extractSemanticHint(hint);
    if (extracted.normalized.length < 3) {
      toast.error("Informe uma palavra ou expressão reconhecível.");
      return;
    }
    if (!entityId && !categoryId) {
      toast.error("Escolha pelo menos de quem é ou como deve ser organizado.");
      return;
    }
    setBusy(true);
    const args: {
      p_id: string;
      p_normalized_hint: string;
      p_original_hint: string;
      p_entity_id?: string;
      p_category_id?: string;
    } = {
      p_id: editing.id,
      p_normalized_hint: extracted.normalized,
      p_original_hint: extracted.original,
    };
    if (entityId) args.p_entity_id = entityId;
    if (categoryId) args.p_category_id = categoryId;
    const { error } = await supabase.rpc("update_finance_semantic_rule", args);
    setBusy(false);
    if (error) {
      toast.error(rpcErrorMessage(error, "Não consegui atualizar essa memória."));
      return;
    }
    toast.success("Aprendizado atualizado. Isso vale daqui para frente.");
    setEditing(null);
    refresh();
  };

  const toggle = async (rule: SemanticRule) => {
    if (!canWrite) return;
    const { error } = await supabase.rpc("toggle_finance_semantic_rule_active", { p_id: rule.id });
    if (error) {
      toast.error(rpcErrorMessage(error, "Não consegui atualizar esse aprendizado."));
      return;
    }
    toast.success(rule.active ? "O Aurelian vai parar de usar esse aprendizado." : "O Aurelian voltou a usar esse aprendizado.");
    refresh();
  };

  const remove = async (rule: SemanticRule) => {
    if (!canWrite) return;
    const { error } = await supabase.rpc("delete_finance_semantic_rule", { p_id: rule.id });
    if (error) {
      toast.error(rpcErrorMessage(error, "Não consegui esquecer esse aprendizado."));
      return;
    }
    toast.success("Aprendizado esquecido. Seus lançamentos antigos continuam iguais.");
    refresh();
  };

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-start gap-2">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
        <div>
          <h2 className="text-base font-semibold">O que o Aurelian aprendeu</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Aqui ficam associações que ajudam o sistema a preencher sozinho movimentações parecidas no futuro.
          </p>
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          O Aurelian ainda não aprendeu nenhum hábito. Quando ele pedir uma confirmação no lançamento rápido, você pode permitir que ele lembre da escolha.
        </div>
      ) : (
        <div className="grid gap-3">
          {rules.map((rule) => (
            <article
              key={rule.id}
              className={`rounded-2xl border border-primary/15 bg-card p-4 ${rule.active ? "" : "opacity-60"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Quando aparecer algo como</p>
                  <p className="mt-1 font-medium capitalize">“{rule.original_hint || rule.normalized_hint}”</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-sm">
                    {rule.entity_id ? (
                      <span className="text-muted-foreground">→ usar {entityName(rule.entity_id) ?? "essa área"}</span>
                    ) : null}
                    {rule.category_id ? (
                      <span className="text-muted-foreground">→ organizar em {categoryName(rule.category_id) ?? "essa categoria"}</span>
                    ) : null}
                    <Badge variant={rule.active ? "outline" : "secondary"}>{rule.active ? "Aprendizado ativo" : "Pausado"}</Badge>
                  </div>
                </div>
                {canWrite ? (
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(rule)} aria-label="Corrigir aprendizado">
                      <Pencil className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => void toggle(rule)} aria-label={rule.active ? "Pausar aprendizado" : "Reativar aprendizado"}>
                      <Power className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => void remove(rule)} aria-label="Fazer o Aurelian esquecer">
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Corrigir o que o Aurelian aprendeu</DialogTitle>
            <DialogDescription>Essa correção vale apenas para movimentações futuras.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">Quando aparecer</Label>
              <Input value={hint} onChange={(event) => setHint(event.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">De quem normalmente é?</Label>
              <Select value={entityId || "__none"} onValueChange={(value) => setEntityId(value === "__none" ? "" : value)}>
                <SelectTrigger><SelectValue placeholder="Não escolher sozinho" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Não escolher sozinho</SelectItem>
                  {data.entities.filter((item) => item.active).map((item) => (
                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">Como normalmente deve organizar?</Label>
              <Select value={categoryId || "__none"} onValueChange={(value) => setCategoryId(value === "__none" ? "" : value)}>
                <SelectTrigger><SelectValue placeholder="Não escolher sozinho" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Não escolher sozinho</SelectItem>
                  {data.categories.filter((item) => item.active !== false).map((item) => (
                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={() => void save()} disabled={busy || !canWrite}>{busy ? "Salvando…" : "Salvar aprendizado"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
