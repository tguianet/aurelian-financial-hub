import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createFileRouteHead } from "@/lib/head";
import { supabase } from "@/integrations/supabase/client";
import { rpcErrorMessage } from "@/lib/rpc-error";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { useRefreshFinance } from "@/hooks/useFinance";
import { useEntityScope } from "@/components/finance/EntityContext";
import { PageHeader } from "@/components/finance/PageHeader";
import { KpiCard } from "@/components/finance/KpiCard";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { brl, buildScope, pct } from "@/lib/finance";
import { parseBRLMoney } from "@/lib/money";

export const Route = createFileRoute("/_authenticated/reservas")({
  head: () => createFileRouteHead(
    "Reservas financeiras — Aurelian Finance",
    "Reservas alocadas por entidade, meta, valor atual e impacto no dinheiro livre.",
  ),
  component: Reservas,
});

function parseMoney(value: string) {
  return parseBRLMoney(value);
}

function Reservas() {
  const { data, entityId, entityName } = useEntityScope();
  const { user } = useAuthUser();
  const { canWrite } = useFinanceAccess();
  const refresh = useRefreshFinance();
  const scope = buildScope(data, entityId);
  const rows = data.reserves.filter((r) => scope.matchesEntity(r.entity_id));
  const current = rows.reduce((s, r) => s + Number(r.current_amount), 0);
  const target = rows.reduce((s, r) => s + Number(r.target_amount), 0);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ownerEntityId, setOwnerEntityId] = useState(entityId === "all" ? "" : entityId);
  const [accountId, setAccountId] = useState("");
  const [name, setName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [currentAmount, setCurrentAmount] = useState("");
  const [notes, setNotes] = useState("");

  const entityAccounts = data.accounts.filter((a) => a.entity_id === ownerEntityId && a.active);

  const createReserve = async () => {
    if (!user) { toast.error("Sessão expirada."); return; }
    if (!canWrite) { toast.error("Seu acesso é somente leitura."); return; }
    if (!ownerEntityId) { toast.error("Selecione a entidade."); return; }
    if (!name.trim()) { toast.error("Informe o nome da reserva."); return; }
    const goal = parseMoney(targetAmount || "0");
    const currentValue = parseMoney(currentAmount || "0");
    if (goal === null || currentValue === null || goal < 0 || currentValue < 0) {
      toast.error("Informe valores válidos.");
      return;
    }

    setBusy(true);
    const { error } = await supabase.rpc("create_reserve", {
      p_entity_id: ownerEntityId,
      p_name: name.trim(),
      p_target_amount: goal,
      p_current_amount: currentValue,
      p_account_id: accountId || undefined,
      p_notes: notes.trim() || undefined,
    } as never);
    setBusy(false);
    if (error) { toast.error(rpcErrorMessage(error, "Não foi possível criar a reserva.")); return; }

    setName(""); setAccountId(""); setTargetAmount(""); setCurrentAmount(""); setNotes(""); setOpen(false);
    toast.success("Reserva criada.");
    refresh();
  };

  const updateCurrent = async (id: string, value: string) => {
    if (!canWrite) { toast.error("Seu acesso é somente leitura."); return; }
    const amount = parseMoney(value);
    if (amount === null || amount < 0) { toast.error("Valor inválido."); return; }
    const { error } = await supabase.rpc("update_reserve_amount", { p_id: id, p_current_amount: amount } as never);
    if (error) { toast.error(rpcErrorMessage(error, "Não foi possível atualizar a reserva.")); return; }
    toast.success("Reserva atualizada.");
    refresh();
  };

  const removeReserve = async (id: string) => {
    if (!canWrite) { toast.error("Seu acesso é somente leitura."); return; }
    const { error } = await supabase.rpc("delete_reserve", { p_id: id } as never);
    if (error) { toast.error(rpcErrorMessage(error, "Não foi possível remover a reserva.")); return; }
    toast.success("Reserva removida.");
    refresh();
  };

  return (
    <div>
      <PageHeader
        title="Reservas financeiras"
        subtitle={`${entityName} · reservas reduzem o dinheiro livre`}
        action={
          canWrite ? (
          <Dialog open={open} onOpenChange={(next) => {
            setOpen(next);
            if (next && entityId !== "all") setOwnerEntityId(entityId);
          }}>
            <DialogTrigger asChild><Button className="gap-2"><Plus className="size-4" /> Nova reserva</Button></DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Nova reserva financeira</DialogTitle>
                <DialogDescription>Valores reservados são descontados do Dinheiro Livre, mas não alteram o saldo bancário.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Entidade</Label>
                  <Select value={ownerEntityId} onValueChange={(value) => { setOwnerEntityId(value); setAccountId(""); }}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>{data.entities.filter((e) => e.active).map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Nome</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Reserva de emergência" />
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Meta</Label>
                  <Input value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} inputMode="decimal" placeholder="0,00" />
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Reservado hoje</Label>
                  <Input value={currentAmount} onChange={(e) => setCurrentAmount(e.target.value)} inputMode="decimal" placeholder="0,00" />
                </div>
                <div className="sm:col-span-2">
                  <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Conta vinculada (opcional)</Label>
                  <Select value={accountId} onValueChange={setAccountId} disabled={!ownerEntityId}>
                    <SelectTrigger><SelectValue placeholder="Sem conta vinculada" /></SelectTrigger>
                    <SelectContent>{entityAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Observações</Label>
                  <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={createReserve} disabled={busy}>{busy ? "Criando…" : "Criar reserva"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          ) : undefined
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Reservado hoje" value={brl(current)} tone="gold" />
        <KpiCard label="Meta total" value={brl(target)} />
        <KpiCard label="Cobertura da meta" value={target > 0 ? pct(current / target) : "—"} tone={current >= target && target > 0 ? "positive" : "neutral"} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const ratio = Number(r.target_amount) > 0 ? Number(r.current_amount) / Number(r.target_amount) : 0;
          const entity = data.entities.find((e) => e.id === r.entity_id);
          const account = data.accounts.find((a) => a.id === r.account_id);
          return (
            <div key={r.id} className="panel p-5">
              <div className="flex items-start justify-between gap-2">
                <div><p className="text-sm font-medium">{r.name}</p><p className="text-[11px] text-muted-foreground">{entity?.name}{account ? ` · ${account.name}` : ""}</p></div>
                {canWrite ? <Button variant="ghost" size="icon" onClick={() => removeReserve(r.id)} title="Remover"><Trash2 className="size-4" /></Button> : null}
              </div>
              <p className="num mt-4 text-2xl font-semibold">{brl(Number(r.current_amount))}</p>
              <p className="text-[11px] text-muted-foreground">Meta {brl(Number(r.target_amount))}</p>
              <Progress value={Math.min(ratio * 100, 100)} className="mt-3 h-1.5" />
              {canWrite ? (
              <div className="mt-3 flex gap-2">
                <Input defaultValue={Number(r.current_amount).toFixed(2).replace(".", ",")} inputMode="decimal" className="h-8" id={`reserve-${r.id}`} />
                <Button size="sm" variant="outline" onClick={() => {
                  const el = document.getElementById(`reserve-${r.id}`) as HTMLInputElement | null;
                  if (el) updateCurrent(r.id, el.value);
                }}>Atualizar</Button>
              </div>
              ) : null}
              {r.notes ? <p className="mt-2 text-[11px] text-muted-foreground">{r.notes}</p> : null}
            </div>
          );
        })}
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma reserva nesta entidade.</p> : null}
      </div>
    </div>
  );
}
