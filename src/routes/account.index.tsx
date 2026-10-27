import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  changePasswordFn,
  deleteAccountFn,
  getCustomerFn,
  logoutFn,
  myOrdersFn,
  updateProfileFn,
} from "@/backend/customers.functions";
import { AuthField, FormMessage } from "@/components/account-ui";
import { Button } from "@/components/ui/button";
import {
  formatCents,
  formatOrderNumber,
  ORDER_STATUS_LABELS,
  type OrderListRow,
} from "@/lib/order-types";

export const Route = createFileRoute("/account/")({
  loader: async () => {
    const customer = await getCustomerFn();
    if (!customer) throw redirect({ to: "/account/login" });
    return { customer, orders: await myOrdersFn() };
  },
  head: () => ({
    meta: [
      { title: "Your account — The Threads of Africa" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AccountPage,
});

const date = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function OrdersList({ orders }: { orders: OrderListRow[] }) {
  if (orders.length === 0) {
    return (
      <p className="text-sm leading-7 text-muted-foreground">
        You have not placed an order yet.{" "}
        <Link to="/shop" search={{ category: "All" }} className="underline underline-offset-4">
          Explore the collection
        </Link>
        .
      </p>
    );
  }
  return (
    <ul className="divide-y border-y">
      {orders.map((order) => (
        <li
          key={order.id}
          className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-4 text-sm"
        >
          <Link
            to="/orders/$id"
            params={{ id: order.id }}
            className="font-medium underline underline-offset-4"
          >
            {formatOrderNumber(order.number)}
          </Link>
          <span className="text-muted-foreground">
            {date(order.createdAt)} · {order.itemCount} item{order.itemCount === 1 ? "" : "s"}
          </span>
          <span>{ORDER_STATUS_LABELS[order.status]}</span>
          <span>{formatCents(order.totalCents, order.currency)}</span>
        </li>
      ))}
    </ul>
  );
}

function ProfileForm({ name }: { name: string }) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await updateProfileFn({ data: { name: value } });
      setMessage(
        result.ok ? { kind: "success", text: "Saved." } : { kind: "error", text: result.message },
      );
      if (result.ok) await router.invalidate();
    } catch {
      setMessage({ kind: "error", text: "Something went wrong. Please try again." });
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      <AuthField
        id="profile-name"
        label="Your name"
        value={value}
        onChange={setValue}
        autoComplete="name"
        maxLength={100}
      />
      <Button
        type="submit"
        variant="outline"
        className="rounded-none"
        disabled={busy || value === name}
      >
        Save
      </Button>
    </form>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await changePasswordFn({
        data: { currentPassword: current, newPassword: next },
      });
      if (result.ok) {
        setMessage({
          kind: "success",
          text: "Password changed. You were signed out on other devices.",
        });
        setCurrent("");
        setNext("");
      } else {
        setMessage({ kind: "error", text: result.message });
      }
    } catch {
      setMessage({ kind: "error", text: "Something went wrong. Please try again." });
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      <AuthField
        id="current-password"
        label="Current password"
        type="password"
        value={current}
        onChange={setCurrent}
        autoComplete="current-password"
        maxLength={200}
      />
      <AuthField
        id="new-password"
        label="New password"
        type="password"
        value={next}
        onChange={setNext}
        autoComplete="new-password"
        hint="At least 10 characters."
        maxLength={128}
      />
      <Button
        type="submit"
        variant="outline"
        className="rounded-none"
        disabled={busy || !current || !next}
      >
        Change password
      </Button>
    </form>
  );
}

function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await deleteAccountFn({ data: { password } });
      if (result.ok) {
        window.location.assign("/");
        return;
      }
      setError(result.message);
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        className="rounded-none px-0 text-destructive"
        onClick={() => setOpen(true)}
      >
        Delete my account…
      </Button>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4 border border-destructive p-5" noValidate>
      <p className="text-sm leading-6">
        This removes your account and saved details. Your past orders stay on record with us (we
        need them for refunds and accounts) but are no longer linked to you. This cannot be undone.
      </p>
      {error && <FormMessage kind="error">{error}</FormMessage>}
      <AuthField
        id="delete-password"
        label="Your password"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
        maxLength={200}
      />
      <div className="flex gap-3">
        <Button
          type="submit"
          variant="destructive"
          className="rounded-none"
          disabled={busy || !password}
        >
          Delete my account
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="rounded-none"
          onClick={() => setOpen(false)}
        >
          Keep it
        </Button>
      </div>
    </form>
  );
}

function AccountPage() {
  const { customer, orders } = Route.useLoaderData();

  async function logout() {
    await logoutFn();
    window.location.assign("/");
  }

  return (
    <main className="site-width max-w-3xl py-12 sm:py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-4 text-muted-foreground">Your account</p>
          <h1 className="page-title leading-tight">
            Hello, {customer.name.split(" ")[0] || "there"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{customer.email}</p>
        </div>
        <Button variant="outline" className="rounded-none" onClick={logout}>
          Log out
        </Button>
      </div>

      <section className="mt-12" aria-labelledby="acc-orders">
        <h2 id="acc-orders" className="font-display mb-4 text-2xl">
          Your orders
        </h2>
        <OrdersList orders={orders} />
      </section>

      <section className="mt-12 max-w-md" aria-labelledby="acc-details">
        <h2 id="acc-details" className="font-display mb-4 text-2xl">
          Your details
        </h2>
        <ProfileForm name={customer.name} />
      </section>

      <section className="mt-12 max-w-md" aria-labelledby="acc-password">
        <h2 id="acc-password" className="font-display mb-4 text-2xl">
          Password
        </h2>
        <PasswordForm />
      </section>

      <section className="mt-12 max-w-md" aria-labelledby="acc-delete">
        <h2 id="acc-delete" className="sr-only">
          Delete account
        </h2>
        <DeleteAccount />
      </section>
    </main>
  );
}
