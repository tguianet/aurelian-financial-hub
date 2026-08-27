import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ALL, type FinanceDataset } from "@/lib/finance";
import { useFinance } from "@/hooks/useFinance";

interface Ctx {
  data: FinanceDataset;
  isLoading: boolean;
  entityId: string;
  setEntityId: (id: string) => void;
  entityName: string;
}

const EntityCtx = createContext<Ctx | null>(null);
const STORAGE_KEY = "aurelian.entity";

function readStoredEntity() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredEntity(value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Some mobile/private browsers deny storage. Keep the in-memory selection.
  }
}

export function EntityProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useFinance();
  const [entityId, setEntityIdState] = useState<string>(ALL);

  useEffect(() => {
    const saved = readStoredEntity();
    if (saved) setEntityIdState(saved);
  }, []);

  useEffect(() => {
    if (isLoading || entityId === ALL) return;
    const stillExists = data.entities.some((e) => e.id === entityId);
    if (!stillExists) {
      setEntityIdState(ALL);
      writeStoredEntity(ALL);
    }
  }, [data.entities, entityId, isLoading]);

  const setEntityId = (id: string) => {
    const next = id === ALL || data.entities.some((e) => e.id === id) ? id : ALL;
    setEntityIdState(next);
    writeStoredEntity(next);
  };

  const entityName = useMemo(() => {
    if (entityId === ALL) return "Todas as entidades";
    return data.entities.find((e) => e.id === entityId)?.name ?? "Todas as entidades";
  }, [entityId, data.entities]);

  const value = useMemo(
    () => ({ data, isLoading, entityId, setEntityId, entityName }),
    [data, isLoading, entityId, entityName],
  );

  return <EntityCtx.Provider value={value}>{children}</EntityCtx.Provider>;
}

export function useEntityScope() {
  const ctx = useContext(EntityCtx);
  if (!ctx) throw new Error("useEntityScope precisa estar dentro de EntityProvider");
  return ctx;
}
