import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";

import { getCustomerFn, registerFn } from "@/backend/customers.functions";
import { AuthField, AuthShell, FormMessage } from "@/components/account-ui";
import { Button } from "@/components/ui/button";
import { searchText } from "@/lib/search-params";

export const Route = createFileRoute("/account/register")({
  validateSearch: (search: Record<string, unknown>): { email?: string | undefined } => ({
    email: searchText(search["email"]),
  }),
  beforeLoad: async () => {
    if (await getCustomerFn()) throw redirect({ to: "/account" });
  },
  head: () => ({
    meta: [
      { title: "Create an account — The Threads of Africa" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const search = Route.useSearch();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(search.email ?? "");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await registerFn({ data: { email, name } });
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

  if (sent) {
    return (
      <AuthShell title="Check your email">
        <FormMessage kind="success">
          We have sent a link to {email}. Follow it to choose a password and finish creating your
          account. It may take a minute to arrive — check your spam folder too.
        </FormMessage>
        <p className="mt-6 text-sm text-muted-foreground">
          Wrong address?{" "}
          <button
            type="button"
            className="underline underline-offset-4"
            onClick={() => setSent(false)}
          >
            Start again
          </button>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create an account"
      intro="Keep track of your orders and check out faster. You can always buy as a guest instead."
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        {error && <FormMessage kind="error">{error}</FormMessage>}
        <AuthField
          id="register-name"
          label="Your name"
          value={name}
          onChange={setName}
          autoComplete="name"
          maxLength={100}
        />
        <AuthField
          id="register-email"
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          maxLength={254}
          hint="We email you a link to choose your password."
        />
        <Button type="submit" className="w-full rounded-none" disabled={busy}>
          {busy ? "Sending…" : "Create my account"}
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/account/login" className="underline underline-offset-4">
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}
