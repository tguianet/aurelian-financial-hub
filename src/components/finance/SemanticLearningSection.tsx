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
      toast.error("Informe um termo com pelo menos 3 letras.");
      return;
    }
    if (!entityId && !categoryId) {
      toast.error("Escolha uma entidade ou uma categoria.");
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
      toast.error(rpcErrorMessage(error, "Não foi possível atualizar a regra."));
      return;
    }
    toast.success("Regra atualizada. Lançamentos antigos não mudam.");
    setEditing(null);
    refresh();
  };

  const toggle = async (rule: SemanticRule) => {
    if (!canWrite) return;
    const { error } = await supabase.rpc("toggle_finance_semantic_rule_active", { p_id: rule.id });
    if (error) {
      toast.error(rpcErrorMessage(error, "Não foi possível atualizar a regra."));
      return;
    }
    toast.success(rule.active ? "Regra desativada." : "Regra reativada.");
    refresh();
  };

  const remove = async (rule: SemanticRule) => {
    if (!canWrite) return;
    const { error } = await supabase.rpc("delete_finance_semantic_rule", { p_id: rule.id });
    if (error) {
      toast.error(rpcErrorMessage(error, "Não foi possível excluir a regra."));
      return;
    }
    toast.success("Regra excluída. O histórico de lançamentos permanece.");
    refresh();
  };

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-start gap-2">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
        <div>
          <h2 className="text-base font-semibold">Aprendizado da IA</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Regras lembradas no lançamento rápido e em documentos. Elas não alteram lançamentos antigos.
          </p>
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          Nenhuma regra aprendida ainda. No lançamento rápido, marque “Lembrar esta escolha para lançamentos parecidos”.
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
                  <p className="font-medium capitalize">{rule.original_hint || rule.normalized_hint}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-sm">
                    {rule.entity_id ? (
                      <span className="text-muted-foreground">→ {entityName(rule.entity_id) ?? "Entidade"}</span>
                    ) : null}
                    {rule.category_id ? (
                      <span className="text-muted-foreground">→ {categoryName(rule.category_id) ?? "Categoria"}</span>
                    ) : null}
                    <Badge variant={rule.active ? "outline" : "secondary"}>{rule.active ? "Ativa" : "Inativa"}</Badge>
                  </div>
                </div>
                {canWrite ? (
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(rule)} aria-label="Editar regra">
                      <Pencil className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => void toggle(rule)} aria-label={rule.active ? "Desativar" : "Reativar"}>
                      <Power className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => void remove(rule)} aria-label="Excluir regra">
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
            <DialogTitle>Editar regra da IA</DialogTitle>
            <DialogDescription>Isso só vale para lançamentos futuros.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Termo</Label>
              <Input value={hint} onChange={(event) => setHint(event.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Entidade</Label>
              <Select value={entityId || "__none"} onValueChange={(value) => setEntityId(value === "__none" ? "" : value)}>
                <SelectTrigger><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Nenhuma</SelectItem>
                  {data.entities.filter((item) => item.active).map((item) => (
                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Categoria</Label>
              <Select value={categoryId || "__none"} onValueChange={(value) => setCategoryId(value === "__none" ? "" : value)}>
                <SelectTrigger><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Nenhuma</SelectItem>
                  {data.categories.filter((item) => item.active !== false).map((item) => (
                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={() => void save()} disabled={busy || !canWrite}>{busy ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
