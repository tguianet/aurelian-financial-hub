import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Pencil, Plus, Power, Search, Tags } from "lucide-react";
import { toast } from "sonner";
import { createFileRouteHead } from "@/lib/head";
import { supabase } from "@/integrations/supabase/client";
import { rpcErrorMessage } from "@/lib/rpc-error";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { useRefreshFinance } from "@/hooks/useFinance";
import { useEntityScope } from "@/components/finance/EntityContext";
import { PageHeader } from "@/components/finance/PageHeader";
import { Td, Th } from "./lancamentos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { normalizeCategoryName } from "@/lib/categories";
import type { Category } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/categorias")({
  head: () =>
    createFileRouteHead(
      "Categorias financeiras — Aurelian Finance",
      "Gerencie categorias de entradas e saídas do espaço financeiro compartilhado.",
    ),
  component: Categorias,
});

const DEFAULT_COLORS = ["#E8B923", "#38BDF8", "#A78BFA", "#F97316", "#F43F5E", "#22C55E", "#EAB308", "#8A8A8A", "#10B981", "#EC4899"];

type KindFilter = "all" | "income" | "expense";
type StatusFilter = "all" | "active" | "inactive";

function duplicateMessage(errorMessage: string) {
  if (/ja existe uma categoria|duplicate|unique/i.test(errorMessage)) {
    return "Já existe uma categoria com esse nome neste espaço.";
  }
  return errorMessage;
}

