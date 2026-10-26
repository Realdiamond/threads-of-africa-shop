import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { adminLoginFn } from "@/backend/admin.functions";
import { Notice } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import logoUrl from "@/assets/threads-of-africa-logo.png";

export const Route = createFileRoute("/admin/login")({ component: LoginPage });

function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await adminLoginFn({ data: { email, password } });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // A full page load picks up the new session cookie everywhere.
      window.location.assign("/admin");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/40 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-lg border bg-background p-6 shadow-sm"
      >
        <div className="text-center">
          <img src={logoUrl} alt="The Threads of Africa" className="mx-auto h-24 w-auto" />
          <h1 className="mt-3 font-display text-xl">Admin sign in</h1>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Forgotten your password? Ask an owner to reset it from the Team page.
        </p>
      </form>
    </div>
  );
}
