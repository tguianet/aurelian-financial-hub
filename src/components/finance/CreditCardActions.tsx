import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useRefreshFinance } from "@/hooks/useFinance";
import { useEntityScope } from "./EntityContext";
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
  return Number(value.replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export function CreditCardActions() {
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
    if (!user) return toast.error("Sessão expirada.");
    if (!ownerEntityId) return toast.error("Selecione a entidade.");
    if (!name.trim()) return toast.error("Informe o nome do cartão.");
    const creditLimit = parseMoney(limit);
    const close = Number(closingDay);
    const due = Number(dueDay);
    if (!Number.isFinite(creditLimit) || creditLimit < 0) return toast.error("Limite inválido.");
    if (!Number.isInteger(close) || close < 1 || close > 31) return toast.error("Dia de fechamento inválido.");
    if (!Number.isInteger(due) || due < 1 || due > 31) return toast.error("Dia de vencimento inválido.");

    setBusy(true);
    const { data: created, error } = await supabase
      .from("credit_cards")
      .insert({
        user_id: user.id,
        is_demo: false,
        entity_id: ownerEntityId,
        account_id: accountId || null,
        name: name.trim(),
        brand: brand.trim() || null,
        credit_limit: creditLimit,
        closing_day: close,
        due_day: due,
        active: true,
      })
      .select("id")
      .single();

    if (error || !created) {
      setBusy(false);
      return toast.error(error?.message ?? "Não foi possível criar o cartão.");
    }

    await supabase.from("audit_log").insert({
      user_id: user.id,
      table_name: "credit_cards",
      record_id: created.id,
      action: "insert",
      details: { name: name.trim(), entity_id: ownerEntityId, credit_limit: creditLimit },
    });

    setBusy(false);
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

function NewPurchaseDialog() {
  const { data, entityId } = useEntityScope();
  const refresh = useRefreshFinance();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cardId, setCardId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayIso());
  const [installments, setInstallments] = useState("1");

  const cards = useMemo(
    () => data.cards.filter((c) => c.active && (entityId === "all" || c.entity_id === entityId)),
    [data.cards, entityId],
  );
  const categories = data.categories.filter((c) => c.kind === "expense");

  const submit = async () => {
    if (!cardId) return toast.error("Selecione o cartão.");
    if (!description.trim()) return toast.error("Informe a descrição.");
    const total = parseMoney(amount);
    const count = Number(installments);
    if (!Number.isFinite(total) || total <= 0) return toast.error("Valor inválido.");
    if (!Number.isInteger(count) || count < 1 || count > 48) return toast.error("Parcelas devem estar entre 1 e 48.");

    setBusy(true);
    const { error } = await (supabase as any).rpc("create_credit_card_purchase", {
      _credit_card_id: cardId,
      _category_id: categoryId || null,
      _description: description.trim(),
      _total_amount: total,
      _purchase_date: purchaseDate,
      _installments: count,
    });
    setBusy(false);

    if (error) return toast.error(error.message);

    setOpen(false);
    setDescription("");
    setAmount("");
    setInstallments("1");
    toast.success("Compra lançada com todas as parcelas.");
    refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="size-4" /> Nova compra</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova compra no cartão</DialogTitle>
          <DialogDescription>As parcelas são geradas automaticamente conforme fechamento e vencimento.</DialogDescription>
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
