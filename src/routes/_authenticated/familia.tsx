import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Copy, Link2, RefreshCw, Send, Shield, UserRoundX, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/familia")({
  ssr: false,
  component: FamilyAccessPage,
});

type Member = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: "owner" | "editor" | "viewer";
  joined_at: string;
  revoked_at: string | null;
  is_self: boolean;
};

type Invite = {
  id: string;
  recipient_name: string;
  role: "editor" | "viewer";
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

type CreatedInvite = { invite_id: string; token: string; expires_at: string };

const db = supabase as any;

function roleLabel(role: string) {
  if (role === "owner") return "Proprietário";
  if (role === "editor") return "Pode editar";
  return "Somente leitura";
}

function FamilyAccessPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [name, setName] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedInvite | null>(null);

  const inviteUrl = useMemo(() => created ? `${window.location.origin}/convite/${created.token}` : "", [created]);

  const load = async () => {
    setLoading(true);
    const [membersResult, invitesResult] = await Promise.all([
      db.rpc("list_finance_family"),
      db.rpc("list_finance_invites"),
    ]);
    setLoading(false);
    if (membersResult.error) toast.error(membersResult.error.message);
    if (invitesResult.error) toast.error(invitesResult.error.message);
    setMembers((membersResult.data ?? []) as Member[]);
    setInvites((invitesResult.data ?? []) as Invite[]);
  };

  useEffect(() => { void load(); }, []);

  const createInvite = async () => {
    if (!name.trim()) { toast.error("Digite o nome da pessoa."); return; }
    setCreating(true);
    const { data, error } = await db.rpc("create_finance_invite", {
      p_recipient_name: name.trim(),
      p_role: role,
      p_expires_hours: 168,
    });
    setCreating(false);
    if (error) { toast.error(error.message); return; }
    const row = (data?.[0] ?? null) as CreatedInvite | null;
    if (!row) { toast.error("Não consegui criar o convite."); return; }
    setCreated(row);
    setName("");
    toast.success("Convite criado. Ele vale por 7 dias e só pode ser usado uma vez.");
    await load();
  };

  const copyInvite = async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    toast.success("Link copiado.");
  };

  const shareWhatsApp = () => {
    if (!inviteUrl) return;
    const text = `Convite para acessar nosso Aurelian Finance: ${inviteUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  };

  const revokeMember = async (userId: string) => {
    const { error } = await db.rpc("revoke_finance_member", { p_user_id: userId });
    if (error) { toast.error(error.message); return; }
    toast.success("Acesso revogado.");
    await load();
  };

  const revokeInvite = async (inviteId: string) => {
    const { error } = await db.rpc("revoke_finance_invite", { p_invite_id: inviteId });
    if (error) { toast.error(error.message); return; }
    toast.success("Convite revogado.");
    if (created?.invite_id === inviteId) setCreated(null);
    await load();
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <div className="flex items-center gap-2 text-primary"><Users className="size-5" /><span className="text-xs font-semibold uppercase tracking-[0.16em]">Acesso compartilhado</span></div>
        <h1 className="mt-2 text-2xl font-semibold">Família</h1>
        <p className="mt-1 text-sm text-muted-foreground">Convide alguém para usar o mesmo financeiro sem compartilhar sua senha. Cada pessoa fica identificada e você pode cortar o acesso a qualquer momento.</p>
      </div>

      <section className="panel p-5">
        <h2 className="font-semibold">Criar convite</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_220px_auto] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="family-name">Nome da pessoa</Label>
            <Input id="family-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Jessica" />
          </div>
          <div className="space-y-1.5">
            <Label>Permissão</Label>
            <Select value={role} onValueChange={(v) => setRole(v as "editor" | "viewer")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="editor">Pode lançar e editar</SelectItem>
                <SelectItem value="viewer">Somente visualizar</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button className="gap-2" onClick={() => void createInvite()} disabled={creating}><Link2 className="size-4" /> {creating ? "Criando..." : "Criar convite"}</Button>
        </div>

        {created ? (
          <div className="mt-5 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">Link pronto</p>
            <p className="mt-2 break-all text-sm">{inviteUrl}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" className="gap-2" onClick={() => void copyInvite()}><Copy className="size-4" /> Copiar link</Button>
              <Button className="gap-2" onClick={shareWhatsApp}><Send className="size-4" /> Enviar no WhatsApp</Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Uso único, válido até {new Date(created.expires_at).toLocaleString("pt-BR")}.</p>
          </div>
        ) : null}
      </section>

      <section className="panel p-5">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="font-semibold">Quem tem acesso</h2><p className="text-xs text-muted-foreground">O proprietário e familiares que aceitaram convite.</p></div>
          <Button variant="ghost" size="sm" className="gap-2" onClick={() => void load()}><RefreshCw className="size-4" /> Atualizar</Button>
        </div>
        <div className="mt-4 space-y-2">
          {loading ? <p className="text-sm text-muted-foreground">Carregando...</p> : members.map((member) => (
            <div key={member.user_id} className="flex flex-col gap-3 rounded-xl border border-border bg-background/55 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2"><strong>{member.full_name || member.email || "Familiar"}</strong>{member.role === "owner" ? <Shield className="size-4 text-primary" /> : null}</div>
                <p className="mt-1 text-xs text-muted-foreground">{roleLabel(member.role)}{member.revoked_at ? " · acesso revogado" : ""}</p>
              </div>
              {!member.is_self && !member.revoked_at ? <Button variant="outline" size="sm" className="gap-2 text-destructive" onClick={() => void revokeMember(member.user_id)}><UserRoundX className="size-4" /> Revogar</Button> : null}
            </div>
          ))}
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="font-semibold">Convites</h2>
        <div className="mt-4 space-y-2">
          {invites.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum convite criado.</p> : invites.map((invite) => {
            const active = !invite.used_at && !invite.revoked_at && new Date(invite.expires_at).getTime() > Date.now();
            return (
              <div key={invite.id} className="flex flex-col gap-2 rounded-xl border border-border bg-background/55 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div><strong>{invite.recipient_name}</strong><p className="mt-1 text-xs text-muted-foreground">{roleLabel(invite.role)} · {invite.used_at ? "Usado" : invite.revoked_at ? "Revogado" : active ? "Ativo" : "Expirado"}</p></div>
                {active ? <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void revokeInvite(invite.id)}>Revogar convite</Button> : null}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
