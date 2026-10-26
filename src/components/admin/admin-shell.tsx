import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { adminLogoutFn } from "@/backend/admin.functions";
import { Button } from "@/components/ui/button";
import emblemUrl from "@/assets/threads-of-africa-emblem.png";

import { adminCall, StatusBadge } from "./admin-ui";

type Admin = { name: string; email: string; role: "owner" | "staff" };

type NavItem = {
  to: string;
  label: string;
  ownerOnly?: boolean;
  exact?: boolean;
  badge?: "messages";
};

const NAV: NavItem[] = [
  { to: "/admin", label: "Dashboard", exact: true },
  { to: "/admin/products", label: "Products" },
  { to: "/admin/categories", label: "Categories" },
  { to: "/admin/orders", label: "Orders" },
  { to: "/admin/messages", label: "Messages", badge: "messages" },
  { to: "/admin/subscribers", label: "Subscribers" },
  { to: "/admin/shipping", label: "Shipping & tax", ownerOnly: true },
  { to: "/admin/pages", label: "Policy pages", ownerOnly: true },
  { to: "/admin/settings", label: "Settings", ownerOnly: true },
  { to: "/admin/activity", label: "Activity" },
  { to: "/admin/team", label: "Team", ownerOnly: true },
  { to: "/admin/account", label: "My account" },
];

export function AdminShell({
  admin,
  newMessages = 0,
  children,
}: {
  admin: Admin;
  newMessages?: number;
  children: ReactNode;
}) {
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await adminCall(() => adminLogoutFn());
    } finally {
      window.location.assign("/admin/login");
    }
  }

  const items = NAV.filter((item) => !item.ownerOnly || admin.role === "owner");

  return (
    <div className="min-h-screen bg-secondary/40 md:flex">
      <aside className="border-b bg-background md:min-h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-3 px-4 py-3 md:block md:py-5">
          <Link to="/admin" className="flex items-center gap-2" aria-label="Admin home">
            <img src={emblemUrl} alt="" className="h-8 w-auto" />
            <span className="font-display text-sm leading-tight">
              Threads of Africa
              <span className="block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Admin
              </span>
            </span>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            className="md:hidden"
            onClick={signOut}
            disabled={signingOut}
          >
            Sign out
          </Button>
        </div>
        <nav
          aria-label="Admin"
          className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0"
        >
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.exact ?? false }}
              className="whitespace-nowrap rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
              activeProps={{ className: "bg-secondary text-foreground font-medium" }}
            >
              {item.label}
              {item.badge === "messages" && newMessages > 0 && (
                <span
                  className="ml-2 rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground"
                  aria-label={`${newMessages} new`}
                >
                  {newMessages}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="hidden border-t px-4 py-4 md:mt-6 md:block">
          <p className="truncate text-sm font-medium">{admin.name}</p>
          <p className="truncate text-xs text-muted-foreground">{admin.email}</p>
          <div className="mt-2 flex items-center gap-2">
            <StatusBadge status={admin.role} />
          </div>
          <div className="mt-4 flex flex-col items-start gap-1">
            <a
              href="/"
              target="_blank"
              rel="noreferrer"
              className="text-xs underline underline-offset-4"
            >
              View the store
            </a>
            <button
              type="button"
              onClick={signOut}
              disabled={signingOut}
              className="text-xs underline underline-offset-4 disabled:opacity-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
    </div>
  );
}
