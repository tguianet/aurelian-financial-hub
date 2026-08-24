import { useEffect, useState, type ReactNode } from "react";
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
  Menu,
  LogOut,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEntityScope } from "./EntityContext";
import { MobileQuickEntry } from "./MobileQuickEntry";
import { ALL } from "@/lib/finance";

const QUICK_ENTRY_SESSION_KEY = "aurelian_quick_entry_opened";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/lancamentos", label: "Lançamentos", icon: ArrowLeftRight },
  { to: "/entidades", label: "Empresas", icon: Building2 },
  { to: "/contas", label: "Contas", icon: Wallet },
  { to: "/cartoes", label: "Cartões", icon: CreditCard },
  { to: "/pendencias", label: "A pagar / receber", icon: CalendarClock },
  { to: "/orcamento", label: "Orçamento", icon: Target },
  { to: "/reservas", label: "Reservas", icon: PiggyBank },
  { to: "/projecao", label: "Projeção", icon: LineChart },
  { to: "/relatorios", label: "Relatórios", icon: FileBarChart },
  { to: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
] as const;

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="gold-gradient flex size-9 items-center justify-center rounded-xl text-base font-bold text-primary-foreground">A</span>
      <span className="leading-tight">
        <span className="block font-display text-sm font-semibold tracking-wide">Aurelian Finance</span>
        <span className="block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Painel privado</span>
      </span>
    </div>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ to, label, icon: Icon }) => {
        const active = pathname === to;
        return (
          <Link
            key={to}
            to={to}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active ? "bg-primary/12 font-medium text-primary" : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function EntitySelector() {
  const { data, entityId, setEntityId } = useEntityScope();
  return (
    <Select value={entityId} onValueChange={setEntityId}>
      <SelectTrigger className="h-9 w-[190px] border-border bg-surface-2 text-sm"><SelectValue placeholder="Entidade" /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Todas as entidades</SelectItem>
        {data.entities.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}{e.kind === "personal" ? " (pessoal)" : ""}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(QUICK_ENTRY_SESSION_KEY) === "1") return;
      sessionStorage.setItem(QUICK_ENTRY_SESSION_KEY, "1");
      setQuickEntryOpen(true);
    } catch {
      setQuickEntryOpen(true);
    }
  }, []);

  const signOut = async () => {
    try {
      sessionStorage.removeItem(QUICK_ENTRY_SESSION_KEY);
    } catch {
      // Storage pode estar indisponível em ambientes privados/restritos.
    }
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <div className="min-h-screen bg-background">
      <Dialog open={quickEntryOpen} onOpenChange={setQuickEntryOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-primary/25 bg-background p-3 sm:max-w-xl sm:p-5">
          <DialogHeader className="px-1 pt-1">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="size-5 text-primary" /> Lançamento rápido
            </DialogTitle>
            <DialogDescription>
              Fale ou digite. O Aurelian interpreta e pede sua confirmação antes de salvar.
            </DialogDescription>
          </DialogHeader>
          <MobileQuickEntry />
        </DialogContent>
      </Dialog>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar px-4 py-5 lg:flex">
        <Brand />
        <div className="mt-8 flex-1 overflow-y-auto"><NavList /></div>
        <Button variant="ghost" className="justify-start gap-3 text-muted-foreground" onClick={signOut}><LogOut className="size-4" /> Sair</Button>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-border bg-background/85 px-4 backdrop-blur md:px-6">
          <div className="flex items-center gap-2 sm:gap-3">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild><Button variant="ghost" size="icon" className="lg:hidden"><Menu className="size-5" /></Button></SheetTrigger>
              <SheetContent side="left" className="w-72 bg-sidebar px-4 py-5">
                <SheetTitle className="sr-only">Menu</SheetTitle>
                <Brand />
                <div className="mt-8"><NavList onNavigate={() => setOpen(false)} /></div>
                <Button variant="ghost" className="mt-6 w-full justify-start gap-3 text-muted-foreground" onClick={signOut}><LogOut className="size-4" /> Sair</Button>
              </SheetContent>
            </Sheet>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-2 border-primary/30 bg-primary/5 px-2.5 text-primary hover:bg-primary/10 sm:px-3"
              onClick={() => setQuickEntryOpen(true)}
            >
              <Sparkles className="size-4" />
              <span className="hidden sm:inline">Lançamento rápido</span>
              <span className="sm:hidden">Lançar</span>
            </Button>
          </div>
          <EntitySelector />
        </header>
        <main className="px-4 py-6 md:px-6 md:py-8">{children}</main>
      </div>
    </div>
  );
}
