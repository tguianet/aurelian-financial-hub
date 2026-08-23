import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "positive" | "negative" | "gold";

const toneClass: Record<Tone, string> = {
  neutral: "text-foreground",
  positive: "text-success",
  negative: "text-destructive",
  gold: "text-primary",
};

export function KpiCard({
  label,
  value,
  hint,
  tone = "neutral",
  icon,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("panel p-4 md:p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
      </div>
      <p className={cn("num mt-3 text-xl font-semibold md:text-2xl", toneClass[tone])}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