function Categorias() {
  const { data } = useEntityScope();
  const { user } = useAuthUser();
  const { canWrite } = useFinanceAccess();
  const refresh = useRefreshFinance();

  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Category["kind"]>("expense");
  const [color, setColor] = useState(DEFAULT_COLORS[0] ?? "#E8B923");

  const rows = useMemo(() => {
    const q = normalizeCategoryName(query);
    return data.categories
      .filter((category) => (kindFilter === "all" ? true : category.kind === kindFilter))
      .filter((category) => {
        if (statusFilter === "active") return category.active !== false;
        if (statusFilter === "inactive") return category.active === false;
        return true;
      })
      .filter((category) => !q || normalizeCategoryName(category.name).includes(q))
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "income" ? -1 : 1;
        return a.name.localeCompare(b.name, "pt-BR");
      });
  }, [data.categories, kindFilter, query, statusFilter]);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setKind("expense");
    setColor(DEFAULT_COLORS[0] ?? "#E8B923");
    setOpen(true);
  };

  const openEdit = (category: Category) => {
    setEditing(category);
    setName(category.name);
    setKind(category.kind);
    setColor(category.color);
    setOpen(true);
  };

  const save = async () => {
    if (!user) { toast.error("Sessão expirada."); return; }
    if (!canWrite) { toast.error("Seu acesso é somente leitura."); return; }
    const cleanName = name.trim();
    if (!cleanName) { toast.error("Informe o nome da categoria."); return; }

    const duplicate = data.categories.some((category) =>
      category.id !== editing?.id
      && category.kind === kind
      && normalizeCategoryName(category.name) === normalizeCategoryName(cleanName),
    );
    if (duplicate) {
      toast.error("Já existe uma categoria com esse nome neste espaço.");
      return;
    }

    setBusy(true);
    if (editing) {
      const { error } = await supabase.rpc("update_category", {
        p_id: editing.id,
        p_name: cleanName,
        p_kind: kind,
        p_color: color,
      });
      setBusy(false);
      if (error) { toast.error(duplicateMessage(rpcErrorMessage(error, "Não foi possível atualizar a categoria."))); return; }
      toast.success("Categoria atualizada.");
    } else {
      const { error } = await supabase.rpc("create_category", {
        p_name: cleanName,
        p_kind: kind,
        p_color: color,
      });
      setBusy(false);
      if (error) { toast.error(duplicateMessage(rpcErrorMessage(error, "Não foi possível criar a categoria."))); return; }
      toast.success("Categoria criada.");
    }

    setOpen(false);
    refresh();
  };

  const toggleActive = async (category: Category) => {
    if (!canWrite) { toast.error("Seu acesso é somente leitura."); return; }
    const next = category.active === false;
    const { error } = await supabase.rpc("toggle_category_active", { p_id: category.id });
    if (error) { toast.error(rpcErrorMessage(error, "Não foi possível atualizar a categoria.")); return; }
    toast.success(next ? "Categoria reativada." : "Categoria desativada. O histórico continua visível.");
    refresh();
  };

  const FilterChip = ({
    current,
    value,
    label,
    onClick,
  }: {
    current: string;
    value: string;
    label: string;
    onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-10 rounded-full border px-3 text-xs font-medium transition-colors ${
        current === value
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-border bg-surface text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <PageHeader
        title="Categorias financeiras"
        subtitle="Classifique entradas e saídas do espaço compartilhado. Desativar preserva o histórico."
        action={
          canWrite ? (
            <Button className="gap-2" onClick={openCreate}>
              <Plus className="size-4" /> Nova categoria
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 rounded-lg border border-border bg-surface/60 px-4 py-3 text-xs text-muted-foreground">
        <div className="flex items-start gap-2">
          <Tags className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>
            Categorias inativas continuam aparecendo em lançamentos antigos, mas não entram em novos registros.
            {!canWrite ? " Seu acesso é somente leitura." : null}
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nome"
            className="h-11 pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterChip current={kindFilter} value="all" label="Todas" onClick={() => setKindFilter("all")} />
          <FilterChip current={kindFilter} value="income" label="Entradas" onClick={() => setKindFilter("income")} />
          <FilterChip current={kindFilter} value="expense" label="Saídas" onClick={() => setKindFilter("expense")} />
          <FilterChip current={statusFilter} value="all" label="Todas as situações" onClick={() => setStatusFilter("all")} />
          <FilterChip current={statusFilter} value="active" label="Ativas" onClick={() => { setStatusFilter("active"); }} />
          <FilterChip current={statusFilter} value="inactive" label="Inativas" onClick={() => setStatusFilter("inactive")} />
        </div>
      </div>

      <div className="grid gap-3 md:hidden">
        {rows.map((category) => (
          <article key={category.id} className={`rounded-2xl border border-border bg-card p-4 ${category.active === false ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: category.color }} />
                  <h2 className="truncate font-medium">{category.name}</h2>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="outline">{category.kind === "income" ? "Entrada" : "Saída"}</Badge>
                  <Badge variant={category.active === false ? "secondary" : "default"}>
                    {category.active === false ? "Inativa" : "Ativa"}
                  </Badge>
                </div>
              </div>
              {canWrite ? (
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(category)} aria-label="Editar">
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => void toggleActive(category)} aria-label={category.active === false ? "Reativar" : "Desativar"}>
                    <Power className="size-4" />
                  </Button>
                </div>
              ) : null}
            </div>
          </article>
        ))}
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nenhuma categoria encontrada.
            {canWrite ? <> Crie uma ou volte ao <Link to="/orcamento" className="text-primary underline-offset-2 hover:underline">orçamento</Link>.</> : null}
          </div>
        ) : null}
      </div>

      <div className="panel hidden overflow-x-auto md:block">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <Th>Nome</Th>
              <Th>Tipo</Th>
              <Th>Cor</Th>
              <Th>Status</Th>
              {canWrite ? <Th className="text-right">Ações</Th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((category) => (
              <tr key={category.id} className={`border-b border-border/60 last:border-0 hover:bg-surface ${category.active === false ? "opacity-55" : ""}`}>
                <Td>
                  <div className="flex items-center gap-2 font-medium">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: category.color }} />
                    {category.name}
                  </div>
                </Td>
                <Td className="text-muted-foreground">{category.kind === "income" ? "Entrada" : "Saída"}</Td>
                <Td className="font-mono text-xs text-muted-foreground">{category.color}</Td>
                <Td>{category.active === false ? "Inativa" : "Ativa"}</Td>
                {canWrite ? (
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => openEdit(category)}>
                        <Pencil className="size-3.5" /> Editar
                      </Button>
                      <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void toggleActive(category)}>
                        <Power className="size-3.5" /> {category.active === false ? "Reativar" : "Desativar"}
                      </Button>
                    </div>
                  </Td>
                ) : null}
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={canWrite ? 5 : 4} className="p-8 text-center text-sm text-muted-foreground">
                  Nenhuma categoria encontrada.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar categoria" : "Nova categoria"}</DialogTitle>
            <DialogDescription>
              O nome precisa ser único no espaço para o mesmo tipo (entrada ou saída).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div>
              <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Nome</Label>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Combustível" autoFocus />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Tipo</Label>
              <Select value={kind} onValueChange={(value) => setKind(value as Category["kind"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="income">Entrada</SelectItem>
                  <SelectItem value="expense">Saída</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Cor</Label>
              <div className="flex flex-wrap gap-2">
                {DEFAULT_COLORS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setColor(item)}
                    className={`size-8 rounded-full border-2 ${color === item ? "border-foreground" : "border-transparent"}`}
                    style={{ backgroundColor: item }}
                    aria-label={`Selecionar cor ${item}`}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => void save()} disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
