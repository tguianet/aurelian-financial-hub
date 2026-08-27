import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { EntityProvider } from "@/components/finance/EntityContext";
import { AppShell } from "@/components/finance/AppShell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    let user = null;
    try {
      const result = await supabase.auth.getUser();
      if (!result.error) user = result.data.user;
    } catch (error) {
      console.warn("[Auth] Não foi possível restaurar o usuário; voltando ao login.", error);
    }

    if (!user) throw redirect({ to: "/auth" });
    return { user };
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
