import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isStandalone() {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true;
}

function isIos() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function PwaInstallButton() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      toast.success("Aurelian instalado no celular.");
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  const install = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setInstalled(true);
        setInstallPrompt(null);
      }
      return;
    }

    if (isIos()) {
      toast.message("No iPhone: toque em Compartilhar e depois em Adicionar à Tela de Início.", { duration: 7000 });
      return;
    }

    toast.message("Abra o menu do navegador e escolha Instalar app ou Adicionar à tela inicial.", { duration: 6000 });
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-9 gap-2 border-primary/25 bg-primary/5 px-2.5 text-primary hover:bg-primary/10 sm:px-3"
      onClick={install}
    >
      <Download className="size-4" />
      <span className="hidden md:inline">Instalar app</span>
      <span className="md:hidden">Instalar</span>
    </Button>
  );
}
