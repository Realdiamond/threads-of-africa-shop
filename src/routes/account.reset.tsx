import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { resetPasswordFn } from "@/backend/customers.functions";
import { AuthField, AuthShell, FormMessage } from "@/components/account-ui";
import { Button } from "@/components/ui/button";
import { searchText } from "@/lib/search-params";

export const Route = createFileRoute("/account/reset")({
  validateSearch: (search: Record<string, unknown>): { t?: string | undefined } => ({
    t: searchText(search["t"]),
  }),
  head: () => ({
    meta: [
      { title: "Choose a new password — The Threads of Africa" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPage,
});

function ResetPage() {
  const { t } = Route.useSearch();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!t) return;
    if (password !== again) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const result = await resetPasswordFn({ data: { token: t, password } });
      if (result.ok) {
        window.location.assign("/account");
        return;
      }
      setError(result.message);
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setBusy(false);
  }

  if (!t) {
    return (
      <AuthShell title="Link not valid">
        <FormMessage kind="error">
          This link is incomplete. Please use the full link from your email, or{" "}
          <Link to="/account/forgot" className="underline underline-offset-4">
            ask for a new one
          </Link>
          .
        </FormMessage>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      intro="Choose a new password for your account. You will be signed out on other devices."
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        {error && <FormMessage kind="error">{error}</FormMessage>}
        <AuthField
          id="reset-password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint="At least 10 characters."
          maxLength={128}
        />
        <AuthField
          id="reset-again"
          label="Repeat the password"
          type="password"
          value={again}
          onChange={setAgain}
          autoComplete="new-password"
          maxLength={128}
        />
        <Button type="submit" className="w-full rounded-none" disabled={busy}>
          {busy ? "Saving…" : "Save my new password"}
        </Button>
      </form>
    </AuthShell>
  );
}
