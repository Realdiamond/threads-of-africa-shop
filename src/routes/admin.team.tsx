import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  adminCreateUserFn,
  adminDisableUserFn,
  adminEnableUserFn,
  adminListUsersFn,
  adminResetPasswordFn,
  adminSetRoleFn,
} from "@/backend/admin.functions";
import {
  adminCall,
  Field,
  formatDateTime,
  Notice,
  PageHeader,
  selectClass,
  StatusBadge,
} from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/admin/team")({
  loader: async () => {
    const result = await adminListUsersFn();
    if (!result.ok) throw new Error("FORBIDDEN");
    return result.users;
  },
  component: TeamPage,
});

type Credentials = { email: string; password: string };

function TeamPage() {
  const users = Route.useLoaderData();
  const { admin } = Route.useRouteContext();
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "staff">("staff");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [copied, setCopied] = useState(false);

  async function run<T extends { ok: boolean }>(
    action: () => Promise<T>,
    onOk: (result: Extract<T, { ok: true }>) => void,
  ) {
    setMessage(null);
    const result = await adminCall(action);
    if (!result.ok) {
      setMessage({
        kind: "error",
        text: (result as { message?: string }).message ?? "That did not work.",
      });
      return;
    }
    onOk(result as Extract<T, { ok: true }>);
    await router.invalidate();
  }

  return (
    <>
      <PageHeader
        title="Team"
        description="People who can sign in to this admin. Owners can manage the team; staff can manage products and the shop."
      />
      {message && (
        <Notice kind={message.kind} className="mb-4">
          {message.text}
        </Notice>
      )}
      {credentials && (
        <div className="mb-6 rounded-lg border border-primary/40 bg-primary/5 p-4" role="status">
          <p className="text-sm font-medium">Temporary password for {credentials.email}</p>
          <p className="mt-2 flex flex-wrap items-center gap-3">
            <code className="rounded bg-background px-3 py-1.5 font-mono text-base">
              {credentials.password}
            </code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard?.writeText(credentials.password);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            This is shown only once. Send it to them privately; they will be asked to choose their
            own password when they first sign in.
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() => setCredentials(null)}
          >
            Done
          </Button>
        </div>
      )}

      <form
        className="mb-8 grid gap-4 rounded-lg border bg-background p-5 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end"
        onSubmit={async (event) => {
          event.preventDefault();
          await run(
            () => adminCreateUserFn({ data: { name, email, role } }),
            (result) => {
              setCredentials({ email: result.user.email, password: result.temporaryPassword });
              setCopied(false);
              setName("");
              setEmail("");
            },
          );
        }}
      >
        <Field label="Name" htmlFor="member-name">
          <Input
            id="member-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
          />
        </Field>
        <Field label="Email" htmlFor="member-email">
          <Input
            id="member-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field label="Role" htmlFor="member-role">
          <select
            id="member-role"
            className={selectClass}
            value={role}
            onChange={(e) => setRole(e.target.value as "owner" | "staff")}
          >
            <option value="staff">Staff</option>
            <option value="owner">Owner</option>
          </select>
        </Field>
        <Button type="submit">Add person</Button>
      </form>

      <div className="overflow-x-auto rounded-lg border bg-background">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b bg-secondary/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-normal">Person</th>
              <th className="px-4 py-3 font-normal">Role</th>
              <th className="px-4 py-3 font-normal">Status</th>
              <th className="px-4 py-3 font-normal">Last sign-in</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map((user) => {
              const isYou = user.id === admin?.id;
              return (
                <tr key={user.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium">
                      {user.name}{" "}
                      {isYou && (
                        <span className="text-xs font-normal text-muted-foreground">(you)</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      aria-label={`Role for ${user.name}`}
                      className={`${selectClass} w-28`}
                      value={user.role}
                      onChange={(e) =>
                        void run(
                          () =>
                            adminSetRoleFn({
                              data: { userId: user.id, role: e.target.value as "owner" | "staff" },
                            }),
                          () =>
                            setMessage({
                              kind: "success",
                              text: `${user.name} is now ${e.target.value}.`,
                            }),
                        )
                      }
                    >
                      <option value="staff">Staff</option>
                      <option value="owner">Owner</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={user.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!isYou && user.status !== "disabled" && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Reset the password for ${user.name}? They will be signed out.`,
                              )
                            )
                              return;
                            void run(
                              () => adminResetPasswordFn({ data: { userId: user.id } }),
                              (result) => {
                                setCredentials({
                                  email: user.email,
                                  password: result.temporaryPassword,
                                });
                                setCopied(false);
                              },
                            );
                          }}
                        >
                          Reset password
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Disable ${user.name}? They will be signed out and cannot sign in.`,
                              )
                            )
                              return;
                            void run(
                              () => adminDisableUserFn({ data: { userId: user.id } }),
                              () =>
                                setMessage({ kind: "success", text: `${user.name} was disabled.` }),
                            );
                          }}
                        >
                          Disable
                        </Button>
                      </>
                    )}
                    {!isYou && user.status === "disabled" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          void run(
                            () => adminEnableUserFn({ data: { userId: user.id } }),
                            (result) => {
                              setCredentials({
                                email: user.email,
                                password: result.temporaryPassword,
                              });
                              setCopied(false);
                            },
                          )
                        }
                      >
                        Enable again
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
