import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { adminChangePasswordFn } from "@/backend/admin.functions";
import { adminCall, Field, Notice, PageHeader, StatusBadge } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/admin/account")({ component: AccountPage });

function AccountPage() {
  const { admin } = Route.useRouteContext();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!admin) return null;
  const mustChange = admin.status === "invited";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (next !== confirm) {
      setMessage({ kind: "error", text: "The two new passwords do not match." });
      return;
    }
    setBusy(true);
    try {
      const result = await adminCall(() =>
        adminChangePasswordFn({ data: { currentPassword: current, newPassword: next } }),
      );
      if (!result.ok) {
        setMessage({ kind: "error", text: result.message });
        return;
      }
      if (mustChange) {
        window.location.assign("/admin");
        return;
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      setMessage({
        kind: "success",
        text: "Password changed. Other devices have been signed out.",
      });
    } catch {
      setMessage({ kind: "error", text: "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="My account" />
      {mustChange && (
        <Notice kind="warning" className="mb-6">
          You are using a temporary password. Choose your own to continue — everything else is
          locked until you do.
        </Notice>
      )}
      <div className="mb-8 rounded-lg border bg-background p-5 text-sm">
        <p className="font-medium">{admin.name}</p>
        <p className="text-muted-foreground">{admin.email}</p>
        <div className="mt-2">
          <StatusBadge status={admin.role} />
        </div>
      </div>

      <form onSubmit={submit} className="max-w-md space-y-4 rounded-lg border bg-background p-5">
        <h2 className="font-display text-lg">Change password</h2>
        {message && <Notice kind={message.kind}>{message.text}</Notice>}
        <Field label={mustChange ? "Temporary password" : "Current password"} htmlFor="current">
          <Input
            id="current"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <Field
          label="New password"
          htmlFor="new"
          hint="At least 10 characters. A few words in a row works well."
        >
          <Input
            id="new"
            type="password"
            autoComplete="new-password"
            required
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Field label="Repeat the new password" htmlFor="confirm">
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Change password"}
        </Button>
      </form>
    </>
  );
}
