import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  Download,
  File,
  FileSpreadsheet,
  Image as ImageIcon,
  RefreshCw,
  Sparkles,
  Stethoscope,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/finance/PageHeader";
import { QuickDocumentUpload } from "@/components/finance/QuickDocumentUpload";
import { DocumentReviewDialog } from "@/components/finance/DocumentReviewDialog";
import { useEntityScope } from "@/components/finance/EntityContext";
import { Button } from "@/components/ui/button";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { useRefreshFinance } from "@/hooks/useFinance";
import { supabase } from "@/integrations/supabase/client";
import { rpcErrorMessage } from "@/lib/rpc-error";
import {
  DOCUMENT_STATUS_LABEL,
  parseResolvedDocumentSuggestion,
  requestDocumentInterpretation,
  type ResolvedDocumentSuggestion,
} from "@/lib/document-interpretation";

export const Route = createFileRoute("/_authenticated/documentos")({
  head: () => ({ meta: [{ title: "Documentos — Aurelian Finance" }] }),
  component: Documentos,
});

type CatalogDoc = {
  id: string;
  file_name: string;
  storage_path: string;
  status: string;
  created_at: string;
  size_bytes: number | null;
  interpretation_json: unknown;
  interpretation_error: string | null;
  transaction_id: string | null;
  credit_card_purchase_id: string | null;
};

type OrphanFile = { name: string; path: string };

function iconFor(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(ext ?? "")) return ImageIcon;
  if (["csv", "xls", "xlsx"].includes(ext ?? "")) return FileSpreadsheet;
  return File;
}

