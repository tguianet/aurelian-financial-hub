import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Aurelian Finance — Controle financeiro pessoal e multiempresa" },
      {
        name: "description",
        content:
          "Painel financeiro privado com saldo consolidado, dinheiro livre, contas a pagar e receber, orçamento e projeção de caixa por empresa.",
      },
      { property: "og:title", content: "Aurelian Finance" },
      {
        property: "og:description",
        content:
          "Saldo, dinheiro livre e projeção de caixa consolidados por Pessoal e por empresa.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;

    const redirect = async () => {
      // Após o retorno do login social a sessão pode levar alguns instantes
      // para ser persistida; tentamos algumas vezes antes de mandar ao login.
      for (let i = 0; i < 12; i += 1) {
        try {
          const { data } = await supabase.auth.getSession();
          if (!active) return;
          if (data.session) {
            await navigate({ to: "/dashboard", replace: true });
            return;
          }
        } catch (error) {
          console.warn("[Auth] Aguardando sessão…", error);
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      if (active) await navigate({ to: "/auth", replace: true });
    };


    void redirect();
    return () => {
      active = false;
    };
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="text-center">
        <span className="gold-gradient mx-auto flex size-14 items-center justify-center rounded-2xl text-2xl font-bold text-primary-foreground">
          A
        </span>
        <h1 className="mt-5 text-3xl font-semibold">Aurelian Finance</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Controle financeiro pessoal e multiempresa. Carregando seu painel…
        </p>
      </div>
    </div>
  );
}
