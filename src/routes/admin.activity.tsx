import { createFileRoute } from "@tanstack/react-router";

import { adminActivityFn } from "@/backend/admin.functions";
import { formatDateTime, PageHeader } from "@/components/admin/admin-ui";

export const Route = createFileRoute("/admin/activity")({
  loader: () => adminActivityFn(),
  component: ActivityPage,
});

function ActivityPage() {
  const { entries } = Route.useLoaderData();
  return (
    <>
      <PageHeader
        title="Activity"
        description="Who changed what, newest first. This record cannot be edited."
      />
      <div className="overflow-x-auto rounded-lg border bg-background">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b bg-secondary/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-normal">When</th>
              <th className="px-4 py-3 font-normal">Who</th>
              <th className="px-4 py-3 font-normal">What</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {entries.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                  Nothing has happened yet.
                </td>
              </tr>
            )}
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                  {formatDateTime(entry.createdAt)}
                </td>
                <td className="px-4 py-2">{entry.adminEmail}</td>
                <td className="px-4 py-2">{entry.summary || entry.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
