import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createFileRouteHead } from "@/lib/head";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useRefreshFinance } from "@/hooks/useFinance";
import { useEntityScope } from "@/components/finance/EntityContext";
import { PageHeader } from "@/components/finance/PageHeader";
import { Td, Th } from "./lancamentos";
import { KpiCard } from "@/components/finance/KpiCard";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { brl, budgetRows, monthLabel, pct, today } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/orcamento")({
  head: () => createFileRouteHead(
    "Orçamento mensal — Aurelian Finance",
    "Orçado, realizado, diferença e percentual utilizado por categoria e entidade.",
  ),
  component: Orcamento,
});

function parseMoney(value: string) {
  return Number(value.replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
}

function Orcamento() {
  const { data, entityId, entityName } = useEntityScope();
  const { user } = useAuthUser();
  const refresh = useRefreshFinance();
  const ref = today();
  const rows = budgetRows(data, entityId, ref);
  const planned = rows.reduce((s, r) => s + r.planned, 0);
  const actual = rows.reduce((s, r) => s + r.actual, 0);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ownerEntityId, setOwnerEntityId] = useState(entityId === "all" ? "" : entityId);
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");

  const expenseCategories = useMemo(() => data.categories.filter((c) => c.kind === "expense"), [data.categories]);
  const month = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}-01`;

  const saveBudget = async () => {
    if (!user) return toast.error("Sessão expirada.");
    if (!ownerEntityId) return toast.error("Selecione a entidade.");
    if (!categoryId) return toast.error("Selecione a categoria.");
    const value = parseMoney(amount);
    if (!Number.isFinite(value) || value < 0) return toast.error("Informe um valor válido.");

    setBusy(true);
    const existing = data.budgets.find(
      (b) => b.entity_id === ownerEntityId && b.category_id === categoryId && b.month.slice(0, 7) === month.slice(0, 7),
    );
    const query = existing
      ? supabase.from("budgets").update({ planned_amount: value }).eq("id", existing.id)
      : supabase.from("budgets").insert({
          user_id: user.id,
          is_demo: false,
          entity_id: ownerEntityId,
          category_id: categoryId,
          month,
          planned_amount: value,
        });
    const { error } = await query;
    setBusy(false);
    if (error) return toast.error(error.message);

    await supabase.from("audit_log").insert({
      user_id: user.id,
      table_name: "budgets",
      record_id: existing?.id ?? null,
      action: existing ? "update" : "insert",
      details: { entity_id: ownerEntityId, category_id: categoryId, month, planned_amount: value },
    });

    setAmount("");
    setCategoryId("");
    setOpen(false);
    toast.success(existing ? "Orçamento atualizado." : "Orçamento criado.");
    refresh();
  };

  const removeBudget = async (id: string) => {
    if (!user) return;
    const { error } = await supabase.from("budgets").delete().eq("id", id).eq("user_id", user.id).eq("is_demo", false);
    if (error) return toast.error(error.message);
    await supabase.from("audit_log").insert({ user_id: user.id, table_name: "budgets", record_id: id, action: "delete" });
    toast.success("Orçamento removido.");
    refresh();
  };

  return (
    <div>
      <PageHeader
        title="Orçamento mensal"
        subtitle={`${entityName} · ${monthLabel(ref)}`}
        action={
          <Dialog open={open} onOpenChange={(next) => {
            setOpen(next);
            if (next && entityId !== "all") setOwnerEntityId(entityId);
          }}>
            <DialogTrigger asChild><Button className="gap-2"><Plus className="size-4" /> Definir orçamento</Button></DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Orçamento do mês</DialogTitle>
                <DialogDescription>Defina quanto pretende gastar por categoria. Se já existir, o valor será atualizado.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div>
                  <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Entidade</Label>
                  <Select value={ownerEntityId} onValueChange={setOwnerEntityId}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>{data.entities.filter((e) => e.active).map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Categoria</Label>
                  <Select value={categoryId} onValueChange={setCategoryId}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>{expenseCategories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Valor planejado</Label>
                  <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={saveBudget} disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Orçado" value={brl(planned)} tone="gold" />
        <KpiCard label="Realizado" value={brl(actual)} tone="negative" />
        <KpiCard label="Disponível no orçamento" value={brl(planned - actual)} tone={planned - actual >= 0 ? "positive" : "negative"} hint={planned > 0 ? `${pct(actual / planned)} utilizado` : "Sem orçamento"} />
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <Th>Categoria</Th><Th>Entidade</Th><Th className="text-right">Orçado</Th><Th className="text-right">Realizado</Th><Th className="text-right">Diferença</Th><Th className="w-56">Utilização</Th><Th />
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-surface">
                <Td><span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ backgroundColor: r.color }} />{r.categoryName}</span></Td>
                <Td className="text-muted-foreground">{r.entityName}</Td>
                <Td className="num text-right">{brl(r.planned)}</Td>
                <Td className="num text-right">{brl(r.actual)}</Td>
                <Td className={`num text-right font-medium ${r.diff >= 0 ? "text-success" : "text-destructive"}`}>{brl(r.diff)}</Td>
                <Td><div className="flex items-center gap-2"><Progress value={Math.min(r.usage * 100, 100)} className="h-1.5" /><span className={`num w-14 text-right text-[11px] ${r.usage > 1 ? "text-destructive" : "text-muted-foreground"}`}>{pct(r.usage)}</span></div></Td>
                <Td className="text-right"><Button variant="ghost" size="icon" onClick={() => removeBudget(r.id)} title="Remover"><Trash2 className="size-4" /></Button></Td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={7} className="p-8 text-center text-sm text-muted-foreground">Nenhum orçamento definido para este mês.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
