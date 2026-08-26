import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, CheckCircle2, FileWarning, FolderOpen, Tags, WalletCards } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEntityScope } from "@/components/finance/EntityContext";
import { PageHeader } from "@/components/finance/PageHeader";
import { Button } from "@/components/ui/button";
import { brl, fmtDate, isOpen } from "@/lib/finance";
import { detectTransactionAnomalies } from "@/lib/finance-anomalies";

export const Route = createFileRoute("/_authenticated/revisar")({
  head: () => ({ meta: [{ title: "Para revisar — Aurelian Finance" }] }),
  component: ReviewInbox,
});

type PendingDocument = {
  id: string;
  file_name: string;
  status: string;
  created_at: string;
};

function ReviewInbox() {
  const { data, entityId, entityName } = useEntityScope();
  const [documents, setDocuments] = useState<PendingDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);

  const loadDocuments = useCallback(async () => {
    setLoadingDocs(true);
    const { data: rows } = await supabase
      .from("financial_documents")
      .select("id, file_name, status, created_at")
      .in("status", ["uploaded", "processing", "interpreted", "failed"])
      .order("created_at", { ascending: false })
      .limit(20);
    setDocuments((rows ?? []) as PendingDocument[]);
    setLoadingDocs(false);
  }, []);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const scopedTransactions = useMemo(
    () => data.transactions.filter((tx) => !tx.deleted_at && tx.kind !== "transfer" && (entityId === "all" || tx.entity_id === entityId)),
    [data.transactions, entityId],
  );

  const uncategorized = useMemo(
    () => scopedTransactions.filter((tx) => !tx.category_id).slice(0, 8),
    [scopedTransactions],
  );

  const withoutAccount = useMemo(
    () => scopedTransactions.filter((tx) => !tx.account_id).slice(0, 8),
    [scopedTransactions],
  );

  const overdueWithoutCategory = useMemo(
    () => scopedTransactions.filter((tx) => !tx.category_id && isOpen(tx) && tx.status === "overdue").slice(0, 5),
    [scopedTransactions],
  );

  const anomalies = useMemo(() => detectTransactionAnomalies(data, entityId), [data, entityId]);
  const total = documents.length + uncategorized.length + withoutAccount.length + anomalies.length;

  return (
    <div className="min-w-0">
      <PageHeader
        title="Para revisar"
        subtitle={`${entityName} · tudo que ainda precisa de uma confirmação sua`}
      />

      <section className="panel overflow-hidden p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-primary">Caixa de entrada financeira</p>
            <h2 className="mt-1 text-lg font-semibold">
              {total > 0 ? `${total} ${total === 1 ? "coisa precisa" : "coisas precisam"} da sua atenção.` : "Nada para revisar agora."}
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Quando o Aurelian não tem segurança para decidir sozinho, ele deixa aqui em vez de adivinhar.
            </p>
          </div>
          {total === 0 ? <CheckCircle2 className="size-8 text-primary" /> : <AlertTriangle className="size-8 text-amber-500" />}
        </div>
      </section>

      {anomalies.length > 0 ? (
        <section className="panel mt-4 border-amber-500/25 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold">Lançamentos que parecem estranhos</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Eu não alterei nada. Só separei o que vale conferir antes de confiar nos números.</p>
                </div>
                <Link to="/consultor-riscos" className="text-xs font-medium text-primary hover:underline">Ver análise completa</Link>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {anomalies.slice(0, 6).map((item) => (
                  <div key={item.id} className={`rounded-xl border p-3 ${item.severity === "critical" ? "border-destructive/25 bg-destructive/5" : "border-amber-500/25 bg-amber-500/5"}`}>
                    <p className="text-xs font-medium">{item.title}</p>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{item.body}</p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="truncate text-[10px] text-muted-foreground">{item.transaction.description}</span>
                      <span className="num shrink-0 text-[11px] font-medium">{brl(Number(item.transaction.amount))}</span>
                    </div>
                    {item.relatedTransaction ? <p className="mt-1 text-[10px] text-muted-foreground">Outro parecido: {fmtDate(item.relatedTransaction.competence_date)}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <ReviewCard
          icon={FolderOpen}
          title="Documentos esperando você"
          count={documents.length}
          description="Notas, recibos ou arquivos que ainda não viraram um lançamento confirmado."
          to="/documentos"
          action="Revisar documentos"
        >
          {loadingDocs ? <p className="text-xs text-muted-foreground">Carregando…</p> : documents.slice(0, 5).map((doc) => (
            <div key={doc.id} className="rounded-lg border border-border bg-surface px-3 py-2">
              <p className="truncate text-xs font-medium">{doc.file_name}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{documentStatus(doc.status)}</p>
            </div>
          ))}
        </ReviewCard>

        <ReviewCard
          icon={Tags}
          title="Sem categoria"
          count={uncategorized.length}
          description="Movimentações que existem, mas ainda não estão organizadas para relatórios e comparações."
          to="/lancamentos"
          action="Organizar movimentações"
        >
          {uncategorized.slice(0, 5).map((tx) => (
            <div key={tx.id} className="rounded-lg border border-border bg-surface px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-xs font-medium">{tx.description}</p>
                <span className={`num shrink-0 text-xs ${tx.kind === "income" ? "text-success" : "text-destructive"}`}>{brl(Number(tx.amount))}</span>
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{fmtDate(tx.competence_date)}</p>
            </div>
          ))}
        </ReviewCard>

        <ReviewCard
          icon={WalletCards}
          title="Sem conta definida"
          count={withoutAccount.length}
          description="Movimentações em que ainda não está claro de qual conta o dinheiro entrou ou saiu."
          to="/lancamentos"
          action="Definir contas"
        >
          {withoutAccount.slice(0, 5).map((tx) => (
            <div key={tx.id} className="rounded-lg border border-border bg-surface px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-xs font-medium">{tx.description}</p>
                <span className={`num shrink-0 text-xs ${tx.kind === "income" ? "text-success" : "text-destructive"}`}>{brl(Number(tx.amount))}</span>
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{fmtDate(tx.competence_date)}</p>
            </div>
          ))}
        </ReviewCard>
      </div>

      {overdueWithoutCategory.length > 0 ? (
        <section className="panel mt-4 border-destructive/25 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <FileWarning className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">Tem item atrasado e ainda sem organização</h2>
              <p className="mt-1 text-xs text-muted-foreground">Esses itens merecem prioridade porque podem afetar tanto o caixa quanto seus relatórios.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {overdueWithoutCategory.map((tx) => (
                  <div key={tx.id} className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2">
                    <p className="truncate text-xs font-medium">{tx.description}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{brl(Number(tx.amount))} · vencido</p>
                  </div>
                ))}
              </div>
              <Link to="/pendencias" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Resolver agora <ArrowRight className="size-3" /></Link>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ReviewCard({ icon: Icon, title, count, description, to, action, children }: {
  icon: typeof FolderOpen;
  title: string;
  count: number;
  description: string;
  to: "/documentos" | "/lancamentos";
  action: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel flex min-h-64 flex-col p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
          <div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p></div>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs ${count > 0 ? "border-primary/25 bg-primary/5 text-primary" : "border-border text-muted-foreground"}`}>{count}</span>
      </div>
      <div className="mt-4 flex-1 space-y-2">
        {count > 0 ? children : <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">Tudo certo por aqui.</p>}
      </div>
      <Button variant="outline" size="sm" className="mt-4 w-full" asChild>
        <Link to={to}>{action}</Link>
      </Button>
    </section>
  );
}

function documentStatus(status: string) {
  if (status === "uploaded") return "Pronto para interpretar";
  if (status === "processing") return "Sendo lido pela IA";
  if (status === "interpreted") return "Pronto para revisar e confirmar";
  if (status === "failed") return "Precisa tentar novamente";
  return "Aguardando revisão";
}
