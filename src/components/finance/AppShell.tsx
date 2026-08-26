import { useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ArrowLeftRight,
  Building2,
  Wallet,
  CreditCard,
  CalendarClock,
  Target,
  PiggyBank,
  LineChart,
  FileBarChart,
  MessageCircle,
  FolderOpen,
  Tags,
  Users,
  Repeat2,
  Menu,
  LogOut,
  Sparkles,
  BrainCircuit,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEntityScope } from "./EntityContext";
import { MobileQuickEntry } from "./MobileQuickEntry";
import { QuickDocumentUpload, type UploadedDocument } from "./QuickDocumentUpload";
import { PwaInstallButton } from "./PwaInstallButton";
import { ALL } from "@/lib/finance";

const PRIMARY_NAV = [
  { to: "/dashboard", label: "Início", icon: LayoutDashboard },
  { to: "/lancamentos", label: "Movimentações", icon: ArrowLeftRight },
  { to: "/contas", label: "Meu dinheiro", icon: Wallet },
  { to: "/entidades", label: "Pessoas e empresas", icon: Building2 },
  { to: "/consultor", label: "Aurelian IA", icon: BrainCircuit },
] as const;

const SECONDARY_NAV = [
  { to: "/pendencias", label: "Contas a pagar e receber", icon: CalendarClock },
  { to: "/cartoes", label: "Cartões", icon: CreditCard },
  { to: "/documentos", label: "Documentos", icon: FolderOpen },
  { to: "/recorrencias", label: "Pagamentos recorrentes", icon: Repeat2 },
  { to: "/orcamento", label: "Planejamento mensal", icon: Target },
  { to: "/reservas", label: "Dinheiro reservado", icon: PiggyBank },
  { to: "/projecao", label: "Como meu dinheiro vai ficar", icon: LineChart },
  { to: "/relatorios", label: "Relatórios", icon: FileBarChart },
  { to: "/categorias", label: "Organização por categorias", icon: Tags },
  { to: "/familia", label: "Família", icon: Users },
  { to: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
] as const;

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="gold-gradient flex size-9 items-center justify-center rounded-xl text-base font-bold text-primary-foreground">A</span>
      <span className="leading-tight">
        <span className="block font-display text-sm font-semibold tracking-wide">Aurelian Finance</span>
        <span className="block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Seu dinheiro, sem complicação</span>
      </span>
    </div>
  );
}

function NavItem({ to, label, icon: Icon, onNavigate }: { to: string; label: string; icon: typeof LayoutDashboard; onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = pathname === to;
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
        active ? "bg-primary/12 font-medium text-primary" : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {label}
    </Link>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {PRIMARY_NAV.map((item) => <NavItem key={item.to} {...item} onNavigate={onNavigate} />)}

      <div className="mt-5 px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
        Mais ferramentas
      </div>
      {SECONDARY_NAV.map((item) => <NavItem key={item.to} {...item} onNavigate={onNavigate} />)}
    </nav>
  );
}

function EntitySelector() {
  const { data, entityId, setEntityId } = useEntityScope();
  return (
    <Select value={entityId} onValueChange={setEntityId}>
      <SelectTrigger className="h-10 w-full border-border bg-surface-2 text-sm sm:h-9 sm:w-[220px]">
        <SelectValue placeholder="Ver dinheiro de..." />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Tudo junto</SelectItem>
        {data.entities.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}{e.kind === "personal" ? " (pessoal)" : ""}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      <Dialog open={quickEntryOpen} onOpenChange={setQuickEntryOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] overflow-y-auto rounded-2xl border-primary/25 bg-background p-2 sm:max-h-[90vh] sm:max-w-xl sm:p-5">
          <DialogHeader className="px-2 pt-2 sm:px-1 sm:pt-1">
            <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Sparkles className="size-5 shrink-0 text-primary" /> Registrar movimentação
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Conte o que aconteceu do seu jeito. Você pode digitar, falar ou mandar uma foto/PDF e conferir tudo antes de salvar.
            </DialogDescription>
          </DialogHeader>
          <MobileQuickEntry documents={documents} />
          <QuickDocumentUpload onDocumentsChange={setDocuments} />
        </DialogContent>
      </Dialog>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar px-4 py-5 lg:flex">
        <Brand />
        <div className="mt-8 flex-1 overflow-y-auto"><NavList /></div>
        <Button variant="ghost" className="justify-start gap-3 text-muted-foreground" onClick={signOut}><LogOut className="size-4" /> Sair</Button>
      </aside>

      <div className="min-w-0 lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-border bg-background/92 backdrop-blur">
          <div className="flex min-w-0 flex-col gap-2 px-3 py-2 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4 sm:py-0 md:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <Sheet open={open} onOpenChange={setOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-10 shrink-0 lg:hidden" aria-label="Abrir menu">
                    <Menu className="size-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[88vw] max-w-80 overflow-y-auto bg-sidebar px-4 py-5">
                  <SheetTitle className="sr-only">Menu</SheetTitle>
                  <Brand />
                  <div className="mt-8"><NavList onNavigate={() => setOpen(false)} /></div>
                  <div className="mt-5 border-t border-border pt-4 sm:hidden"><PwaInstallButton /></div>
                  <Button variant="ghost" className="mt-4 w-full justify-start gap-3 text-muted-foreground" onClick={signOut}><LogOut className="size-4" /> Sair</Button>
                </SheetContent>
              </Sheet>

              <Button
                size="sm"
                className="h-10 min-w-0 flex-1 gap-2 px-4 sm:h-9 sm:flex-none"
                onClick={() => setQuickEntryOpen(true)}
              >
                <Sparkles className="size-4 shrink-0" />
                <span className="truncate">+ Registrar</span>
              </Button>

              <div className="hidden sm:block"><PwaInstallButton /></div>
            </div>

            <div className="w-full min-w-0 sm:w-auto sm:shrink-0">
              <EntitySelector />
            </div>
          </div>
        </header>

        <main className="min-w-0 px-3 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-4 sm:py-6 md:px-6 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
