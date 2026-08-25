import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Building2, Pencil, Plus, Power } from "lucide-react";
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
import { brl, entitySummaries, monthLabel, pct, today, type FinancialEntity } from "@/lib/finance";
import { clipAiDescription, formatKeywordInput, normalizeCategoryName, parseKeywordInput } from "@/lib/categories";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/entidades")({
  head: () =>
    createFileRouteHead(
      "Empresas e entidades — Aurelian Finance",
      "Saldo, receitas, despesas, resultado e participação de cada empresa no consolidado.",
    ),
  component: Entidades,
});

const DEFAULT_COLORS = ["#E8B923", "#38BDF8", "#A78BFA", "#F97316", "#F43F5E", "#22C55E", "#EAB308"];

const ENTITY_AI_SUGGESTIONS: Record<string, { description: string; keywords: string[] }> = {
  shopee: {
    description: "Receitas e despesas relacionadas às entregas e operações da Shopee.",
    keywords: ["shopee", "entrega", "pacote", "rota", "coleta"],
  },
  softworks: {
    description: "Receitas e despesas de desenvolvimento de software e tecnologia.",
    keywords: ["software", "sistema", "app", "desenvolvimento", "ia", "programação"],
  },
  tguianet: {
    description: "Receitas e despesas da operação comercial da TGuiaNet.",
    keywords: ["tguianet", "marketing", "publicidade", "cliente", "agência"],
  },
};

