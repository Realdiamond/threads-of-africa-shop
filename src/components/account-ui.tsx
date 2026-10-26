import type { ReactNode } from "react";

export const accountFieldClass =
  "w-full rounded-none border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-[invalid=true]:border-destructive";

// The shared frame of the sign-in, sign-up and password pages.
export function AuthShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="site-width mx-auto max-w-md py-12 sm:py-16">
      <p className="eyebrow mb-4 text-muted-foreground">Your account</p>
      <h1 className="page-title leading-tight">{title}</h1>
      {intro && <p className="mt-4 text-sm leading-7 text-muted-foreground">{intro}</p>}
      <div className="mt-8">{children}</div>
    </main>
  );
}

export function AuthField({
  id,
  label,
  type = "text",
  value,
  onChange,
  autoComplete,
  hint,
  required = true,
  maxLength,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  hint?: string;
  required?: boolean;
  maxLength?: number;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        className={accountFieldClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        required={required}
        maxLength={maxLength}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export function FormMessage({
  kind,
  children,
}: {
  kind: "error" | "success";
  children: ReactNode;
}) {
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className={`border p-3 text-sm leading-6 ${kind === "error" ? "border-destructive text-destructive" : "bg-secondary"}`}
    >
      {children}
    </p>
  );
}
