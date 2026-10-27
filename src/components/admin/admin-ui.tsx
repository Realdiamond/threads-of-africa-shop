import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/order-types";
import { cn } from "@/lib/utils";

// Runs an admin request; if the session has expired, sends the person back to the sign-in page.
export async function adminCall<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNAUTHENTICATED")) window.location.assign("/admin/login");
    if (message.includes("PASSWORD_CHANGE_REQUIRED")) window.location.assign("/admin/account");
    throw error;
  }
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Notice({
  kind = "info",
  children,
  className,
}: {
  kind?: "error" | "success" | "info" | "warning";
  children: ReactNode;
  className?: string;
}) {
  const styles = {
    error: "border-destructive/40 bg-destructive/5 text-destructive",
    success: "border-primary/30 bg-primary/5 text-primary",
    info: "border-border bg-secondary/60 text-foreground",
    warning: "border-amber-500/40 bg-amber-50 text-amber-900",
  } as const;
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={cn("rounded-md border px-3 py-2 text-sm", styles[kind], className)}
    >
      {children}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  active: "border-primary/30 bg-primary/10 text-primary",
  draft: "border-amber-500/40 bg-amber-50 text-amber-900",
  archived: "border-border bg-muted text-muted-foreground",
  invited: "border-amber-500/40 bg-amber-50 text-amber-900",
  disabled: "border-border bg-muted text-muted-foreground",
  owner: "border-primary/30 bg-primary/10 text-primary",
  staff: "border-border bg-secondary text-foreground",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("capitalize", STATUS_STYLES[status])}>
      {status}
    </Badge>
  );
}

const ORDER_STATUS_STYLES: Record<OrderStatus, string> = {
  pending_payment: "border-amber-500/40 bg-amber-50 text-amber-900",
  paid: "border-primary/30 bg-primary/10 text-primary",
  shipped: "border-sky-500/40 bg-sky-50 text-sky-900",
  delivered: "border-border bg-secondary text-foreground",
  cancelled: "border-border bg-muted text-muted-foreground",
  refunded: "border-destructive/30 bg-destructive/5 text-destructive",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", ORDER_STATUS_STYLES[status])}>
      {ORDER_STATUS_LABELS[status]}
    </Badge>
  );
}

export const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
