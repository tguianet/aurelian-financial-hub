import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useRefreshFinance } from "@/hooks/useFinance";
import { useEntityScope } from "./EntityContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

const todayIso = () => new Date().toISOString().slice(0, 10);

export function TransactionDialog() {
  const { data } = useEntityScope();
  const { user } = useAuthUser();
  const refresh = useRefreshFinance();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [kind, setKind] = useState<TxKind>("expense");
  const [entityId, setEntityId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [method, setMethod] = useState("pix");
  const [competence, setCompetence] = useState(todayIso());
  const [due, setDue] = useState(todayIso());
  const [status, setStatus] = useState("paid");
  const [recurrence, setRecurrence] = useState("none");
  const [installments, setInstallments] = useState("1");
  const [notes, setNotes] = useState("");

  const accounts = data.accounts.filter((a) => !entityId || a.entity_id === entityId);
  const categories = data.categories.filter((c) =>
    kind === "transfer" ? false : c.kind === kind,
  );

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
    if (!entityId) return fail("Selecione a entidade financeira.");
    if (!description.trim()) return fail("Informe a descrição.");
    const value = Number(amount.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) return fail("Informe um valor válido.");
    if (!accountId) return fail("Selecione a conta de origem.");
    if (kind === "transfer" && !toAccountId) return fail("Selecione a conta de destino.");

    setBusy(true);
    const total = Math.max(1, Number(installments) || 1);
    const per = Math.round((value / total) * 100) / 100;
    const rows = Array.from({ length: total }, (_, i) => {
      const dueDate = new Date(due);
      dueDate.setMonth(dueDate.getMonth() + i);
      const finalStatus =
        kind === "transfer"
          ? status === "pending"
            ? "pending"
            : "paid"
          : status === "paid"
            ? kind === "income"
              ? "received"
              : "paid"
            : status;
      const settled = finalStatus === "paid" || finalStatus === "received";
      return {
        user_id: user.id,
        entity_id: entityId,
        kind,
        description: total > 1 ? `${description} (${i + 1}/${total})` : description,
        amount: total > 1 ? per : value,
        category_id: kind === "transfer" ? null : categoryId || null,
        account_id: accountId,
        to_account_id: kind === "transfer" ? toAccountId : null,
        to_entity_id:
          kind === "transfer"
            ? (data.accounts.find((a) => a.id === toAccountId)?.entity_id ?? null)
            : null,
        payment_method: kind === "transfer" ? "transfer" : method,
        competence_date: competence,
        due_date: dueDate.toISOString().slice(0, 10),
        paid_at: settled && i === 0 ? competence : null,
        status: i === 0 ? finalStatus : "pending",
        recurrence,
        installment_no: total > 1 ? i + 1 : null,
        installment_total: total > 1 ? total : null,
        source: "manual",
        notes: notes || null,
      };
    });

    const { error } = await supabase.from("transactions").insert(rows);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase.from("audit_log").insert({
      user_id: user.id,
      table_name: "transactions",
      action: "insert",
      details: { description, amount: value, kind, entity_id: entityId },
    });
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
            Todo lançamento pertence a uma entidade financeira. Transferências internas não afetam
            receitas e despesas do consolidado.
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
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pix">Pix</SelectItem>
                  <SelectItem value="cash">Dinheiro</SelectItem>
                  <SelectItem value="debit">Débito</SelectItem>
                  <SelectItem value="credit">Crédito</SelectItem>
                  <SelectItem value="boleto">Boleto</SelectItem>
                  <SelectItem value="transfer">Transferência</SelectItem>
                  <SelectItem value="other">Outro</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}

          <Field label="Competência">
            <Input type="date" value={competence} onChange={(e) => setCompetence(e.target.value)} />
          </Field>
          <Field label="Vencimento">
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>

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

          <Field label="Parcelas">
            <Input type="number" min={1} max={48} value={installments} onChange={(e) => setInstallments(e.target.value)} />
          </Field>

          <Field label="Observações" className="sm:col-span-2">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>Salvar lançamento</Button>
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
