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
  Menu,
  LogOut,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEntityScope } from "./EntityContext";
import { ALL } from "@/lib/finance";

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
] as const;

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="gold-gradient flex size-9 items-center justify-center rounded-xl text-base font-bold text-primary-foreground">
        A
      </span>
      <span className="leading-tight">
        <span className="block font-display text-sm font-semibold tracking-wide">
          Aurelian Finance
        </span>
        <span className="block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Painel privado
        </span>
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
              active
                ? "bg-primary/12 font-medium text-primary"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
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
      <SelectTrigger className="h-9 w-[190px] border-border bg-surface-2 text-sm">
        <SelectValue placeholder="Entidade" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Todas as entidades</SelectItem>
        {data.entities.map((e) => (
          <SelectItem key={e.id} value={e.id}>
            {e.name}
            {e.kind === "personal" ? " (pessoal)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar px-4 py-5 lg:flex">
        <Brand />
        <div className="mt-8 flex-1 overflow-y-auto">
          <NavList />
        </div>
        <Button variant="ghost" className="justify-start gap-3 text-muted-foreground" onClick={signOut}>
          <LogOut className="size-4" /> Sair
        </Button>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-border bg-background/85 px-4 backdrop-blur md:px-6">
          <div className="flex items-center gap-3">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 bg-sidebar px-4 py-5">
                <SheetTitle className="sr-only">Menu</SheetTitle>
                <Brand />
                <div className="mt-8">
                  <NavList onNavigate={() => setOpen(false)} />
                </div>
                <Button
                  variant="ghost"
                  className="mt-6 w-full justify-start gap-3 text-muted-foreground"
                  onClick={signOut}
                >
                  <LogOut className="size-4" /> Sair
                </Button>
              </SheetContent>
            </Sheet>
            <span className="hidden text-xs uppercase tracking-[0.2em] text-muted-foreground sm:block">
              Visão
            </span>
          </div>
          <EntitySelector />
        </header>
        <main className="px-4 py-6 md:px-6 md:py-8">{children}</main>
      </div>
    </div>
  );
}
