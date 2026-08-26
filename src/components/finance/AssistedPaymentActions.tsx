import { useMemo, useState } from "react";
import { CheckCircle2, HandCoins, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { useRefreshFinance } from "@/hooks/useFinance";
import { prioritizedPayables } from "@/components/finance/PaymentPriorityPanel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { brl, displayOpenStatus, fmtDate, type FinanceDataset } from "@/lib/finance";
import { localDateIso } from "@/lib/date";
import { addMoney, roundMoney } from "@/lib/money";
import { rpcErrorMessage } from "@/lib/rpc-error";

type Props = {
  data: FinanceDataset;
  entityId: string;
};

export function AssistedPaymentActions({ data, entityId }: Props) {
  const { canWrite } = useFinanceAccess();
  const refresh = useRefreshFinance();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);

  const candidates = useMemo(() => prioritizedPayables(data, entityId).slice(0, 3), [data, entityId]);
  const chosen = useMemo(() => candidates.filter((tx) => selected.includes(tx.id)), [candidates, selected]);
  const total = useMemo(() => roundMoney(chosen.reduce((sum, tx) => addMoney(sum, Number(tx.amount)), 0)), [chosen]);

  const toggle = (id: string) => {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const execute = async () => {
    if (!chosen.length) return;
    setRunning(true);
    let done = 0;
    const failures: string[] = [];

    for (const tx of chosen) {
      if (tx.is_demo) {
        failures.push(`${tx.description}: registro de exemplo não pode ser alterado`);
        continue;
      }
      const { error } = await supabase.rpc("settle_transaction", { p_id: tx.id, p_paid_at: localDateIso() });
      if (error) {
        failures.push(`${tx.description}: ${rpcErrorMessage(error, "não consegui confirmar")}`);
        continue;
      }
      done += 1;
    }

    setRunning(false);
    setConfirming(false);
    setSelected([]);
    refresh();

    if (done > 0 && failures.length === 0) toast.success(`${done} pagamento(s) confirmado(s).`);
    else if (done > 0) toast.warning(`${done} confirmado(s), ${failures.length} com falha. ${failures[0] ?? ""}`);
    else toast.error(`Nenhum pagamento confirmado. ${failures[0] ?? ""}`);
  };

  return (
    <section id="acoes-assistidas" className="panel mt-4 border-primary/20 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <HandCoins className="size-4" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">Ações assistidas</span>
          </div>
          <h2 className="mt-1 text-base font-semibold">Preparar pagamentos prioritários</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Eu nunca pago sozinho. Selecione os itens, revise a confirmação e só então os pagamentos são registrados.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {candidates.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">Não há pagamentos em aberto neste escopo.</p>
        ) : candidates.map((tx) => {
          const due = tx.due_date ?? tx.competence_date;
          const status = displayOpenStatus(tx.status, due);
          const entityName = data.entities.find((entity) => entity.id === tx.entity_id)?.name ?? "—";
          return (
            <label key={tx.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface p-3">
              <Checkbox checked={selected.includes(tx.id)} onCheckedChange={() => toggle(tx.id)} disabled={running} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium">{tx.description}</p>
                  {status === "overdue" ? <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">vencido</span> : null}
                  {tx.is_demo ? <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">exemplo</span> : null}
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{entityName} · vence {fmtDate(due)}</p>
              </div>
              <span className="num shrink-0 text-sm font-semibold text-destructive">{brl(Number(tx.amount))}</span>
            </label>
          );
        })}
      </div>

      {candidates.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {chosen.length ? <>Selecionados: <strong className="num">{chosen.length}</strong> · total <strong className="num">{brl(total)}</strong></> : "Nenhum item selecionado."}
          </p>
          <Button
            className="gap-2"
            disabled={!chosen.length || running || !canWrite}
            onClick={() => setConfirming(true)}
          >
            <ShieldCheck className="size-4" /> Preparar pagamentos
          </Button>
        </div>
      ) : null}

      {!canWrite ? <p className="mt-2 text-[11px] text-muted-foreground">Seu acesso permite apenas visualizar.</p> : null}

      <AlertDialog open={confirming} onOpenChange={(open) => { if (!running) setConfirming(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar {chosen.length} pagamento(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              Os itens abaixo serão registrados como pagos hoje. Nada é feito sem esta confirmação.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-56 space-y-2 overflow-y-auto">
            {chosen.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-xs">
                <span className="truncate">{tx.description}</span>
                <span className="num shrink-0 font-medium">{brl(Number(tx.amount))}</span>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs font-semibold">
              <span>Total</span>
              <span className="num">{brl(total)}</span>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={running}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={running}
              onClick={(event) => { event.preventDefault(); void execute(); }}
            >
              {running ? <Loader2 className="mr-2 size-4 animate-spin" /> : <CheckCircle2 className="mr-2 size-4" />}
              Confirmar pagamentos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