function suggestionForEntity(name: string) {
  return ENTITY_AI_SUGGESTIONS[normalizeCategoryName(name)] ?? null;
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function Entidades() {
  const { data } = useEntityScope();
  const { user } = useAuthUser();
  const { canWrite } = useFinanceAccess();
  const refresh = useRefreshFinance();
  const ref = today();
  const rows = entitySummaries(data, ref);
  const total = rows.reduce((s, r) => s + r.balance, 0);
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<FinancialEntity | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"personal" | "company">("company");
  const [color, setColor] = useState(DEFAULT_COLORS[0] ?? "#EAB308");
  const [description, setDescription] = useState("");
  const [keywords, setKeywords] = useState("");
  const [suggestionNote, setSuggestionNote] = useState(false);

  const createEntity = async () => {
    if (!user) { toast.error("Sessão expirada."); return; }
    if (!canWrite) { toast.error("Seu acesso é somente leitura."); return; }
    const cleanName = name.trim();
    if (!cleanName) { toast.error("Informe o nome da empresa ou entidade."); return; }
    const slug = slugify(cleanName);
    if (!slug) { toast.error("Nome inválido."); return; }

    setBusy(true);
    const { error } = await supabase.rpc("create_financial_entity", {
      p_name: cleanName,
      p_kind: kind,
      p_color: color,
      p_slug: slug,
    });
    setBusy(false);
    if (error) {
      toast.error(rpcErrorMessage(error, "Não foi possível criar a entidade."));
      return;
    }

    setName("");
    setOpen(false);
    toast.success("Entidade financeira criada.");
    refresh();
  };

  const openEdit = (entity: FinancialEntity) => {
    setEditing(entity);
    setName(entity.name);
    setColor(entity.color);
    const emptyContext = !entity.description && !(entity.ai_keywords ?? []).length;
    const suggestion = emptyContext ? suggestionForEntity(entity.name) : null;
    setDescription(entity.description ?? suggestion?.description ?? "");
    setKeywords(formatKeywordInput(entity.ai_keywords?.length ? entity.ai_keywords : suggestion?.keywords));
    setSuggestionNote(Boolean(suggestion));
    setEditOpen(true);
  };

  const saveEntity = async () => {
    if (!editing) return;
    if (!canWrite) { toast.error("Seu acesso é somente leitura."); return; }
    const cleanName = name.trim();
    if (!cleanName) { toast.error("Informe o nome da empresa ou entidade."); return; }
    setBusy(true);
    const { error } = await supabase.rpc("update_financial_entity", {
      p_id: editing.id,
      p_name: cleanName,
      p_color: color,
      p_description: clipAiDescription(description),
      p_ai_keywords: parseKeywordInput(keywords),
    });
    setBusy(false);
    if (error) {
      toast.error(rpcErrorMessage(error, "Não foi possível atualizar a entidade."));
      return;
    }
    setEditOpen(false);
    setEditing(null);
    toast.success("Entidade atualizada.");
    refresh();
  };

  const toggleActive = async (id: string, current: boolean) => {
    if (!canWrite) { toast.error("Seu acesso é somente leitura."); return; }
    const { error } = await supabase.rpc("toggle_financial_entity_active", { p_id: id });
    if (error) { toast.error(rpcErrorMessage(error, "Não foi possível atualizar a entidade.")); return; }
    toast.success(current ? "Entidade desativada sem apagar o histórico." : "Entidade reativada.");
    refresh();
  };

  return (
    <div>
      <PageHeader
        title="Empresas e entidades financeiras"
        subtitle={`Consolidado de ${monthLabel(ref)} · saldo total ${brl(total)}`}
        action={
          canWrite ? (
          <Dialog open={open} onOpenChange={(next) => {
            setOpen(next);
            if (next) {
              setName("");
              setKind("company");
              setColor(DEFAULT_COLORS[0] ?? "#EAB308");
            }
          }}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="size-4" /> Nova entidade</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Nova entidade financeira</DialogTitle>
                <DialogDescription>
                  Use uma entidade para cada empresa ou núcleo pessoal. Uma conta principal zerada será criada automaticamente.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div>
                  <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Nome</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Nova empresa" autoFocus />
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Tipo</Label>
                  <Select value={kind} onValueChange={(value) => setKind(value as "personal" | "company")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="company">Empresa</SelectItem>
                      <SelectItem value="personal">Pessoal</SelectItem>
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
                <Button onClick={createEntity} disabled={busy}>{busy ? "Criando…" : "Criar entidade"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          ) : undefined
        }
      />

      <div className="mb-4 rounded-lg border border-border bg-surface/60 px-4 py-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Building2 className="size-4 text-primary" />
          Cada entidade tem contas e lançamentos próprios. A visão consolidada elimina dupla contagem de transferências internas.
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <Th>Entidade</Th>
              <Th>Tipo</Th>
              <Th className="text-right">Saldo</Th>
              <Th className="text-right">Receitas do mês</Th>
              <Th className="text-right">Despesas do mês</Th>
              <Th className="text-right">Resultado</Th>
              <Th className="w-48">Participação</Th>
              <Th className="text-right">{canWrite ? "Ações" : "Status"}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.entity.id} className={`border-b border-border/60 last:border-0 hover:bg-surface ${!r.entity.active ? "opacity-55" : ""}`}>
                <Td>
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: r.entity.color }} />
                    <div className="min-w-0">
                      <span className="font-medium">{r.entity.name}</span>
                      {r.entity.description ? (
                        <p className="max-w-xs truncate text-[11px] text-muted-foreground">{r.entity.description}</p>
                      ) : null}
                    </div>
                  </div>
                </Td>
                <Td className="text-muted-foreground">{r.entity.kind === "personal" ? "Pessoal" : "Empresa"}</Td>
                <Td className="num text-right font-medium">{brl(r.balance)}</Td>
                <Td className="num text-right text-success">{brl(r.income)}</Td>
                <Td className="num text-right text-destructive">{brl(r.expense)}</Td>
                <Td className={`num text-right font-medium ${r.result >= 0 ? "text-success" : "text-destructive"}`}>{brl(r.result)}</Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <Progress value={r.share * 100} className="h-1.5" />
                    <span className="num w-12 text-right text-[11px] text-muted-foreground">{pct(r.share)}</span>
                  </div>
                </Td>
                <Td className="text-right">
                  {canWrite ? (
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => openEdit(r.entity)}>
                        <Pencil className="size-3.5" /> Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-2"
                        onClick={() => toggleActive(r.entity.id, r.entity.active)}
                      >
                        <Power className="size-3.5" /> {r.entity.active ? "Ativa" : "Inativa"}
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">{r.entity.active ? "Ativa" : "Inativa"}</span>
                  )}
                </Td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="p-8 text-center text-sm text-muted-foreground">Nenhuma entidade financeira criada.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Desativar uma entidade não apaga lançamentos nem histórico financeiro. O identificador técnico (slug) não muda ao editar o nome.
      </p>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar entidade</DialogTitle>
            <DialogDescription>
              Nome, cor e contexto para a IA. O espaço financeiro e o slug não são alterados.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div>
              <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Tipo</Label>
              <p className="text-sm text-muted-foreground">{editing?.kind === "personal" ? "Pessoal" : "Empresa"}</p>
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
            <div>
              <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Descrição para IA</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Quando esta entidade deve ser escolhida"
                rows={2}
                maxLength={180}
              />
              {suggestionNote ? (
                <p className="mt-1 text-[11px] text-muted-foreground">Sugestão com base no nome. Edite antes de salvar — nada é gravado automaticamente.</p>
              ) : null}
            </div>
            <div>
              <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Palavras-chave / exemplos</Label>
              <Input
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="shopee, entrega, pacote"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={() => void saveEntity()} disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
