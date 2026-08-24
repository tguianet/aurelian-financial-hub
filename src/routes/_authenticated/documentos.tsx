import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Download, File, FileSpreadsheet, Image as ImageIcon, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/finance/PageHeader";
import { QuickDocumentUpload } from "@/components/finance/QuickDocumentUpload";
import { Button } from "@/components/ui/button";
import { useAuthUser } from "@/hooks/useAuthUser";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/documentos")({
  head: () => ({ meta: [{ title: "Documentos — Aurelian Finance" }] }),
  component: Documentos,
});

type DocumentFile = {
  name: string;
  id: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_accessed_at: string | null;
  metadata: Record<string, unknown> | null;
};

function iconFor(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(ext ?? "")) return ImageIcon;
  if (["csv", "xls", "xlsx"].includes(ext ?? "")) return FileSpreadsheet;
  return File;
}

function cleanDisplayName(name: string) {
  return name.replace(/^\d+-[0-9a-f-]+-/i, "");
}

function Documentos() {
  const { user } = useAuthUser();
  const [files, setFiles] = useState<DocumentFile[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase.storage.from("financial-documents").list(`${user.id}/inbox`, {
      limit: 100,
      sortBy: { column: "created_at", order: "desc" },
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setFiles((data ?? []) as DocumentFile[]);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const openFile = async (name: string) => {
    if (!user) return;
    const path = `${user.id}/inbox/${name}`;
    const { data, error } = await supabase.storage.from("financial-documents").createSignedUrl(path, 60);
    if (error) { toast.error(error.message); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const remove = async (name: string) => {
    if (!user) return;
    const path = `${user.id}/inbox/${name}`;
    const { error } = await supabase.storage.from("financial-documents").remove([path]);
    if (error) { toast.error(error.message); return; }
    toast.success("Documento excluído.");
    void load();
  };

  return (
    <div>
      <PageHeader
        title="Caixa de documentos"
        subtitle="Notas, recibos, PDFs, planilhas e outros arquivos financeiros privados."
        action={
          <Button variant="outline" size="sm" className="gap-2" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        }
      />

      <div className="panel p-4 md:p-5">
        <h2 className="text-sm font-semibold">Adicionar documento</h2>
        <p className="mt-1 text-xs text-muted-foreground">No celular, “Tirar foto” abre a câmera traseira. “Importar arquivo” aceita PDF, Excel/CSV, Word, TXT e imagens.</p>
        <QuickDocumentUpload />
      </div>

      <div className="panel mt-5 p-4 md:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Aguardando revisão</h2>
            <p className="text-xs text-muted-foreground">Arquivos enviados e ainda não associados automaticamente a um lançamento.</p>
          </div>
          <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">{files.length}</span>
        </div>

        {loading ? <p className="py-8 text-center text-sm text-muted-foreground">Carregando documentos…</p> : null}

        {!loading && !files.length ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
            <File className="mx-auto size-7 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">Nenhum documento pendente</p>
            <p className="mt-1 text-xs text-muted-foreground">Fotografe uma nota ou importe um arquivo para começar.</p>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {files.map((file) => {
            const Icon = iconFor(file.name);
            const size = typeof file.metadata?.size === "number" ? file.metadata.size : null;
            return (
              <div key={file.name} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={cleanDisplayName(file.name)}>{cleanDisplayName(file.name)}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {file.created_at ? new Date(file.created_at).toLocaleString("pt-BR") : "Data indisponível"}
                      {size !== null ? ` · ${(size / 1024 / 1024).toFixed(2)} MB` : ""}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => void openFile(file.name)}>
                    <Download className="size-4" /> Abrir
                  </Button>
                  <Button variant="ghost" size="sm" className="gap-2 text-destructive hover:text-destructive" onClick={() => void remove(file.name)}>
                    <Trash2 className="size-4" /> Excluir
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
