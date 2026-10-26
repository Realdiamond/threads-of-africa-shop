import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";

import { getCustomerFn, loginFn } from "@/backend/customers.functions";
import { AuthField, AuthShell, FormMessage } from "@/components/account-ui";
import { Button } from "@/components/ui/button";
import { safeNext, searchText } from "@/lib/search-params";

export const Route = createFileRoute("/account/login")({
  validateSearch: (search: Record<string, unknown>): { next?: string | undefined } => ({
    next: searchText(search["next"]),
  }),
  beforeLoad: async ({ search }) => {
    if (await getCustomerFn()) throw redirect({ href: safeNext(search.next) });
  },
  head: () => ({
    meta: [{ title: "Log in — The Threads of Africa" }, { name: "robots", content: "noindex" }],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { next } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await loginFn({ data: { email, password } });
      if (result.ok) {
        // A full page load, so everything (including the header) sees the new session.
        window.location.assign(safeNext(next));
        return;
      }
      setError(result.message);
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setBusy(false);
  }

  return (
    <AuthShell title="Log in" intro="Welcome back. Log in to see your orders and check out faster.">
      <form onSubmit={submit} className="space-y-5" noValidate>
        {error && <FormMessage kind="error">{error}</FormMessage>}
        <AuthField
          id="login-email"
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          maxLength={254}
        />
        <AuthField
          id="login-password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          maxLength={200}
        />
        <Button type="submit" className="w-full rounded-none" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </Button>
      </form>
      <p className="mt-6 text-sm">
        <Link to="/account/forgot" className="underline underline-offset-4">
          Forgot your password?
        </Link>
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        New here?{" "}
        <Link to="/account/register" className="underline underline-offset-4">
          Create an account
        </Link>{" "}
        — or just{" "}
        <Link to="/shop" search={{ category: "All" }} className="underline underline-offset-4">
          shop as a guest
        </Link>
        .
      </p>
    </AuthShell>
  );
}
