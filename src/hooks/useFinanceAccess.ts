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

    const load = async () => {
      if (!user) {
        if (!userLoading) {
          setSpaceId(null);
          setCanWrite(false);
          setIsOwner(false);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      const space = await supabase.rpc("current_finance_space_id");
      const nextSpaceId = space.data ?? null;
      if (!active) return;

      if (!nextSpaceId) {
        setSpaceId(null);
        setCanWrite(false);
        setIsOwner(false);
        setLoading(false);
        return;
      }

      const [write, owner] = await Promise.all([
        supabase.rpc("can_write_finance_space", { p_space_id: nextSpaceId }),
        supabase.rpc("is_finance_space_owner", { p_space_id: nextSpaceId }),
      ]);
      if (!active) return;

      setSpaceId(nextSpaceId);
      setCanWrite(Boolean(write.data));
      setIsOwner(Boolean(owner.data));
      setLoading(false);
    };

    void load();
    return () => {
      active = false;
    };
  }, [user, userLoading]);

  return { spaceId, canWrite, isOwner, loading: loading || userLoading };
}
