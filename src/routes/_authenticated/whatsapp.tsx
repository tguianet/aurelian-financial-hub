import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MessageCircle, RefreshCcw, Send, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { PageHeader } from "@/components/finance/PageHeader";
import { KpiCard } from "@/components/finance/KpiCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp Financeiro — Aurelian Finance" }] }),
  component: WhatsAppFinance,
});

type Settings = {
  display_phone_number: string | null;
  phone_number_id: string | null;
  business_account_id: string | null;
  status: "disconnected" | "pending" | "connected" | "error";
  last_webhook_at: string | null;
};

type Command = {
  id: string;
  raw_message: string;
  status: string;
  phone: string | null;
  created_at: string;
  parsed: unknown;
};

function WhatsAppFinance() {
  const { user } = useAuthUser();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [commands, setCommands] = useState<Command[]>([]);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [testMessage, setTestMessage] = useState("Gastei 180 de combustível");

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const settingsQuery = await (supabase as any)
      .from("whatsapp_settings")
      .select("display_phone_number,phone_number_id,business_account_id,status,last_webhook_at")
      .eq("user_id", user.id)
      .maybeSingle();
    const commandsQuery = await supabase
      .from("whatsapp_commands")
      .select("id,raw_message,status,phone,created_at,parsed")
      .eq("user_id", user.id)
      .eq("is_demo", false)
      .order("created_at", { ascending: false })
      .limit(20);

    if (settingsQuery.error) toast.error(settingsQuery.error.message);
    if (commandsQuery.error) toast.error(commandsQuery.error.message);
    const current = (settingsQuery.data ?? null) as Settings | null;
    setSettings(current);
    setCommands((commandsQuery.data ?? []) as Command[]);
    setPhone(current?.display_phone_number ?? "");
    setPhoneNumberId(current?.phone_number_id ?? "");
    setBusinessId(current?.business_account_id ?? "");
    setLoading(false);
  };

  useEffect(() => { void load(); }, [user?.id]);

  const saveSettings = async () => {
    if (!user) { toast.error("Sessão expirada."); return; }
    const payload = {
      user_id: user.id,
      display_phone_number: phone.trim() || null,
      phone_number_id: phoneNumberId.trim() || null,
      business_account_id: businessId.trim() || null,
      status: settings?.status === "connected" ? "connected" : "pending",
    };
    const { error } = await (supabase as any)
      .from("whatsapp_settings")
      .upsert(payload, { onConflict: "user_id" });
    if (error) { toast.error(error.message); return; }
    toast.success("Configuração salva. O token deve ser configurado como secret do backend, nunca nesta tela.");
    await load();
  };

  const simulateCommand = async () => {
    if (!user) { toast.error("Sessão expirada."); return; }
    const message = testMessage.trim();
    if (!message) { toast.error("Digite um comando para testar."); return; }
    const { error } = await supabase.from("whatsapp_commands").insert({
      user_id: user.id,
      is_demo: false,
      phone: phone.trim() || "simulador",
      raw_message: message,
      status: "received",
      parsed: null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Comando colocado na fila de processamento.");
    await load();
  };

  const status = settings?.status ?? "disconnected";
  const received = commands.length;
  const pending = commands.filter((c) => c.status === "received" || c.status === "parsed").length;
  const applied = commands.filter((c) => c.status === "applied").length;

  return (
    <div>
      <PageHeader title="WhatsApp Financeiro" subtitle="Central de integração e fila de comandos financeiros" action={<Button variant="outline" className="gap-2" onClick={load}><RefreshCcw className="size-4" /> Atualizar</Button>} />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Status" value={status === "connected" ? "Conectado" : status === "pending" ? "Aguardando Meta" : "Desconectado"} tone={status === "connected" ? "positive" : "neutral"} />
        <KpiCard label="Comandos recentes" value={String(received)} />
        <KpiCard label="Pendentes / aplicados" value={`${pending} / ${applied}`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="panel p-5">
          <div className="mb-4 flex items-center gap-2"><ShieldCheck className="size-4 text-primary" /><h2 className="text-sm font-semibold">Configuração oficial Meta</h2></div>
          <p className="mb-4 text-xs text-muted-foreground">Salve apenas IDs públicos do WhatsApp Business. Access token, app secret e verify token devem ficar em secrets do backend.</p>
          <div className="grid gap-4">
            <div><Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Número exibido</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+55 17 ..." /></div>
            <div><Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Phone Number ID</Label><Input value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} placeholder="ID fornecido pela Meta" /></div>
            <div><Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">WhatsApp Business Account ID</Label><Input value={businessId} onChange={(e) => setBusinessId(e.target.value)} placeholder="WABA ID" /></div>
            <Button onClick={saveSettings}>Salvar configuração</Button>
          </div>
        </div>

        <div className="panel p-5">
          <div className="mb-4 flex items-center gap-2"><MessageCircle className="size-4 text-primary" /><h2 className="text-sm font-semibold">Testar fila sem WhatsApp real</h2></div>
          <p className="mb-4 text-xs text-muted-foreground">Este simulador não finge conexão. Ele testa a mesma fila que o webhook oficial usará quando as credenciais forem configuradas.</p>
          <Label className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">Comando</Label>
          <Textarea value={testMessage} onChange={(e) => setTestMessage(e.target.value)} rows={4} />
          <Button className="mt-3 gap-2" onClick={simulateCommand}><Send className="size-4" /> Enviar para fila</Button>
        </div>
      </div>

      <div className="panel mt-5 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground"><th className="px-4 py-3">Data</th><th className="px-4 py-3">Origem</th><th className="px-4 py-3">Mensagem</th><th className="px-4 py-3">Status</th></tr></thead>
          <tbody>
            {commands.map((c) => <tr key={c.id} className="border-b border-border/60 last:border-0"><td className="px-4 py-3 text-muted-foreground">{new Date(c.created_at).toLocaleString("pt-BR")}</td><td className="px-4 py-3">{c.phone ?? "—"}</td><td className="px-4 py-3">{c.raw_message}</td><td className="px-4 py-3"><span className="rounded-md bg-muted px-2 py-1 text-xs">{c.status}</span></td></tr>)}
            {!loading && commands.length === 0 ? <tr><td colSpan={4} className="p-8 text-center text-sm text-muted-foreground">Nenhum comando recebido ainda.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
