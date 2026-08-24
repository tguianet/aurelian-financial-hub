import { useEffect, useRef, useState } from "react";
import { Camera, FileSpreadsheet, Loader2, Paperclip, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ACCEPTED = ".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.csv,.xls,.xlsx,.doc,.docx,.txt";

export type UploadedDocument = { name: string; path: string; mimeType: string };

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

  const uploadFiles = async (files: File[]) => {
    if (!files.length || !user) return;
    setUploading(true);
    const added: UploadedDocument[] = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name}: máximo de 20 MB.`);
        continue;
      }

      const name = safeFileName(file.name);
      const path = `${user.id}/inbox/${Date.now()}-${crypto.randomUUID()}-${name}`;
      const mimeType = file.type || "application/octet-stream";
      const { error } = await supabase.storage.from("financial-documents").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: mimeType,
      });

      if (error) {
        toast.error(`Falha ao enviar ${file.name}: ${error.message}`);
        continue;
      }

      added.push({ name: file.name, path, mimeType });
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
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return toast.error("A câmera ainda não está pronta.");

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return toast.error("Não consegui capturar a foto.");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return toast.error("Não consegui gerar a foto.");

    const file = new File([blob], `foto-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`, { type: "image/jpeg" });
    closeCamera();
    await uploadFiles([file]);
  };

  const removeUploaded = async (item: UploadedDocument) => {
    const { error } = await supabase.storage.from("financial-documents").remove([item.path]);
    if (error) return toast.error(error.message);
    updateUploaded(uploaded.filter((entry) => entry.path !== item.path));
    toast.success("Documento removido.");
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
        <Button type="button" variant="outline" className="h-11 gap-2" disabled={uploading} onClick={() => void openCamera()}>
          <Camera className="size-4" /> Tirar foto
        </Button>
        <Button type="button" variant="outline" className="h-11 gap-2" disabled={uploading} onClick={() => fileRef.current?.click()}>
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
