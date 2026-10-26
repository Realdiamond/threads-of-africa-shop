import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { requestResetFn } from "@/backend/customers.functions";
import { AuthField, AuthShell, FormMessage } from "@/components/account-ui";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/account/forgot")({
  head: () => ({
    meta: [
      { title: "Forgot your password — The Threads of Africa" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ForgotPage,
});

function ForgotPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await requestResetFn({ data: { email } });
      if (result.ok) {
        setSent(true);
        return;
      }
      setError(result.message);
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setBusy(false);
  }

  return (
    <AuthShell
      title="Forgot your password?"
      intro="Enter your email address and, if there is an account for it, we will send a link to choose a new password."
    >
      {sent ? (
        <FormMessage kind="success">
          If there is an account for {email}, a link is on its way. It works for an hour.
        </FormMessage>
      ) : (
        <form onSubmit={submit} className="space-y-5" noValidate>
          {error && <FormMessage kind="error">{error}</FormMessage>}
          <AuthField
            id="forgot-email"
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            maxLength={254}
          />
          <Button type="submit" className="w-full rounded-none" disabled={busy}>
            {busy ? "Sending…" : "Send me a link"}
          </Button>
        </form>
      )}
      <p className="mt-6 text-sm">
        <Link to="/account/login" className="underline underline-offset-4">
          Back to log in
        </Link>
      </p>
    </AuthShell>
  );
}
