import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Power } from "lucide-react";
import { toast } from "sonner";
import { createFileRouteHead } from "@/lib/head";
import { supabase } from "@/integrations/supabase/client";
import { rpcErrorMessage } from "@/lib/rpc-error";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { useRefreshFinance } from "@/hooks/useFinance";
import { useEntityScope } from "@/components/finance/EntityContext";
import { PageHeader } from "@/components/finance/PageHeader";
import { accountBalances, brl, buildScope } from "@/lib/finance";
import { parseBRLMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/contas")({
  head: () =>
    createFileRouteHead(
      "Meu dinheiro — Aurelian Finance",
      "Veja quanto você tem em bancos, caixas, carteiras digitais e investimentos.",
    ),
  component: Contas,
});

const TYPE_LABEL: Record<string, string> = {
  checking: "Conta corrente",
  savings: "Poupança",
  cash: "Dinheiro em caixa",
  wallet: "Carteira digital",
  investment: "Investimento",
};

function parseMoney(value: string) {
  return parseBRLMoney(value);
}

function Contas() {
  const { data, entityId, entityName } = useEntityScope();
  const { user } = useAuthUser();
  const { canWrite } = useFinanceAccess();
  const refresh = useRefreshFinance();
  const scope = buildScope(data, entityId);
  const balances = accountBalances(data);
  const accounts = data.accounts.filter((a) => scope.accountIds.has(a.id));
  const total = accounts.reduce((s, a) => s + (balances.get(a.id) ?? 0), 0);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ownerEntityId, setOwnerEntityId] = useState(entityId === "all" ? "" : entityId);
  const [name, setName] = useState("");
  const [type, setType] = useState("checking");
  const [bank, setBank] = useState("");
  const [openingBalance, setOpeningBalance] = useState("0,00");

  const createAccount = async () => {
    if (!user) { toast.error("Sua sessão expirou. Entre novamente."); return; }
    if (!canWrite) { toast.error("Seu acesso permite apenas visualizar."); return; }
    if (!ownerEntityId) { toast.error("Escolha de quem é essa conta."); return; }
    const cleanName = name.trim();
    if (!cleanName) { toast.error("Dê um nome para identificar essa conta."); return; }
    const balance = parseMoney(openingBalance);
    if (balance === null) { toast.error("Informe quanto há nessa conta hoje."); return; }

    setBusy(true);
    const { error } = await supabase.rpc("create_account", {
      p_entity_id: ownerEntityId,
      p_name: cleanName,
      p_type: type,
      p_bank: bank.trim(),
      p_opening_balance: balance,
    });
    setBusy(false);
    if (error) {
      toast.error(rpcErrorMessage(error, "Não consegui adicionar essa conta."));
      return;
    }

    setName("");
    setBank("");
    setOpeningBalance("0,00");
    setOpen(false);
    toast.success("Conta adicionada.");
    refresh();
  };

  const toggleActive = async (id: string, current: boolean) => {
    if (!canWrite) { toast.error("Seu acesso permite apenas visualizar."); return; }
    const { error } = await supabase.rpc("toggle_account_active", { p_id: id });
    if (error) { toast.error(rpcErrorMessage(error, "Não consegui atualizar essa conta.")); return; }
    toast.success(current ? "Conta escondida das opções novas. O histórico continua guardado." : "Conta ativada novamente.");
    refresh();
  };

  return (
    <div>
      <PageHeader
        title="Meu dinheiro"
        subtitle={`${entityName} · você tem ${brl(total)} nessas contas`}
        action={
          canWrite ? (
          <Dialog open={open} onOpenChange={(next) => {
            setOpen(next);
            if (next && entityId !== "all") setOwnerEntityId(entityId);
          }}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="size-4" /> Adicionar conta</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Adicionar onde seu dinheiro fica</DialogTitle>
                <DialogDescription>
                  Pode ser banco, dinheiro em caixa, carteira digital ou investimento. Informe quanto existe lá agora para o Aurelian começar do valor certo.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div>
                  <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">De quem é essa conta?</Label>
                  <Select value={ownerEntityId} onValueChange={setOwnerEntityId}>
                    <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
                    <SelectContent>
                      {data.entities.filter((e) => e.active).map((e) => (
                        <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">Como você chama essa conta?</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Inter PJ, Caixa do restaurante" />
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">Que tipo de dinheiro é?</Label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="checking">Conta corrente</SelectItem>
                      <SelectItem value="savings">Poupança</SelectItem>
                      <SelectItem value="cash">Dinheiro em caixa</SelectItem>
                      <SelectItem value="wallet">Carteira digital</SelectItem>
                      <SelectItem value="investment">Investimento</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">Banco ou instituição</Label>
                  <Input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Ex.: Inter, Nubank, Caixa" />
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">Quanto tem lá agora?</Label>
                  <Input value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} inputMode="decimal" placeholder="0,00" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={createAccount} disabled={busy}>{busy ? "Adicionando…" : "Adicionar conta"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {accounts.map((a) => {
          const entity = data.entities.find((e) => e.id === a.entity_id);
          const balance = balances.get(a.id) ?? 0;
          return (
            <div key={a.id} className={`panel p-5 ${!a.active ? "opacity-55" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{a.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {TYPE_LABEL[a.type] ?? a.type}
                    {a.bank ? ` · ${a.bank}` : ""}
                  </p>
                </div>
                {canWrite ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px]"
                  onClick={() => toggleActive(a.id, a.active)}
                >
                  <Power className="size-3" /> {a.active ? "Em uso" : "Desativada"}
                </Button>
                ) : (
                  <span className="text-[11px] text-muted-foreground">{a.active ? "Em uso" : "Desativada"}</span>
                )}
              </div>
              <p className={`num mt-4 text-2xl font-semibold ${balance >= 0 ? "text-foreground" : "text-destructive"}`}>
                {brl(balance)}
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {entity?.name} · começou no Aurelian com {brl(Number(a.opening_balance))}
              </p>
            </div>
          );
        })}
        {accounts.length === 0 ? (
          <div className="panel p-5 text-sm text-muted-foreground">Nenhuma conta aqui ainda. Adicione onde esse dinheiro fica para começar.</div>
        ) : null}
      </div>
    </div>
  );
}
