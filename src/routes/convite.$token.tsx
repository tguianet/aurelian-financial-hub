import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/convite/$token")({
  ssr: false,
  component: InvitePage,
});

type InviteInfo = {
  valid: boolean;
  reason: string;
  space_name: string | null;
  recipient_name: string | null;
  role: string | null;
  expires_at: string | null;
};

const db = supabase as any;

function reasonText(reason: string) {
  if (reason === "used") return "Este convite já foi usado.";
  if (reason === "expired") return "Este convite expirou.";
  if (reason === "revoked") return "Este convite foi revogado.";
  return "Este convite não é válido.";
}

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [status, setStatus] = useState<"checking" | "joining" | "ready" | "error" | "auth-disabled" | "already-connected">("checking");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const inspected = await db.rpc("inspect_finance_invite", { p_token: token });
      if (cancelled) return;
      if (inspected.error) {
        setStatus("error");
        setMessage(inspected.error.message);
        return;
      }

      const row = (inspected.data?.[0] ?? null) as InviteInfo | null;
      setInfo(row);
      if (!row?.valid) {
        setStatus("error");
        setMessage(reasonText(row?.reason ?? "not_found"));
        return;
      }

      let session = (await supabase.auth.getSession()).data.session;

      if (session) {
        const existingSpace = await db.rpc("current_finance_space_id");
        if (cancelled) return;
        if (existingSpace.error) {
          setStatus("error");
          setMessage(existingSpace.error.message);
          return;
        }
        if (existingSpace.data) {
          setStatus("already-connected");
          setMessage("Este aparelho já está conectado ao Aurelian. Abra o convite no celular do familiar ou em uma aba anônima/privada.");
          return;
        }
      }

      setStatus("joining");
      if (!session) {
        const anonymous = await supabase.auth.signInAnonymously();
        if (cancelled) return;
        if (anonymous.error) {
          const text = anonymous.error.message || "";
          if (/anonymous|disabled|not enabled/i.test(text)) {
            setStatus("auth-disabled");
            setMessage("O acesso direto por convite precisa da autenticação anônima ativada no backend do Aurelian.");
          } else {
            setStatus("error");
            setMessage(text || "Não consegui iniciar o acesso.");
          }
          return;
        }
        session = anonymous.data.session;
      }

      if (!session) {
        setStatus("error");
        setMessage("Não foi possível criar a sessão de acesso.");
        return;
      }

      const consumed = await db.rpc("consume_finance_invite", { p_token: token });
      if (cancelled) return;
      if (consumed.error) {
        const text = consumed.error.message || "";
        if (/owner_cannot_consume_invite|already_member/i.test(text)) {
          setStatus("already-connected");
          setMessage("Este aparelho já está conectado ao Aurelian. Abra o convite no celular do familiar ou em uma aba anônima/privada.");
        } else {
          setStatus("error");
          setMessage(text);
        }
        return;
      }

      setStatus("ready");
      setTimeout(() => navigate({ to: "/dashboard", replace: true }), 700);
    };

    void run();
    return () => { cancelled = true; };
  }, [navigate, token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-primary/25 bg-card p-6 shadow-xl">
        <span className="gold-gradient mx-auto flex size-12 items-center justify-center rounded-2xl text-xl font-bold text-primary-foreground">A</span>
        <div className="mt-5 text-center">
          {status === "checking" || status === "joining" ? (
            <>
              <Loader2 className="mx-auto size-8 animate-spin text-primary" />
              <h1 className="mt-4 text-xl font-semibold">Entrando no Aurelian</h1>
              <p className="mt-2 text-sm text-muted-foreground">{status === "checking" ? "Validando seu convite..." : `Liberando acesso${info?.recipient_name ? ` para ${info.recipient_name}` : ""}...`}</p>
            </>
          ) : status === "ready" ? (
            <>
              <CheckCircle2 className="mx-auto size-9 text-emerald-500" />
              <h1 className="mt-4 text-xl font-semibold">Acesso liberado</h1>
              <p className="mt-2 text-sm text-muted-foreground">Você já está entrando no financeiro compartilhado.</p>
            </>
          ) : status === "auth-disabled" ? (
            <>
              <ShieldCheck className="mx-auto size-9 text-primary" />
              <h1 className="mt-4 text-xl font-semibold">Falta ativar o acesso direto</h1>
              <p className="mt-2 text-sm text-muted-foreground">{message}</p>
              <p className="mt-3 text-xs text-muted-foreground">O convite está válido. Não precisa criar senha nem compartilhar a senha do proprietário.</p>
            </>
          ) : status === "already-connected" ? (
            <>
              <ShieldCheck className="mx-auto size-9 text-primary" />
              <h1 className="mt-4 text-xl font-semibold">Este aparelho já está conectado</h1>
              <p className="mt-2 text-sm text-muted-foreground">{message}</p>
              <Button className="mt-5 w-full" onClick={() => navigate({ to: "/dashboard", replace: true })}>Voltar ao meu Aurelian</Button>
            </>
          ) : (
            <>
              <XCircle className="mx-auto size-9 text-destructive" />
              <h1 className="mt-4 text-xl font-semibold">Convite indisponível</h1>
              <p className="mt-2 text-sm text-muted-foreground">{message}</p>
            </>
          )}
        </div>
        {status === "error" ? <Button variant="outline" className="mt-5 w-full" onClick={() => navigate({ to: "/auth" })}>Ir para o login</Button> : null}
      </div>
    </div>
  );
}