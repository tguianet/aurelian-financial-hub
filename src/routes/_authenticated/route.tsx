import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { EntityProvider } from "@/components/finance/EntityContext";
import { AppShell } from "@/components/finance/AppShell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) throw redirect({ to: "/auth" });
      return { user: data.user };
    } catch (error) {
      if (error && typeof error === "object" && "isRedirect" in error) throw error;
      console.warn("[Auth] Não foi possível restaurar o usuário; voltando ao login.", error);
      throw redirect({ to: "/auth" });
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <EntityProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </EntityProvider>
  );
}
