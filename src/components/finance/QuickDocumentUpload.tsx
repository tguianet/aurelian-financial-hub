import { useEffect, useRef, useState } from "react";
import { Camera, FileSpreadsheet, Loader2, Paperclip, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { rpcErrorMessage } from "@/lib/rpc-error";
import { sha256File } from "@/lib/document-hash";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ACCEPTED = ".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.csv,.xls,.xlsx,.doc,.docx,.txt";

export type UploadedDocument = {
  id?: string | null;
  name: string;
  path: string;
  mimeType: string;
  status?: string;
};

type Props = {
  onDocumentsChange?: (documents: UploadedDocument[]) => void;
};

function safeFileName(name: string) {
  const parts = name.split(".");
  const ext = parts.length > 1 ? `.${parts.pop()!.toLowerCase()}` : "";
  const base = parts.join(".") || "arquivo";
  return `${base.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "arquivo"}${ext}`;
}

export function QuickDocumentUpload({ onDocumentsChange }: Props) {
  const { user } = useAuthUser();
  const { canWrite } = useFinanceAccess();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraFallbackRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<UploadedDocument[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");

  const updateUploaded = (next: UploadedDocument[]) => {
    setUploaded(next);
    onDocumentsChange?.(next);
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  useEffect(() => () => stopCamera(), []);

  const uploadFiles = async (files: File[], source: "camera" | "upload" = "upload") => {
    if (!files.length || !user) return;
    if (!canWrite) { toast.error("Seu acesso é somente leitura."); return; }
    setUploading(true);
    const added: UploadedDocument[] = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name}: máximo de 20 MB.`);
        continue;
      }

      const name = safeFileName(file.name);
      const mimeType = file.type || "application/octet-stream";
      const hash = await sha256File(file);

      const existing = await supabase.rpc("find_financial_document_by_hash", { p_content_hash: hash });
      const found = existing.data?.[0];
      if (found?.document_id) {
        toast.message(`${file.name} já foi enviado neste espaço.`);
        added.push({
          id: found.document_id,
          name: file.name,
          path: found.storage_path,
          mimeType,
          status: found.status,
        });
        continue;
      }

      const path = `${user.id}/inbox/${Date.now()}-${crypto.randomUUID()}-${name}`;
      const { error } = await supabase.storage.from("financial-documents").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: mimeType,
      });

      if (error) {
        toast.error(`Falha ao enviar ${file.name}: ${error.message}`);
        continue;
      }

      const registered = await supabase.rpc("register_financial_document", {
        p_storage_path: path,
        p_file_name: file.name,
        p_mime_type: mimeType,
        p_size_bytes: file.size,
        p_source: source,
        p_content_hash: hash,
      });
      const row = registered.data?.[0];
      if (registered.error || !row?.document_id) {
        await supabase.rpc("mark_financial_document_failed", {
          p_storage_path: path,
          p_file_name: file.name,
        });
        toast.error(`Arquivo enviado, mas a catalogação falhou. ${rpcErrorMessage(registered.error, "Tente de novo.")}`);
        added.push({ id: null, name: file.name, path, mimeType, status: "failed" });
        continue;
      }

      if (row.is_duplicate) {
        if (row.storage_path && row.storage_path !== path) {
          await supabase.storage.from("financial-documents").remove([path]);
        }
        toast.message(`${file.name} já foi enviado neste espaço.`);
        added.push({
          id: row.document_id,
          name: file.name,
          path: row.storage_path || path,
          mimeType,
          status: row.status,
        });
        continue;
      }

      added.push({ id: row.document_id, name: file.name, path: row.storage_path || path, mimeType, status: row.status });
      toast.success(`${file.name} salvo e pronto para leitura.`);
    }

    if (added.length) updateUploaded([...uploaded, ...added]);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (cameraFallbackRef.current) cameraFallbackRef.current.value = "";
  };

  const startCamera = async (mode: "environment" | "user" = facingMode) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      cameraFallbackRef.current?.click();
      return;
    }

    setCameraStarting(true);
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setFacingMode(mode);
    } catch (error) {
      console.warn("Camera indisponível", error);
      toast.error("Não consegui abrir a câmera. Verifique a permissão do navegador.");
    } finally {
      setCameraStarting(false);
    }
  };

  const openCamera = async () => {
    setCameraOpen(true);
    setTimeout(() => void startCamera("environment"), 50);
  };

  const closeCamera = () => {
    stopCamera();
    setCameraOpen(false);
  };

  const switchCamera = async () => {
    const next = facingMode === "environment" ? "user" : "environment";
    await startCamera(next);
  };

  const takePhoto = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) { toast.error("A câmera ainda não está pronta."); return; }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) { toast.error("Não consegui capturar a foto."); return; }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) { toast.error("Não consegui gerar a foto."); return; }

    const file = new File([blob], `foto-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`, { type: "image/jpeg" });
    closeCamera();
    await uploadFiles([file], "camera");
  };

  const removeUploaded = async (item: UploadedDocument) => {
    const linked = item.status === "linked" || item.status === "confirmed";
    if (item.id) {
      const archived = await supabase.rpc("archive_financial_document", { p_id: item.id });
      if (archived.error) {
        toast.error(rpcErrorMessage(archived.error, "Não foi possível arquivar o documento."));
        return;
      }
    }
    if (!linked) {
      const { error } = await supabase.storage.from("financial-documents").remove([item.path]);
      if (error) { toast.error(error.message); return; }
    }
    updateUploaded(uploaded.filter((entry) => entry.path !== item.path && entry.id !== item.id));
    toast.success(linked ? "Documento arquivado. O lançamento foi mantido." : "Documento removido.");
  };

  return (
    <div className="mt-3 rounded-xl border border-border bg-background/55 p-3">
      <Dialog open={cameraOpen} onOpenChange={(open) => (open ? setCameraOpen(true) : closeCamera())}>
        <DialogContent className="max-w-lg border-primary/25 bg-background p-3 sm:p-5">
          <DialogHeader>
            <DialogTitle>Tirar foto</DialogTitle>
            <DialogDescription>Aponte a câmera para a nota, recibo ou documento.</DialogDescription>
          </DialogHeader>
          <div className="overflow-hidden rounded-xl border border-border bg-black">
            <video ref={videoRef} playsInline muted className="aspect-[3/4] w-full object-cover sm:aspect-video" />
            <canvas ref={canvasRef} className="hidden" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="gap-2" onClick={() => void switchCamera()} disabled={cameraStarting}>
              <RefreshCw className="size-4" /> Trocar câmera
            </Button>
            <Button type="button" className="gap-2" onClick={() => void takePhoto()} disabled={cameraStarting || uploading}>
              {cameraStarting ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />} Capturar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <input ref={cameraFallbackRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => void uploadFiles(Array.from(event.target.files ?? []))} />
      <input ref={fileRef} type="file" accept={ACCEPTED} multiple className="hidden" onChange={(event) => void uploadFiles(Array.from(event.target.files ?? []))} />

      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" className="h-11 gap-2" disabled={uploading || !canWrite} onClick={() => void openCamera()}>
          <Camera className="size-4" /> Tirar foto
        </Button>
        <Button type="button" variant="outline" className="h-11 gap-2" disabled={uploading || !canWrite} onClick={() => fileRef.current?.click()}>
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />} Importar arquivo
        </Button>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        Fotos, PDF, Excel/CSV, Word e TXT. Máximo de 20 MB. Com anexo, o botão Interpretar lê o documento com IA.
      </p>

      {uploaded.length ? (
        <div className="mt-3 space-y-2">
          {uploaded.map((item) => (
            <div key={item.path} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs">
              <FileSpreadsheet className="size-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <span className="text-[10px] text-primary">pronto para ler</span>
              <button type="button" aria-label={`Remover ${item.name}`} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => void removeUploaded(item)}>
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
