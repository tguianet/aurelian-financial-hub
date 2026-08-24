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
    <div className="mb-5 flex min-w-0 flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="break-words text-xl font-semibold leading-tight sm:text-2xl md:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground sm:text-sm">{subtitle}</p> : null}
      </div>
      {action ? <div className="w-full sm:w-auto sm:shrink-0 [&>*]:w-full sm:[&>*]:w-auto">{action}</div> : null}
    </div>
  );
}

export function DemoNotice() {
  return (
    <div className="mb-5 flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/8 p-3 text-xs text-muted-foreground sm:mb-6">
      <span className="shrink-0 rounded-md bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
        Exemplo
      </span>
      <p className="min-w-0 leading-relaxed">
        Os registros marcados como <strong className="text-foreground">Exemplo</strong> são dados de
        demonstração para validar cálculos e fluxo visual. Tudo que você criar é privado e
        substituirá gradualmente a demonstração.
      </p>
    </div>
  );
}
