import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Pause, Pencil, Play, Plus, Repeat2, Square } from "lucide-react";
import { toast } from "sonner";
import { createFileRouteHead } from "@/lib/head";
import { supabase } from "@/integrations/supabase/client";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { useRefreshFinance } from "@/hooks/useFinance";
import { useEntityScope } from "@/components/finance/EntityContext";
import { PageHeader } from "@/components/finance/PageHeader";
import { Td, Th } from "./lancamentos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { selectableCategories } from "@/lib/categories";
import { parseBRLMoney } from "@/lib/money";
import { isValidDateIso, localDateIso } from "@/lib/date";
import {
  brl,
  buildScope,
  FREQUENCY_LABEL,
  fmtDate,
  WEEKDAY_LABEL,
  type RecurringTransaction,
} from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/recorrencias")({
  head: () =>
    createFileRouteHead(
      "Recorrências — Aurelian Finance",
      "Receitas e despesas recorrentes com geração idempotente, pausa, retomada e encerramento.",
    ),
  component: Recorrencias,
});

const todayIso = () => localDateIso();

function parseMoney(value: string) {
  return parseBRLMoney(value);
}

function statusOf(r: RecurringTransaction, ref = todayIso()) {
  if (r.ends_at && r.ends_at < ref) return "ended";
  if (!r.active) return "paused";
  return "active";
}

