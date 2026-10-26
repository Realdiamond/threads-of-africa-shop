import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  type ErrorComponentProps,
} from "@tanstack/react-router";

import { getAdminSessionFn } from "@/backend/admin.functions";
import { AdminShell } from "@/components/admin/admin-shell";
import { Notice } from "@/components/admin/admin-ui";

const withoutTrailingSlash = (path: string) => (path.length > 1 ? path.replace(/\/$/, "") : path);

export const Route = createFileRoute("/admin")({
  // Every admin page passes through here: no session means the sign-in page, and someone who
  // still has a temporary password can only reach their account page to replace it.
  beforeLoad: async ({ location }) => {
    const { admin } = await getAdminSessionFn();
    const path = withoutTrailingSlash(location.pathname);
    if (!admin) {
      if (path !== "/admin/login") throw redirect({ to: "/admin/login" });
      return { admin: null };
    }
    if (path === "/admin/login") throw redirect({ to: "/admin" });
    if (admin.status === "invited" && path !== "/admin/account")
      throw redirect({ to: "/admin/account" });
    return { admin };
  },
  head: () => ({
    meta: [
      { title: "Admin — The Threads of Africa" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminLayout,
  errorComponent: AdminError,
});

function AdminLayout() {
  const { admin } = Route.useRouteContext();
  if (!admin) return <Outlet />;
  return (
    <AdminShell admin={admin}>
      <Outlet />
    </AdminShell>
  );
}

function AdminError({ error }: ErrorComponentProps) {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes("UNAUTHENTICATED")) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="mb-4">Your session has ended.</p>
        <a className="underline" href="/admin/login">
          Sign in again
        </a>
      </div>
    );
  }
  if (text.includes("FORBIDDEN")) {
    return (
      <div className="mx-auto max-w-md px-4 py-20">
        <Notice kind="warning">Only owners can open this page.</Notice>
        <Link to="/admin" className="mt-4 inline-block underline">
          Back to the dashboard
        </Link>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-md px-4 py-20">
      <Notice kind="error">
        Something went wrong loading this page. Please refresh and try again.
      </Notice>
      <Link to="/admin" className="mt-4 inline-block underline">
        Back to the dashboard
      </Link>
    </div>
  );
}
