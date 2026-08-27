import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "./useAuthUser";

export function useFinanceAccess() {
  const { user, loading: userLoading } = useAuthUser();
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const reset = () => {
      setSpaceId(null);
      setCanWrite(false);
      setIsOwner(false);
    };

    const load = async () => {
      if (!user) {
        if (!userLoading && active) {
          reset();
          setLoading(false);
        }
        return;
      }

      if (active) setLoading(true);
      try {
        const space = await supabase.rpc("current_finance_space_id");
        if (space.error) throw space.error;
        const nextSpaceId = space.data ?? null;
        if (!active) return;

        if (!nextSpaceId) {
          reset();
          return;
        }

        const [write, owner] = await Promise.all([
          supabase.rpc("can_write_finance_space", { p_space_id: nextSpaceId }),
          supabase.rpc("is_finance_space_owner", { p_space_id: nextSpaceId }),
        ]);
        if (!active) return;

        setSpaceId(nextSpaceId);
        setCanWrite(!write.error && Boolean(write.data));
        setIsOwner(!owner.error && Boolean(owner.data));
      } catch (error) {
        console.warn("[Finance] Não foi possível carregar as permissões neste navegador.", error);
        if (active) reset();
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [user, userLoading]);

  return { spaceId, canWrite, isOwner, loading: loading || userLoading };
}
