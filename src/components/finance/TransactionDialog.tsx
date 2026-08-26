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
    const fail = (m: string) => toast.error(m);
    if (!user) return fail("Sua sessão expirou. Entre novamente.");
    if (!canWrite) return fail("Seu acesso permite apenas visualizar.");
    if (!entityId) return fail("Escolha de quem é essa movimentação.");
    if (!description.trim()) return fail("Diga o que aconteceu.");
    const value = parseBRLMoney(amount);
    if (value === null || value <= 0) return fail("Informe um valor válido.");
    if (!isValidDateIso(competence) || !isValidDateIso(due)) return fail("Confira as datas.");

    if (isCreditPurchase) {
      if (!cardId) return fail("Escolha o cartão usado.");
      if (!cards.some((c) => c.id === cardId)) return fail("Escolha um cartão ativo dessa pessoa ou empresa.");
      const count = Math.max(1, Number(installments) || 1);
      if (count < 1 || count > 48) return fail("Escolha entre 1 e 48 parcelas.");
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
      toast.success("Compra registrada. Quando você pagar a fatura, o Aurelian não vai contar essa despesa novamente.");
      reset();
      setCardId("");
      setOpen(false);
      refresh();
      return;
    }

    if (!accountId) return fail("Escolha de qual conta o dinheiro saiu ou entrou.");
    if (kind === "transfer" && !toAccountId) return fail("Escolha para qual conta o dinheiro foi.");
    if (kind === "transfer" && recurrence !== "none") return fail("Transferências entre suas contas não podem ser recorrentes aqui.");

    if (recurrence !== "none") {
      if (!categoryId) return fail("Escolha uma categoria.");
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
      toast.success("Pronto. O Aurelian vai lembrar desse compromisso e mostrar quando estiver perto de pagar ou receber.");
      reset();
      setRecurrence("none");
      setOpen(false);
      refresh();
      return;
    }

    const total = Math.max(1, Number(installments) || 1);
    if (!Number.isInteger(total) || total < 1 || total > 48) return fail("Escolha entre 1 e 48 parcelas.");

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
      toast.error(rpcErrorMessage(error, "Não consegui salvar essa movimentação."));
      return;
    }
    toast.success("Movimentação salva.");
    reset();
    setOpen(false);
    refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="size-4" /> Registrar manualmente
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Registrar movimentação</DialogTitle>
          <DialogDescription>
            Preencha só o que aconteceu. O Aurelian cuida das regras por trás para não duplicar despesas nem transferências entre suas próprias contas.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="O que aconteceu?">
            <Select value={kind} onValueChange={(v) => setKind(v as TxKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="income">Dinheiro entrou</SelectItem>
                <SelectItem value="expense">Dinheiro saiu</SelectItem>
                <SelectItem value="transfer">Mudei dinheiro entre minhas contas</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="De quem é essa movimentação?">
            <Select value={entityId} onValueChange={setEntityId}>
              <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
              <SelectContent>
                {data.entities.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="O que foi?" className="sm:col-span-2">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: compra de carne, conta de energia, comissão recebida" />
          </Field>

          <Field label="Quanto?">
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" />
          </Field>

          <Field label="Onde isso se encaixa?">
            <Select value={categoryId} onValueChange={setCategoryId} disabled={kind === "transfer"}>
              <SelectTrigger><SelectValue placeholder={kind === "transfer" ? "Não precisa" : "Escolha a categoria"} /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {isCreditPurchase ? null : (
            <Field label={kind === "income" ? "Em qual conta entrou?" : kind === "transfer" ? "De qual conta saiu?" : "De qual conta saiu?"}>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          {kind === "transfer" ? (
            <Field label="Para qual conta foi?">
              <Select value={toAccountId} onValueChange={setToAccountId}>
                <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
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
            <Field label={kind === "income" ? "Como recebeu?" : "Como pagou?"}>
              <Select value={method} onValueChange={(v) => { setMethod(v); if (v !== "credit") setCardId(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pix">Pix</SelectItem>
                  <SelectItem value="cash">Dinheiro</SelectItem>
                  <SelectItem value="debit">Débito</SelectItem>
                  {kind === "expense" ? <SelectItem value="credit">Cartão de crédito</SelectItem> : null}
                  <SelectItem value="boleto">Boleto</SelectItem>
                  <SelectItem value="transfer">Transferência</SelectItem>
                  <SelectItem value="other">Outro</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}

          {isCreditPurchase ? (
            <Field label="Qual cartão?" className="sm:col-span-2">
              <Select value={cardId} onValueChange={setCardId}>
                <SelectTrigger><SelectValue placeholder="Escolha o cartão" /></SelectTrigger>
                <SelectContent>
                  {cards.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}{c.brand ? ` · ${c.brand}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          <Field label={isCreditPurchase ? "Quando comprou?" : "Quando aconteceu?"}>
            <Input type="date" value={competence} onChange={(e) => setCompetence(e.target.value)} />
          </Field>
          {isCreditPurchase ? null : (
            <Field label="Quando vence?">
              <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </Field>
          )}

          {isCreditPurchase || recurrence !== "none" ? null : (
            <Field label={kind === "income" ? "Já recebeu?" : kind === "expense" ? "Já pagou?" : "Situação"}>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid">Sim, já aconteceu</SelectItem>
                  <SelectItem value="pending">Ainda não</SelectItem>
                  <SelectItem value="overdue">Está atrasado</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}

          {isCreditPurchase || kind === "transfer" ? null : (
            <Field label="Isso se repete?">
              <Select value={recurrence} onValueChange={setRecurrence}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Não</SelectItem>
                  <SelectItem value="monthly">Todo mês</SelectItem>
                  <SelectItem value="weekly">Toda semana</SelectItem>
                  <SelectItem value="yearly">Todo ano</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}

          {isCreditPurchase || recurrence !== "none" ? null : (
            <Field label="Foi parcelado? Quantas vezes?">
              <Input type="number" min={1} max={48} value={installments} onChange={(e) => setInstallments(e.target.value)} />
            </Field>
          )}

          <Field label="Quer deixar alguma observação?" className="sm:col-span-2">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={busy || !canWrite}>
            {isCreditPurchase ? "Salvar compra" : recurrence !== "none" ? "Salvar compromisso" : "Salvar movimentação"}
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
      <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
