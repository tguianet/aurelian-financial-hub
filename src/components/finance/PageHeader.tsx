import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold md:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function DemoNotice() {
  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/8 p-3 text-xs text-muted-foreground">
      <span className="rounded-md bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
        Exemplo
      </span>
      <p>
        Os registros marcados como <strong className="text-foreground">Exemplo</strong> são dados de
        demonstração para validar cálculos e fluxo visual. Tudo que você criar é privado e
        substituirá gradualmente a demonstração.
      </p>
    </div>
  );
}
