import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/admin/admin-ui";

export const Route = createFileRoute("/admin/orders")({ component: OrdersPage });

function OrdersPage() {
  return (
    <>
      <PageHeader title="Orders" />
      <div className="rounded-lg border bg-background p-10 text-center text-sm text-muted-foreground">
        Orders will appear here once online payments are connected.
      </div>
    </>
  );
}
