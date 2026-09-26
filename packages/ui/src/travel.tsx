import type { ComponentProps, ReactNode } from "react";
import { cn } from "./utils";

export type Tone = "primary" | "success" | "warning" | "danger" | "neutral";

export function Badge({
  children,
  tone = "primary",
  className,
  ...props
}: ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span className={cn("status-badge", `tone-${tone}`, className)} {...props}>
      <span className="status-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

export function Avatar({
  children,
  size = "md",
  muted = false,
}: {
  children: ReactNode;
  size?: "xs" | "sm" | "md" | "lg";
  muted?: boolean;
}) {
  return (
    <span className={cn("avatar", `avatar-${size}`, muted && "avatar-muted")}>
      {children}
    </span>
  );
}

export function BudgetProgress({
  spent,
  total,
  tone = "primary",
  label = "Budget used",
}: {
  spent: number;
  total: number;
  tone?: Tone;
  label?: string;
}) {
  const percentage =
    total > 0 ? Math.min(100, Math.max(0, (spent / total) * 100)) : 0;
  return (
    <div
      className={cn("budget-progress", `progress-${tone}`)}
      role="progressbar"
      aria-label={label}
      aria-valuenow={spent}
      aria-valuemin={0}
      aria-valuemax={total}
    >
      <span style={{ width: `${percentage}%` }} />
    </div>
  );
}
