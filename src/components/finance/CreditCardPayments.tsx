import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
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
import { StatusPill } from "@/routes/_authenticated/lancamentos";
import {
  brl,
  fmtDate,
  monthKey,
  toDate,
  today,
  type CardInstallment,
  type CreditCard,
} from "@/lib/finance";
import { localDateIso } from "@/lib/date";

const todayIso = () => localDateIso();

function monthInput(ref: Date) {
  return monthKey(ref);
}

function monthInputToDate(value: string) {
  return `${value}-01`;
}

function PaymentAccountFields({
  accountId,
  setAccountId,
  paidAt,
  setPaidAt,
  defaultAccountId,
}: {
  accountId: string;
  setAccountId: (v: string) => void;
  paidAt: string;
  setPaidAt: (v: string) => void;
  defaultAccountId: string | null;
}) {
  const { data } = useEntityScope();
  const accounts = data.accounts.filter((a) => a.active);
  const resolved = accountId || defaultAccountId || "";

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Conta de pagamento</Label>
        <Select {...(resolved ? { value: resolved } : {})} onValueChange={setAccountId}>
          <SelectTrigger><SelectValue placeholder="Selecione a conta" /></SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Data do pagamento</Label>
        <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
      </div>
    </div>
  );
}

export function PayBillDialog({
  card,
  referenceMonth,
  children,
}: {
  card: CreditCard;
  referenceMonth?: string;
  children?: ReactNode;
}) {
  const { canWrite } = useFinanceAccess();
  const refresh = useRefreshFinance();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accountId, setAccountId] = useState(card.account_id ?? "");
  const [paidAt, setPaidAt] = useState(todayIso());
  const [month, setMonth] = useState(referenceMonth ?? monthInput(today()));

  const submit = async () => {
    if (!canWrite) { toast.error("Seu acesso é somente leitura."); return; }
    const account = accountId || card.account_id;
    if (!account) { toast.error("Selecione a conta de pagamento."); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("pay_credit_card_bill", {
      p_credit_card_id: card.id,
      p_reference_month: monthInputToDate(month),
      p_account_id: account,
      p_paid_at: paidAt,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const row = Array.isArray(data) ? data[0] : data;
    toast.success(
      `Fatura paga: ${brl(Number(row?.total_paid ?? 0))} em ${row?.installment_count ?? 0} parcela(s). O caixa saiu da conta; a despesa não foi lançada de novo.`,
    );
    setOpen(false);
    refresh();
  };

  if (!canWrite) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) { setAccountId(card.account_id ?? ""); setMonth(referenceMonth ?? monthInput(today())); } }}>
      <DialogTrigger asChild>
        {children ?? <Button size="sm" variant="outline">Pagar fatura</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pagar fatura — {card.name}</DialogTitle>
          <DialogDescription>
            Debita a conta bancária e baixa as parcelas do mês. Não gera nova despesa: a compra já entrou no resultado na data da compra.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div>
            <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Mês de referência</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <PaymentAccountFields
            accountId={accountId}
            setAccountId={setAccountId}
            paidAt={paidAt}
            setPaidAt={setPaidAt}
            defaultAccountId={card.account_id}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Pagando…" : "Pagar fatura"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PayInstallmentDialog({
  card,
  installment,
  children,
}: {
  card: CreditCard;
  installment: CardInstallment;
  children?: ReactNode;
}) {
  const { canWrite } = useFinanceAccess();
  const refresh = useRefreshFinance();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accountId, setAccountId] = useState(card.account_id ?? "");
  const [paidAt, setPaidAt] = useState(todayIso());

  const submit = async () => {
    if (!canWrite) { toast.error("Seu acesso é somente leitura."); return; }
    const account = accountId || card.account_id;
    if (!account) { toast.error("Selecione a conta de pagamento."); return; }
    setBusy(true);
    const { error } = await supabase.rpc("pay_credit_card_installment", {
      p_installment_id: installment.id,
      p_account_id: account,
      p_paid_at: paidAt,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Parcela de ${brl(Number(installment.amount))} paga. Saldo da conta reduzido; despesa econômica inalterada.`);
    setOpen(false);
    refresh();
  };

  const canPay = canWrite && (installment.status === "pending" || installment.status === "overdue");
  if (!canPay) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) setAccountId(card.account_id ?? ""); }}>
      <DialogTrigger asChild>
        {children ?? <Button size="sm" variant="ghost">Pagar</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pagar parcela {installment.installment_no}</DialogTitle>
          <DialogDescription>
            {brl(Number(installment.amount))} · vence {fmtDate(installment.due_date)}. Movimenta caixa, não lança despesa.
          </DialogDescription>
        </DialogHeader>
        <PaymentAccountFields
          accountId={accountId}
          setAccountId={setAccountId}
          paidAt={paidAt}
          setPaidAt={setPaidAt}
          defaultAccountId={card.account_id}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Pagando…" : "Pagar parcela"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BillDetailsDialog({
  card,
  children,
}: {
  card: CreditCard;
  children?: ReactNode;
}) {
  const { data } = useEntityScope();
  const { canWrite } = useFinanceAccess();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(monthInput(today()));

  const purchasesById = useMemo(
    () => new Map(data.purchases.map((p) => [p.id, p])),
    [data.purchases],
  );

  const items = useMemo(() => {
    const mk = month;
    return data.installments
      .filter((i) => i.credit_card_id === card.id && monthKey(toDate(i.due_date)) === mk)
      .sort((a, b) => a.installment_no - b.installment_no || a.due_date.localeCompare(b.due_date));
  }, [data.installments, card.id, month]);

  const openItems = items.filter((i) => i.status === "pending" || i.status === "overdue");
  const totalOpen = openItems.reduce((s, i) => s + Number(i.amount), 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? <Button size="sm" variant="outline">Ver parcelas</Button>}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Detalhes da fatura — {card.name}</DialogTitle>
          <DialogDescription>
            Parcelas do mês selecionado. Pagar fatura ou parcela move caixa e não gera nova despesa.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Mês</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" />
          </div>
          <div className="text-right">
            <p className="text-[11px] text-muted-foreground">{openItems.length} em aberto</p>
            <p className="num text-lg font-semibold text-destructive">{brl(totalOpen)}</p>
          </div>
        </div>

        {canWrite && openItems.length > 0 ? (
          <PayBillDialog card={card} referenceMonth={month}>
            <Button>Pagar fatura inteira</Button>
          </PayBillDialog>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-2 py-2 font-medium">Descrição</th>
                <th className="px-2 py-2 font-medium">Parcela</th>
                <th className="px-2 py-2 font-medium">Vencimento</th>
                <th className="px-2 py-2 text-right font-medium">Valor</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const purchase = purchasesById.get(i.purchase_id);
                return (
                  <tr key={i.id} className="border-b border-border/60 last:border-0">
                    <td className="px-2 py-2">{purchase?.description ?? "—"}</td>
                    <td className="px-2 py-2">{i.installment_no}/{purchase?.installments ?? "—"}</td>
                    <td className="px-2 py-2">{fmtDate(i.due_date)}</td>
                    <td className="num px-2 py-2 text-right">{brl(Number(i.amount))}</td>
                    <td className="px-2 py-2"><StatusPill status={i.status} dueDate={i.due_date} /></td>
                    <td className="px-2 py-2 text-right">
                      <PayInstallmentDialog card={card} installment={i} />
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-sm text-muted-foreground">
                    Nenhuma parcela neste mês.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
