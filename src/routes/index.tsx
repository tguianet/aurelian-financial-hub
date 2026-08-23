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
    supabase.auth.getSession().then(({ data }) => {
      navigate({ to: data.session ? "/dashboard" : "/auth", replace: true });
    });
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