function Recorrencias() {
  const { data, entityId, entityName } = useEntityScope();
  const { canWrite } = useFinanceAccess();
  const refresh = useRefreshFinance();
  const scope = buildScope(data, entityId);
  const rows = data.recurring.filter((r) => scope.matchesEntity(r.entity_id));

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringTransaction | null>(null);
  const [busy, setBusy] = useState(false);

  const materializedCount = (id: string) =>
    data.transactions.filter((t) => t.recurring_transaction_id === id && !t.deleted_at).length;

  const pause = async (id: string) => {
    if (!canWrite) { toast.error("Seu acesso é somente leitura."); return; }
    const { error } = await supabase.rpc("pause_recurring_transaction", { p_id: id } as never);
    if (error) { toast.error(error.message); return; }
    toast.success("Recorrência pausada. Ocorrências já geradas foram mantidas.");
    refresh();
  };

  const resume = async (id: string) => {
    if (!canWrite) { toast.error("Seu acesso é somente leitura."); return; }
    const { data: next, error } = await supabase.rpc("resume_recurring_transaction", { p_id: id } as never);
    if (error) { toast.error(error.message); return; }
    toast.success(`Retomada a partir de ${fmtDate(next)}. Sem geração retroativa.`);
    refresh();
  };

  const end = async (id: string) => {
    if (!canWrite) { toast.error("Seu acesso é somente leitura."); return; }
    const { error } = await supabase.rpc("end_recurring_transaction", { p_id: id, p_ends_at: todayIso() } as never);
    if (error) { toast.error(error.message); return; }
    toast.success("Recorrência encerrada. O histórico permanece.");
    refresh();
  };

  return (
    <div>
      <PageHeader
        title="Recorrências"
        subtitle={entityName}
        action={
          canWrite ? (
            <Button className="gap-2" onClick={() => { setEditing(null); setOpen(true); }}>
              <Plus className="size-4" /> Nova recorrência
            </Button>
          ) : null
        }
      />

      <div className="mb-4 rounded-lg border border-border bg-surface/60 px-4 py-3 text-xs text-muted-foreground">
        Cada recorrência gera ocorrências em contas a pagar/receber na data prevista.
        Editar, pausar ou encerrar não altera lançamentos já gerados. A definição não é somada de novo na projeção quando a ocorrência já existe.
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <Th>Descrição</Th>
              <Th>Entidade</Th>
              <Th>Categoria</Th>
              <Th>Frequência</Th>
              <Th className="text-right">Valor</Th>
              <Th>Próxima</Th>
              <Th>Status</Th>
              <Th>Fim</Th>
              {canWrite ? <Th className="text-right">Ações</Th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = statusOf(r);
              return (
                <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-surface">
                  <Td>
                    <p>{r.description}</p>
                    <p className="text-[11px] text-muted-foreground">{materializedCount(r.id)} ocorrência(s) geradas</p>
                  </Td>
                  <Td>{data.entities.find((e) => e.id === r.entity_id)?.name ?? "—"}</Td>
                  <Td>{data.categories.find((c) => c.id === r.category_id)?.name ?? "—"}</Td>
                  <Td>
                    {FREQUENCY_LABEL[r.frequency] ?? r.frequency}
                    {r.frequency === "weekly" && r.weekday ? ` · ${WEEKDAY_LABEL[r.weekday]}` : ""}
                    {r.frequency === "monthly" && r.day_of_month ? ` · dia ${r.day_of_month}` : ""}
                    {r.frequency === "yearly" && r.month_of_year && r.day_of_month ? ` · ${String(r.day_of_month).padStart(2, "0")}/${String(r.month_of_year).padStart(2, "0")}` : ""}
                  </Td>
                  <Td className={`num text-right font-medium ${r.kind === "income" ? "text-success" : "text-destructive"}`}>
                    {r.kind === "income" ? "+" : "−"} {brl(Number(r.amount))}
                  </Td>
                  <Td>{st === "active" ? fmtDate(r.next_run) : "—"}</Td>
                  <Td>
                    {st === "active" ? <Badge>Ativa</Badge> : null}
                    {st === "paused" ? <Badge variant="secondary">Pausada</Badge> : null}
                    {st === "ended" ? <Badge variant="outline">Encerrada</Badge> : null}
                  </Td>
                  <Td>{fmtDate(r.ends_at ?? null)}</Td>
                  {canWrite ? (
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Editar" onClick={() => { setEditing(r); setOpen(true); }}>
                          <Pencil className="size-4" />
                        </Button>
                        {st === "active" ? (
                          <Button variant="ghost" size="icon" title="Pausar" onClick={() => void pause(r.id)}>
                            <Pause className="size-4" />
                          </Button>
                        ) : null}
                        {st === "paused" ? (
                          <Button variant="ghost" size="icon" title="Retomar" onClick={() => void resume(r.id)}>
                            <Play className="size-4" />
                          </Button>
                        ) : null}
                        {st !== "ended" ? (
                          <Button variant="ghost" size="icon" title="Encerrar" onClick={() => void end(r.id)}>
                            <Square className="size-4" />
                          </Button>
                        ) : null}
                      </div>
                    </Td>
                  ) : null}
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={canWrite ? 9 : 8} className="p-8 text-center text-sm text-muted-foreground">
                  Nenhuma recorrência nesta visão.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <RecurringDialog open={open} onOpenChange={setOpen} editing={editing} busy={busy} setBusy={setBusy} />
    </div>
  );
}

function RecurringDialog({
  open,
  onOpenChange,
  editing,
  busy,
  setBusy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: RecurringTransaction | null;
  busy: boolean;
  setBusy: (v: boolean) => void;
}) {
  const { data, entityId } = useEntityScope();
  const { canWrite } = useFinanceAccess();
  const refresh = useRefreshFinance();
  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [ownerEntityId, setOwnerEntityId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState("monthly");
  const [dayOfMonth, setDayOfMonth] = useState("10");
  const [weekday, setWeekday] = useState("1");
  const [monthOfYear, setMonthOfYear] = useState("1");
  const [startsAt, setStartsAt] = useState(todayIso());
  const [endsAt, setEndsAt] = useState("");
  const [method, setMethod] = useState("pix");
  const [notes, setNotes] = useState("");

  const accounts = data.accounts.filter((a) => a.active && a.entity_id === ownerEntityId);
  const categories = selectableCategories(data.categories, kind);

  const syncFromEditing = (next: RecurringTransaction | null) => {
    if (!next) {
      setKind("expense");
      setOwnerEntityId(entityId === "all" ? "" : entityId);
      setAccountId("");
      setCategoryId("");
      setDescription("");
      setAmount("");
      setFrequency("monthly");
      setDayOfMonth("10");
      setWeekday("1");
      setMonthOfYear("1");
      setStartsAt(todayIso());
      setEndsAt("");
      setMethod("pix");
      setNotes("");
      return;
    }
    setKind(next.kind);
    setOwnerEntityId(next.entity_id);
    setAccountId(next.account_id ?? "");
    setCategoryId(next.category_id ?? "");
    setDescription(next.description);
    setAmount(String(next.amount).replace(".", ","));
    setFrequency(next.frequency);
    setDayOfMonth(String(next.day_of_month ?? 10));
    setWeekday(String(next.weekday ?? 1));
    setMonthOfYear(String(next.month_of_year ?? 1));
    setStartsAt(next.starts_at ?? todayIso());
    setEndsAt(next.ends_at ?? "");
    setMethod(next.payment_method ?? "pix");
    setNotes(next.notes ?? "");
  };

  const submit = async () => {
    if (!canWrite) { toast.error("Seu acesso é somente leitura."); return; }
    if (!ownerEntityId) { toast.error("Selecione a entidade."); return; }
    if (!accountId) { toast.error("Selecione a conta."); return; }
    if (!categoryId) { toast.error("Selecione a categoria."); return; }
    if (!description.trim()) { toast.error("Informe a descrição."); return; }
    const value = parseMoney(amount);
    if (value === null || value <= 0) { toast.error("Informe um valor válido."); return; }
    if (!data.accounts.some((a) => a.id === accountId && a.active && a.entity_id === ownerEntityId)) {
      toast.error("Selecione uma conta ativa da entidade escolhida.");
      return;
    }
    if (!categories.some((c) => c.id === categoryId)) {
      toast.error("Selecione uma categoria compatível com o tipo da recorrência.");
      return;
    }
    if (!isValidDateIso(startsAt)) { toast.error("Informe uma data de início válida."); return; }
    if (endsAt && !isValidDateIso(endsAt)) { toast.error("Informe uma data de encerramento válida."); return; }
    if (endsAt && endsAt < startsAt) { toast.error("A data de encerramento não pode ser anterior ao início."); return; }
    if (!(["monthly", "weekly", "yearly"] as const).includes(frequency as "monthly" | "weekly" | "yearly")) {
      toast.error("Frequência inválida.");
      return;
    }

    const day = Number(dayOfMonth);
    const week = Number(weekday);
    const month = Number(monthOfYear);
    if (frequency !== "weekly" && (!Number.isInteger(day) || day < 1 || day > 31)) {
      toast.error("O dia da recorrência deve estar entre 1 e 31.");
      return;
    }
    if (frequency === "weekly" && (!Number.isInteger(week) || week < 1 || week > 7)) {
      toast.error("Selecione um dia da semana válido.");
      return;
    }
    if (frequency === "yearly" && (!Number.isInteger(month) || month < 1 || month > 12)) {
      toast.error("O mês da recorrência deve estar entre 1 e 12.");
      return;
    }

    const payload = {
      p_entity_id: ownerEntityId,
      p_account_id: accountId,
      p_category_id: categoryId,
      p_kind: kind,
      p_description: description.trim(),
      p_amount: value,
      p_frequency: frequency,
      p_starts_at: startsAt,
      p_day_of_month: frequency === "weekly" ? undefined : day,
      p_weekday: frequency === "weekly" ? week : undefined,
      p_month_of_year: frequency === "yearly" ? month : undefined,
      p_ends_at: endsAt || undefined,
      p_payment_method: method,
      p_notes: notes.trim() || undefined,
    };

    setBusy(true);
    const { error } = editing
      ? await supabase.rpc("update_recurring_transaction", { p_id: editing.id, ...payload } as never)
      : await supabase.rpc("create_recurring_transaction", payload as never);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(
      editing
        ? "Recorrência atualizada. Lançamentos já gerados não foram alterados."
        : "Recorrência criada. A primeira ocorrência entra em pendências se a data já chegou.",
    );
    onOpenChange(false);
    refresh();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (next) syncFromEditing(editing); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat2 className="size-4" /> {editing ? "Editar recorrência" : "Nova recorrência"}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "A alteração vale só para ocorrências ainda não geradas. Lançamentos pagos ou já materializados permanecem."
              : "Gera ocorrências pendentes na data prevista. Não cria um lançamento avulso duplicado."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <Field label="Tipo">
            <Select value={kind} onValueChange={(v) => { setKind(v as "income" | "expense"); setCategoryId(""); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Despesa</SelectItem>
                <SelectItem value="income">Receita</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Entidade">
            <Select value={ownerEntityId} onValueChange={(v) => { setOwnerEntityId(v); setAccountId(""); }}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {data.entities.filter((e) => e.active).map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Descrição" className="sm:col-span-2">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Aluguel" />
          </Field>
          <Field label="Valor (R$)">
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" />
          </Field>
          <Field label="Categoria">
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Conta">
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Forma de pagamento">
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pix">Pix</SelectItem>
                <SelectItem value="boleto">Boleto</SelectItem>
                <SelectItem value="debit">Débito</SelectItem>
                <SelectItem value="transfer">Transferência</SelectItem>
                <SelectItem value="cash">Dinheiro</SelectItem>
                <SelectItem value="other">Outro</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Frequência">
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Mensal</SelectItem>
                <SelectItem value="weekly">Semanal</SelectItem>
                <SelectItem value="yearly">Anual</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {frequency === "weekly" ? (
            <Field label="Dia da semana">
              <Select value={weekday} onValueChange={setWeekday}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(WEEKDAY_LABEL).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <Field label="Dia">
              <Input type="number" min={1} max={31} value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} />
            </Field>
          )}
          {frequency === "yearly" ? (
            <Field label="Mês">
              <Input type="number" min={1} max={12} value={monthOfYear} onChange={(e) => setMonthOfYear(e.target.value)} />
            </Field>
          ) : null}
          <Field label="Início">
            <Input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </Field>
          <Field label="Encerrar em (opcional)">
            <Input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </Field>
          <Field label="Observações" className="sm:col-span-2">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
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
      <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
