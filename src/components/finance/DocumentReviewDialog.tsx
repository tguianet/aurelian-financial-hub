import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { useEntityScope } from "./EntityContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { selectableCategories } from "@/lib/categories";
import { isValidDateIso, localDateIso } from "@/lib/date";
import { parseBRLMoney } from "@/lib/money";
import { rpcErrorMessage } from "@/lib/rpc-error";
import type { PaymentMethod, ResolvedDocumentSuggestion } from "@/lib/document-interpretation";
import { PAYMENT_METHODS } from "@/lib/document-interpretation";
import { PAYMENT_LABEL } from "@/lib/finance";

type Props = {
  open: boolean;
  documentId: string;
  suggestion: ResolvedDocumentSuggestion;
  onOpenChange: (open: boolean) => void;
  onConfirmed?: () => void;
};

export function DocumentReviewDialog({ open, documentId, suggestion, onOpenChange, onConfirmed }: Props) {
  const { data, entityId: scopedEntity } = useEntityScope();
  const { canWrite } = useFinanceAccess();
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState(suggestion.kind);
  const [description, setDescription] = useState(suggestion.description);
  const [amount, setAmount] = useState(String(suggestion.amount).replace(".", ","));
  const [entityId, setEntityId] = useState(suggestion.entity_id ?? (scopedEntity !== "all" ? scopedEntity : ""));
  const [categoryId, setCategoryId] = useState(suggestion.category_id ?? "");
  const [accountId, setAccountId] = useState(suggestion.account_id ?? "");
  const [cardId, setCardId] = useState("");
  const [method, setMethod] = useState<PaymentMethod>(suggestion.payment_method);
  const [competence, setCompetence] = useState(suggestion.competence_date ?? localDateIso());
  const [due, setDue] = useState(suggestion.due_date ?? suggestion.competence_date ?? localDateIso());
  const [status, setStatus] = useState("paid");
  const [installments, setInstallments] = useState("1");

  const categories = useMemo(() => selectableCategories(data.categories, kind), [data.categories, kind]);
  const accounts = data.accounts.filter((account) => account.active && (!entityId || account.entity_id === entityId));
  const cards = data.cards.filter((card) => card.active && (!entityId || card.entity_id === entityId));
  const isCredit = kind === "expense" && method === "credit";

  const confirm = async () => {
    if (busy) return;
    if (!canWrite) { toast.error("Seu acesso é somente leitura."); return; }
    if (!entityId) { toast.error("Selecione a entidade."); return; }
    if (!description.trim()) { toast.error("Informe a descrição."); return; }
    const value = parseBRLMoney(amount);
    if (value === null || value <= 0) { toast.error("Informe um valor válido."); return; }
    if (!isValidDateIso(competence) || !isValidDateIso(due)) { toast.error("Informe datas válidas."); return; }
    if (isCredit && !cardId) { toast.error("Selecione o cartão."); return; }
    if (!isCredit && !accountId) { toast.error("Selecione a conta."); return; }
    const count = Math.max(1, Number(installments) || 1);

    setBusy(true);
    const { data: rows, error } = await supabase.rpc("confirm_financial_document_transaction", {
      p_id: documentId,
      p_entity_id: entityId,
      p_kind: kind,
      p_description: description.trim(),
      p_amount: value,
      p_account_id: isCredit ? undefined : accountId,
      p_category_id: categoryId || undefined,
      p_payment_method: isCredit ? "credit" : method,
      p_competence_date: competence,
      p_due_date: due,
      p_status: isCredit ? "pending" : status,
      p_notes: suggestion.notes ?? undefined,
      p_credit_card_id: isCredit ? cardId : undefined,
      p_installments: isCredit ? count : 1,
    });
    setBusy(false);
    if (error) {
      toast.error(rpcErrorMessage(error, "Não foi possível confirmar o lançamento."));
      return;
    }
    const result = rows?.[0];
    toast.success(result?.credit_card_purchase_id ? "Compra no cartão vinculada ao documento." : "Lançamento confirmado e vinculado ao documento.");
    onOpenChange(false);
    onConfirmed?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Revisar lançamento do documento</DialogTitle>
          <DialogDescription>
            A IA só sugere. Nada é lançado até você confirmar. Confiança {(suggestion.confidence * 100).toFixed(0)}%.
          </DialogDescription>
        </DialogHeader>

        {suggestion.ambiguous_entity ? (
          <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
            A entidade ficou ambígua. Escolha manualmente antes de confirmar.
          </p>
        ) : null}
        {suggestion.ambiguous_category ? (
          <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
            A categoria ficou ambígua. Confira antes de confirmar — a IA não escolheu sozinha.
          </p>
        ) : null}
        {suggestion.possible_recurring ? (
          <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
            Este documento parece recorrente. Recorrência não é criada automaticamente.
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tipo">
            <Select value={kind} onValueChange={(value) => setKind(value as "income" | "expense")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Saída</SelectItem>
                <SelectItem value="income">Entrada</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Valor">
            <Input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Descrição" className="sm:col-span-2">
            <Input value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <Field label="Entidade">
            <Select value={entityId} onValueChange={(value) => { setEntityId(value); setAccountId(""); setCardId(""); }}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {data.entities.filter((entity) => entity.active).map((entity) => (
                  <SelectItem key={entity.id} value={entity.id}>{entity.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Categoria">
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Pagamento">
            <Select value={method} onValueChange={(value) => setMethod(value as PaymentMethod)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((item) => (
                  <SelectItem key={item} value={item}>{PAYMENT_LABEL[item] ?? item}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {isCredit ? (
            <Field label="Cartão">
              <Select value={cardId} onValueChange={setCardId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {cards.map((card) => (
                    <SelectItem key={card.id} value={card.id}>{card.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <Field label="Conta">
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Competência">
            <Input type="date" value={competence} onChange={(event) => setCompetence(event.target.value)} />
          </Field>
          <Field label="Vencimento">
            <Input type="date" value={due} onChange={(event) => setDue(event.target.value)} />
          </Field>
          {isCredit ? (
            <Field label="Parcelas">
              <Input type="number" min={1} max={48} value={installments} onChange={(event) => setInstallments(event.target.value)} />
            </Field>
          ) : (
            <Field label="Status">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pendente</SelectItem>
                  <SelectItem value="paid">Liquidado</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Corrigir depois</Button>
          <Button onClick={() => void confirm()} disabled={busy || !canWrite}>
            {busy ? "Confirmando…" : "Confirmar lançamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
