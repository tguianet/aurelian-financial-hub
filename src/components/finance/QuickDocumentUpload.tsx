import { useRef, useState } from "react";
import { Camera, FileSpreadsheet, Loader2, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ACCEPTED = ".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.csv,.xls,.xlsx,.doc,.docx,.txt";

type Uploaded = { name: string; path: string };

function safeFileName(name: string) {
  const parts = name.split(".");
  const ext = parts.length > 1 ? `.${parts.pop()!.toLowerCase()}` : "";
  const base = parts.join(".") || "arquivo";
  return `${base.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "arquivo"}${ext}`;
}

export function QuickDocumentUpload() {
  const { user } = useAuthUser();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<Uploaded[]>([]);

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length || !user) return;
    setUploading(true);

    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name}: máximo de 20 MB.`);
        continue;
      }

      const name = safeFileName(file.name);
      const path = `${user.id}/inbox/${Date.now()}-${crypto.randomUUID()}-${name}`;
      const { error } = await supabase.storage.from("financial-documents").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || undefined,
      });

      if (error) {
        toast.error(`Falha ao enviar ${file.name}: ${error.message}`);
        continue;
      }

      setUploaded((current) => [...current, { name: file.name, path }]);
      toast.success(`${file.name} salvo na Caixa de documentos.`);
    }

    setUploading(false);
    if (cameraRef.current) cameraRef.current.value = "";
    if (fileRef.current) fileRef.current.value = "";
  };

  const removeUploaded = async (item: Uploaded) => {
    const { error } = await supabase.storage.from("financial-documents").remove([item.path]);
    if (error) return toast.error(error.message);
    setUploaded((current) => current.filter((entry) => entry.path !== item.path));
    toast.success("Documento removido.");
  };

  return (
    <div className="mt-3 rounded-xl border border-border bg-background/55 p-3">
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => void uploadFiles(event.target.files)}
      />
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED}
        multiple
        className="hidden"
        onChange={(event) => void uploadFiles(event.target.files)}
      />

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 gap-2"
          disabled={uploading}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera className="size-4" /> Tirar foto
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 gap-2"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
          Importar arquivo
        </Button>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        Fotos, PDF, Excel/CSV, Word e TXT. Máximo de 20 MB por arquivo. Tudo fica privado na sua conta.
      </p>

      {uploaded.length ? (
        <div className="mt-3 space-y-2">
          {uploaded.map((item) => (
            <div key={item.path} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs">
              <FileSpreadsheet className="size-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <button
                type="button"
                aria-label={`Remover ${item.name}`}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => void removeUploaded(item)}
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