function Documentos() {
  const { user } = useAuthUser();
  const { canWrite } = useFinanceAccess();
  const { entityId } = useEntityScope();
  const refresh = useRefreshFinance();
  const [docs, setDocs] = useState<CatalogDoc[]>([]);
  const [orphans, setOrphans] = useState<OrphanFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [review, setReview] = useState<{
    documentId: string;
    suggestion: ResolvedDocumentSuggestion;
  } | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [catalog, storage] = await Promise.all([
      supabase
        .from("financial_documents")
        .select(
          "id, file_name, storage_path, status, created_at, size_bytes, interpretation_json, interpretation_error, transaction_id, credit_card_purchase_id",
        )
        .in("status", ["uploaded", "processing", "interpreted", "failed", "linked"])
        .order("created_at", { ascending: false })
        .limit(80),
      supabase.storage.from("financial-documents").list(`${user.id}/inbox`, {
        limit: 100,
        sortBy: { column: "created_at", order: "desc" },
      }),
    ]);
    setLoading(false);
    if (catalog.error) {
      toast.error(catalog.error.message);
      return;
    }
    const rows = (catalog.data ?? []) as CatalogDoc[];
    setDocs(rows);

    const known = new Set(rows.map((row) => row.storage_path));
    const unmatched: OrphanFile[] = [];
    for (const file of storage.data ?? []) {
      const path = `${user.id}/inbox/${file.name}`;
      if (!known.has(path)) unmatched.push({ name: file.name, path });
    }
    setOrphans(unmatched);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const openFile = async (path: string) => {
    const { data, error } = await supabase.storage
      .from("financial-documents")
      .createSignedUrl(path, 60);
    if (error) {
      toast.error(error.message);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const recatalog = async (path: string, fileName: string) => {
    if (!canWrite) {
      toast.error("Seu acesso é somente leitura.");
      return;
    }
    const { error } = await supabase.rpc("register_financial_document", {
      p_storage_path: path,
      p_file_name: fileName,
      p_mime_type: undefined,
      p_size_bytes: undefined,
      p_source: "upload",
    } as never);
    if (error) {
      toast.error(rpcErrorMessage(error, "Não foi possível recuperar o arquivo."));
      return;
    }
    toast.success("Arquivo recuperado e cadastrado no Aurelian.");
    void load();
  };

  const interpret = async (doc: CatalogDoc, force = false) => {
    if (!canWrite) {
      toast.error("Seu acesso é somente leitura.");
      return;
    }
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      toast.error("Sessão expirada.");
      return;
    }
    setBusyId(doc.id);
    try {
      const result = await requestDocumentInterpretation({
        documentId: doc.id,
        token,
        force,
        selectedEntityId: entityId !== "all" ? entityId : null,
      });
      setReview({ documentId: doc.id, suggestion: result.interpretation });
      toast.success(
        result.source === "cached"
          ? "Sugestão já existente. Revise antes de lançar."
          : "Documento lido. Revise antes de confirmar.",
      );
      void load();
    } catch (error) {
      const code = (error as Error & { code?: string }).code;
      if (code === "processing_in_progress") {
        toast.message("Este documento já está sendo lido em outro dispositivo.");
      } else {
        toast.error(error instanceof Error ? error.message : "Não consegui ler o documento.");
      }
      void load();
    } finally {
      setBusyId(null);
    }
  };

  const openReview = (doc: CatalogDoc) => {
    const suggestion = parseResolvedDocumentSuggestion(doc.interpretation_json);
    if (!suggestion) {
      toast.error("A sugestão salva é inválida. Reprocesse com IA.");
      return;
    }
    setReview({ documentId: doc.id, suggestion });
  };

  const remove = async (doc: CatalogDoc) => {
    if (!canWrite) {
      toast.error("Seu acesso é somente leitura.");
      return;
    }
    const linked = doc.status === "linked" || Boolean(doc.transaction_id || doc.credit_card_purchase_id);
    const archived = await supabase.rpc("archive_financial_document", { p_id: doc.id } as never);
    if (archived.error) {
      toast.error(rpcErrorMessage(archived.error, "Não foi possível arquivar o documento."));
      return;
    }
    if (!linked) {
      const { error } = await supabase.storage.from("financial-documents").remove([doc.storage_path]);
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    toast.success(linked ? "Documento arquivado. O lançamento foi mantido." : "Documento excluído.");
    void load();
  };

  const removeOrphan = async (path: string) => {
    if (!canWrite) {
      toast.error("Seu acesso é somente leitura.");
      return;
    }
    const { error } = await supabase.storage.from("financial-documents").remove([path]);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Arquivo não cadastrado excluído.");
    void load();
  };

  const diagnose = async () => {
    if (!canWrite) {
      toast.error("Seu acesso é somente leitura.");
      return;
    }
    const { data, error } = await supabase.rpc("reconcile_financial_documents");
    if (error) {
      toast.error(rpcErrorMessage(error, "Não foi possível verificar os arquivos."));
      return;
    }
    const count = data?.length ?? 0;
    toast.message(
      count
        ? `${count} arquivo(s) precisam de atenção. Nada foi apagado.`
        : "Todos os arquivos estão organizados.",
    );
  };

  const pending = docs.filter((doc) => doc.status !== "linked");
  const linked = docs.filter((doc) => doc.status === "linked");

  return (
    <div>
      <PageHeader
        title="Caixa de documentos"
        subtitle="Envie comprovantes, deixe a IA organizar e confirme antes de criar qualquer lançamento."
        action={
          <div className="flex gap-2">
            {canWrite ? (
              <Button variant="ghost" size="sm" className="gap-2" onClick={() => void diagnose()}>
                <Stethoscope className="size-4" /> Verificar arquivos
              </Button>
            ) : null}
            <Button variant="outline" size="sm" className="gap-2" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
            </Button>
          </div>
        }
      />

      {review ? (
        <DocumentReviewDialog
          key={review.documentId}
          open
          documentId={review.documentId}
          suggestion={review.suggestion}
          onOpenChange={(open) => {
            if (!open) setReview(null);
          }}
          onConfirmed={() => {
            refresh();
            void load();
          }}
        />
      ) : null}

      <div className="panel p-4 md:p-5">
        <h2 className="text-sm font-semibold">Adicionar documento</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Envie uma foto, PDF ou planilha. A IA prepara os dados e você confirma antes de qualquer lançamento.
        </p>
        {canWrite ? (
          <QuickDocumentUpload />
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Seu acesso é somente leitura.</p>
        )}
      </div>

      <div className="panel mt-5 p-4 md:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Documentos para revisar</h2>
            <p className="text-xs text-muted-foreground">
              Arquivos enviados que ainda precisam ser lidos, revisados ou confirmados por você.
            </p>
          </div>
          <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
            {pending.length}
          </span>
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando documentos…</p>
        ) : null}

        {!loading && pending.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
            <File className="mx-auto size-7 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">Nenhum documento esperando revisão</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Os documentos novos aparecerão aqui até você confirmar o lançamento.
            </p>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {pending.map((doc) => {
            const Icon = iconFor(doc.file_name);
            const busy = busyId === doc.id;
            return (
              <div key={doc.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={doc.file_name}>
                      {doc.file_name}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {new Date(doc.created_at).toLocaleString("pt-BR")}
                      {doc.size_bytes !== null ? ` · ${(doc.size_bytes / 1024 / 1024).toFixed(2)} MB` : ""}
                      {` · ${DOCUMENT_STATUS_LABEL[doc.status] ?? doc.status}`}
                    </p>
                    {doc.status === "failed" && doc.interpretation_error ? (
                      <p className="mt-1 text-[11px] text-destructive">{doc.interpretation_error}</p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => void openFile(doc.storage_path)}
                  >
                    <Download className="size-4" /> Abrir
                  </Button>
                  {canWrite ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-2 text-destructive hover:text-destructive"
                      onClick={() => void remove(doc)}
                    >
                      <Trash2 className="size-4" /> Excluir
                    </Button>
                  ) : null}
                </div>
                {canWrite && (doc.status === "uploaded" || doc.status === "failed") ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 w-full gap-2"
                    disabled={busy}
                    onClick={() => void interpret(doc)}
                  >
                    <Sparkles className="size-4" />
                    {busy ? "Lendo…" : doc.status === "failed" ? "Tentar novamente" : "Ler com IA"}
                  </Button>
                ) : null}
                {doc.status === "processing" ? (
                  <p className="mt-2 text-center text-[11px] text-muted-foreground">A IA está lendo este documento…</p>
                ) : null}
                {canWrite && doc.status === "interpreted" ? (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button size="sm" onClick={() => openReview(doc)}>
                      Revisar e confirmar
                    </Button>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void interpret(doc, true)}>
                      Ler novamente
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {orphans.length > 0 ? (
        <div className="panel mt-5 border-amber-500/20 p-4 md:p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Arquivos para recuperar</h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                Encontramos arquivos enviados anteriormente que ainda não estão cadastrados no Aurelian. Você pode abrir para conferir, recuperar o cadastro ou excluir o arquivo se ele não for mais necessário.
              </p>
            </div>
            <span className="rounded-full border border-amber-500/30 bg-amber-500/5 px-2.5 py-1 text-xs text-amber-500">
              {orphans.length}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {orphans.map((file) => {
              const Icon = iconFor(file.name);
              return (
                <div key={file.path} className="rounded-xl border border-dashed border-amber-500/25 bg-surface p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={file.name}>
                        {file.name}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Arquivo encontrado · cadastro ainda não concluído
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => void openFile(file.path)}>
                      <Download className="size-4" /> Abrir
                    </Button>
                    {canWrite ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-2 text-destructive hover:text-destructive"
                        onClick={() => void removeOrphan(file.path)}
                      >
                        <Trash2 className="size-4" /> Excluir
                      </Button>
                    ) : null}
                  </div>
                  {canWrite ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 w-full gap-2 border-primary/30"
                      onClick={() => void recatalog(file.path, file.name)}
                    >
                      <RefreshCw className="size-4" /> Recuperar arquivo
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {linked.length ? (
        <div className="panel mt-5 p-4 md:p-5">
          <h2 className="text-sm font-semibold">Documentos já lançados</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Estes documentos já estão ligados a um lançamento. Arquivar o documento não apaga o lançamento financeiro.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {linked.map((doc) => {
              const Icon = iconFor(doc.file_name);
              return (
                <div key={doc.id} className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{doc.file_name}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{DOCUMENT_STATUS_LABEL['linked']}</p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {doc.credit_card_purchase_id ? (
                      <Button asChild variant="outline" size="sm">
                        <Link to="/cartoes">Ver lançamento</Link>
                      </Button>
                    ) : (
                      <Button asChild variant="outline" size="sm">
                        <Link to="/lancamentos">Ver lançamento</Link>
                      </Button>
                    )}
                    {canWrite ? (
                      <Button variant="ghost" size="sm" onClick={() => void remove(doc)}>
                        Arquivar
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
