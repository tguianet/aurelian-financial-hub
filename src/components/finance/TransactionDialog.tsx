import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { useRefreshFinance } from "@/hooks/useFinance";
import { useEntityScope } from "./EntityContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { newIdempotencyKey } from "@/lib/idempotency";
import { rpcErrorMessage } from "@/lib/rpc-error";
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
import type { TxKind } from "@/lib/finance";
import { selectableCategories } from "@/lib/categories";
import { isoWeekday, isValidDateIso, localDateIso, parseDateOnly } from "@/lib/date";
import { parseBRLMoney } from "@/lib/money";

const todayIso = () => localDateIso();

export function TransactionDialog() {
  const { data } = useEntityScope();
  const { user } = useAuthUser();
  const { canWrite } = useFinanceAccess();
  const refresh = useRefreshFinance();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const idempotencyKeyRef = useRef(newIdempotencyKey());

  const [kind, setKind] = useState<TxKind>("expense");
  const [entityId, setEntityId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [cardId, setCardId] = useState("");
  const [method, setMethod] = useState("pix");
  const [competence, setCompetence] = useState(todayIso());
  const [due, setDue] = useState(todayIso());
  const [status, setStatus] = useState("paid");
  const [recurrence, setRecurrence] = useState("none");
  const [installments, setInstallments] = useState("1");
  const [notes, setNotes] = useState("");

  const isCreditPurchase = kind === "expense" && method === "credit";
  const accounts = data.accounts.filter((a) => !entityId || a.entity_id === entityId);
  const categories = kind === "transfer" ? [] : selectableCategories(data.categories, kind);
  const cards = useMemo(
    () => data.cards.filter((c) => c.active && (!entityId || c.entity_id === entityId)),
    [data.cards, entityId],
  );

  useEffect(() => {
    if (kind !== "expense" && method === "credit") setMethod("pix");
  }, [kind, method]);

  useEffect(() => {
    if (cardId && !cards.some((c) => c.id === cardId)) setCardId("");
  }, [cardId, cards]);

  useEffect(() => {
    if (kind === "transfer" && recurrence !== "none") setRecurrence("none");
  }, [kind, recurrence]);

  useEffect(() => {
    if (open) idempotencyKeyRef.current = newIdempotencyKey();
  }, [open]);

  const reset = () => {
    setDescription("");
    setAmount("");
    setNotes("");
    setInstallments("1");
  };

  const submit = async () => {
    const fail = (m: string) => {
      toast.error(m);
    };
    if (!user) return fail("Sessão expirada.");
    if (!canWrite) return fail("Seu acesso é somente leitura.");
    if (!entityId) return fail("Selecione a entidade financeira.");
    if (!description.trim()) return fail("Informe a descrição.");
    const value = parseBRLMoney(amount);
    if (value === null || value <= 0) return fail("Informe um valor válido.");
    if (!isValidDateIso(competence) || !isValidDateIso(due)) return fail("Informe datas válidas.");
    if (isCreditPurchase) {
      if (!cardId) return fail("Selecione o cartão.");
      if (!cards.some((c) => c.id === cardId)) return fail("Selecione um cartão ativo desta entidade.");
      const count = Math.max(1, Number(installments) || 1);
      if (count < 1 || count > 48) return fail("Parcelas devem estar entre 1 e 48.");
      setBusy(true);
      const desc = notes.trim() ? `${description.trim()} — ${notes.trim()}` : description.trim();
      const { error } = await supabase.rpc("create_credit_card_purchase", {
        _credit_card_id: cardId,
        _category_id: categoryId || undefined,
        _description: desc,
        _total_amount: value,
        _purchase_date: competence,
        _installments: count,
      } as never);
      setBusy(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Compra no cartão registrada. A despesa entra na data da compra; o pagamento da fatura não conta de novo.");
      reset();
      setCardId("");
      setOpen(false);
      refresh();
      return;
    }
    if (!accountId) return fail("Selecione a conta de origem.");
    if (kind === "transfer" && !toAccountId) return fail("Selecione a conta de destino.");
    if (kind === "transfer" && recurrence !== "none") return fail("Recorrência não se aplica a transferência.");

    if (recurrence !== "none") {
      if (!categoryId) return fail("Selecione a categoria.");
      const weekday = isoWeekday(due);
      setBusy(true);
      const { error } = await supabase.rpc("create_recurring_transaction", {
        p_entity_id: entityId,
        p_account_id: accountId,
        p_category_id: categoryId,
        p_kind: kind,
        p_description: description.trim(),
        p_amount: value,
        p_frequency: recurrence,
        p_starts_at: due,
        p_day_of_month: recurrence === "weekly" ? undefined : parseDateOnly(due).getDate(),
        p_weekday: recurrence === "weekly" ? weekday : undefined,
        p_month_of_year: recurrence === "yearly" ? parseDateOnly(due).getMonth() + 1 : undefined,
        p_payment_method: method,
        p_notes: notes.trim() || undefined,
      } as never);
      setBusy(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Recorrência criada. A ocorrência do dia entra em pendências; pagar depois não lança a despesa de novo.");
      reset();
      setRecurrence("none");
      setOpen(false);
      refresh();
      return;
    }

    const total = Math.max(1, Number(installments) || 1);
    if (!Number.isInteger(total) || total < 1 || total > 48) return fail("Parcelas devem estar entre 1 e 48.");

    setBusy(true);
    const { error } = await supabase.rpc("create_transaction", {
      p_entity_id: entityId,
      p_account_id: accountId,
      p_kind: kind,
      p_description: description.trim(),
      p_amount: value,
      p_category_id: kind === "transfer" ? undefined : categoryId || undefined,
      p_to_account_id: kind === "transfer" ? toAccountId : undefined,
      p_payment_method: kind === "transfer" ? "transfer" : method,
      p_competence_date: competence,
      p_due_date: due,
      p_status: status,
      p_notes: notes.trim() || undefined,
      p_installments: total,
      p_amount_mode: "total",
      p_shift_competence: false,
      p_source: "manual",
      p_idempotency_key: idempotencyKeyRef.current,
    } as never);
    setBusy(false);
    if (error) {
      toast.error(rpcErrorMessage(error, "Não foi possível registrar o lançamento."));
      return;
    }
    toast.success("Lançamento registrado.");
    reset();
    setOpen(false);
    refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="size-4" /> Novo lançamento
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novo lançamento</DialogTitle>
          <DialogDescription>
            Todo lançamento pertence a uma entidade financeira. Compra no crédito vira compra no
            cartão (despesa na data da compra). Pagamento da fatura é só caixa e não conta de novo
            como despesa. Transferências internas não afetam receitas e despesas.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo">
            <Select value={kind} onValueChange={(v) => setKind(v as TxKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="income">Entrada</SelectItem>
                <SelectItem value="expense">Saída</SelectItem>
                <SelectItem value="transfer">Transferência interna</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Entidade financeira">
            <Select value={entityId} onValueChange={setEntityId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {data.entities.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Descrição" className="sm:col-span-2">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Fornecedor de insumos" />
          </Field>

          <Field label="Valor (R$)">
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" />
          </Field>

          <Field label="Categoria">
            <Select value={categoryId} onValueChange={setCategoryId} disabled={kind === "transfer"}>
              <SelectTrigger><SelectValue placeholder={kind === "transfer" ? "Não se aplica" : "Selecione"} /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {isCreditPurchase ? null : (
            <Field label="Conta de origem">
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          {kind === "transfer" ? (
            <Field label="Conta de destino">
              <Select value={toAccountId} onValueChange={setToAccountId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {data.accounts
                    .filter((a) => a.id !== accountId)
                    .map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <Field label="Forma de pagamento">
              <Select value={method} onValueChange={(v) => { setMethod(v); if (v !== "credit") setCardId(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pix">Pix</SelectItem>
                  <SelectItem value="cash">Dinheiro</SelectItem>
                  <SelectItem value="debit">Débito</SelectItem>
                  {kind === "expense" ? <SelectItem value="credit">Crédito</SelectItem> : null}
                  <SelectItem value="boleto">Boleto</SelectItem>
                  <SelectItem value="transfer">Transferência</SelectItem>
                  <SelectItem value="other">Outro</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}

          {isCreditPurchase ? (
            <Field label="Cartão" className="sm:col-span-2">
              <Select value={cardId} onValueChange={setCardId}>
                <SelectTrigger><SelectValue placeholder="Cartão ativo desta entidade" /></SelectTrigger>
                <SelectContent>
                  {cards.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}{c.brand ? ` · ${c.brand}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          <Field label={isCreditPurchase ? "Data da compra" : "Competência"}>
            <Input type="date" value={competence} onChange={(e) => setCompetence(e.target.value)} />
          </Field>
          {isCreditPurchase ? null : (
            <Field label="Vencimento">
              <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </Field>
          )}

          {isCreditPurchase || recurrence !== "none" ? null : (
            <Field label="Status">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid">Liquidado</SelectItem>
                  <SelectItem value="pending">Pendente</SelectItem>
                  <SelectItem value="overdue">Vencido</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}

          {isCreditPurchase || kind === "transfer" ? null : (
            <Field label="Recorrência">
              <Select value={recurrence} onValueChange={setRecurrence}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhuma</SelectItem>
                  <SelectItem value="monthly">Mensal</SelectItem>
                  <SelectItem value="weekly">Semanal</SelectItem>
                  <SelectItem value="yearly">Anual</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}

          {isCreditPurchase || recurrence !== "none" ? null : (
            <Field label="Parcelas">
              <Input type="number" min={1} max={48} value={installments} onChange={(e) => setInstallments(e.target.value)} />
            </Field>
          )}

          <Field label="Observações" className="sm:col-span-2">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={busy || !canWrite}>
            {isCreditPurchase ? "Registrar compra no cartão" : recurrence !== "none" ? "Criar recorrência" : "Salvar lançamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
