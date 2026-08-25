import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { rpcErrorMessage } from "@/lib/rpc-error";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { useRefreshFinance } from "@/hooks/useFinance";
import { useEntityScope } from "./EntityContext";
import { selectableCategories } from "@/lib/categories";
import { isValidDateIso, localDateIso } from "@/lib/date";
import { parseBRLMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function parseMoney(value: string) {
  return parseBRLMoney(value);
}

const todayIso = () => localDateIso();

export function CreditCardActions() {
  const { canWrite } = useFinanceAccess();
  if (!canWrite) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <NewCardDialog />
      <NewPurchaseDialog />
    </div>
  );
}

function NewCardDialog() {
  const { data, entityId } = useEntityScope();
  const { user } = useAuthUser();
  const refresh = useRefreshFinance();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ownerEntityId, setOwnerEntityId] = useState(entityId === "all" ? "" : entityId);
  const [accountId, setAccountId] = useState("");
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [limit, setLimit] = useState("0,00");
  const [closingDay, setClosingDay] = useState("25");
  const [dueDay, setDueDay] = useState("5");

  const accounts = data.accounts.filter((a) => a.entity_id === ownerEntityId && a.active);

  const submit = async () => {
    if (!user) { toast.error("Sessão expirada."); return; }
    if (!ownerEntityId) { toast.error("Selecione a entidade."); return; }
    if (!name.trim()) { toast.error("Informe o nome do cartão."); return; }
    const creditLimit = parseMoney(limit);
    const close = Number(closingDay);
    const due = Number(dueDay);
    if (creditLimit === null || creditLimit < 0) { toast.error("Limite inválido."); return; }
    if (!Number.isInteger(close) || close < 1 || close > 31) { toast.error("Dia de fechamento inválido."); return; }
    if (!Number.isInteger(due) || due < 1 || due > 31) { toast.error("Dia de vencimento inválido."); return; }

    setBusy(true);
    const { error } = await supabase.rpc("create_credit_card", {
      p_entity_id: ownerEntityId,
      p_name: name.trim(),
      p_credit_limit: creditLimit,
      p_closing_day: close,
      p_due_day: due,
      p_account_id: accountId || undefined,
      p_brand: brand.trim() || undefined,
    } as never);
    setBusy(false);
    if (error) {
      toast.error(rpcErrorMessage(error, "Não foi possível criar o cartão."));
      return;
    }

    setOpen(false);
    setName("");
    setBrand("");
    setLimit("0,00");
    toast.success("Cartão criado.");
    refresh();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => {
      setOpen(next);
      if (next && entityId !== "all") setOwnerEntityId(entityId);
    }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2"><Plus className="size-4" /> Novo cartão</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo cartão</DialogTitle>
          <DialogDescription>Cadastre limite, fechamento e vencimento para projetar as faturas.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <Field label="Entidade">
            <Select value={ownerEntityId} onValueChange={(value) => { setOwnerEntityId(value); setAccountId(""); }}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{data.entities.filter((e) => e.active).map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Conta de pagamento">
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
              <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Nubank Pessoal" /></Field>
          <Field label="Bandeira"><Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Ex.: Mastercard" /></Field>
          <Field label="Limite"><Input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fecha dia"><Input type="number" min={1} max={31} value={closingDay} onChange={(e) => setClosingDay(e.target.value)} /></Field>
            <Field label="Vence dia"><Input type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)} /></Field>
          </div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={submit} disabled={busy}>{busy ? "Criando…" : "Criar cartão"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NewPurchaseDialog({
  defaultCardId,
  children,
}: {
  defaultCardId?: string;
  children?: ReactNode;
}) {
  const { data, entityId } = useEntityScope();
  const { canWrite } = useFinanceAccess();
  const refresh = useRefreshFinance();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cardId, setCardId] = useState(defaultCardId ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayIso());
  const [installments, setInstallments] = useState("1");

  const cards = useMemo(
    () => data.cards.filter((c) => c.active && (entityId === "all" || c.entity_id === entityId)),
    [data.cards, entityId],
  );
  const categories = selectableCategories(data.categories, "expense");

  useEffect(() => {
    if (open && defaultCardId) setCardId(defaultCardId);
  }, [open, defaultCardId]);

  const submit = async () => {
    if (!canWrite) { toast.error("Seu acesso é somente leitura."); return; }
    if (!cardId) { toast.error("Selecione o cartão."); return; }
    if (!description.trim()) { toast.error("Informe a descrição."); return; }
    const total = parseMoney(amount);
    const count = Number(installments);
    if (total === null || total <= 0) { toast.error("Valor inválido."); return; }
    if (!Number.isInteger(count) || count < 1 || count > 48) { toast.error("Parcelas devem estar entre 1 e 48."); return; }
    if (!isValidDateIso(purchaseDate)) { toast.error("Informe a data da compra."); return; }

    setBusy(true);
    const { error } = await supabase.rpc("create_credit_card_purchase", {
      _credit_card_id: cardId,
      _category_id: categoryId || undefined,
      _description: description.trim(),
      _total_amount: total,
      _purchase_date: purchaseDate,
      _installments: count,
    } as never);
    setBusy(false);

    if (error) { toast.error(error.message); return; }

    setOpen(false);
    setDescription("");
    setAmount("");
    setInstallments("1");
    toast.success("Compra lançada. A despesa entra na data da compra; pagar a fatura não conta de novo.");
    refresh();
  };

  if (!canWrite) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? <Button className="gap-2"><Plus className="size-4" /> Nova compra</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova compra no cartão</DialogTitle>
          <DialogDescription>
            Despesa econômica na data da compra. Parcelas entram na projeção até serem pagas. O pagamento da fatura só move caixa.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <Field label="Cartão">
            <Select value={cardId} onValueChange={setCardId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{cards.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Descrição"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Notebook" /></Field>
          <Field label="Categoria">
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
              <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Valor total"><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Data"><Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></Field>
            <Field label="Parcelas"><Input type="number" min={1} max={48} value={installments} onChange={(e) => setInstallments(e.target.value)} /></Field>
          </div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={submit} disabled={busy || cards.length === 0}>{busy ? "Salvando…" : "Registrar compra"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>{children}</div>;
}
