import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  adminConfirmShippingFn,
  adminDeleteShippingZoneFn,
  adminListShippingFn,
} from "@/backend/admin.functions";
import { adminCall, formatDateTime, Notice, PageHeader } from "@/components/admin/admin-ui";
import { ZoneEditor } from "@/components/admin/zone-editor";
import { Button } from "@/components/ui/button";
import { countryName } from "@/lib/countries";
import { centsToInput } from "@/lib/money-input";
import { formatTaxRate, type ShippingZoneView } from "@/lib/store-types";

export const Route = createFileRoute("/admin/shipping")({
  loader: () => adminListShippingFn(),
  component: ShippingPage,
});

function ShippingPage() {
  const { zones, confirmedAt } = Route.useLoaderData();
  const router = useRouter();
  const [editing, setEditing] = useState<ShippingZoneView | "new" | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  async function run(action: () => Promise<{ ok: boolean; message?: string }>, success: string) {
    setMessage(null);
    const result = await adminCall(action);
    if (!result.ok) {
      setMessage({ kind: "error", text: result.message ?? "That did not work." });
      return;
    }
    setMessage({ kind: "success", text: success });
    await router.invalidate();
  }

  return (
    <>
      <PageHeader
        title="Shipping and tax"
        description="Where you deliver, what delivery costs and the tax added at checkout. Customers choose from these options when they pay."
        actions={!editing && <Button onClick={() => setEditing("new")}>Add a zone</Button>}
      />

      {message && (
        <Notice kind={message.kind} className="mb-4">
          {message.text}
        </Notice>
      )}

      {confirmedAt ? (
        <Notice kind="success" className="mb-6">
          An owner confirmed these rates on {formatDateTime(confirmedAt)}.
        </Notice>
      ) : (
        <div className="mb-6 rounded-md border border-amber-500/40 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">These shipping rates have not been confirmed.</p>
          <p className="mt-1">
            The starting rate is only a placeholder. Check every zone, price and tax rate below (ask
            your accountant about tax), then confirm.
          </p>
          <Button
            className="mt-3"
            size="sm"
            onClick={() =>
              run(() => adminConfirmShippingFn(), "Thank you — shipping and tax are confirmed.")
            }
          >
            I have checked these — confirm
          </Button>
        </div>
      )}

      <div className="space-y-4">
        {editing === "new" && (
          <ZoneEditor
            onCancel={() => setEditing(null)}
            onDone={async () => {
              setEditing(null);
              setMessage({
                kind: "success",
                text: "Zone added. Please confirm the rates again once you are happy.",
              });
              await router.invalidate();
            }}
          />
        )}

        {zones.map((zone) =>
          editing && editing !== "new" && editing.id === zone.id ? (
            <ZoneEditor
              key={zone.id}
              zone={zone}
              onCancel={() => setEditing(null)}
              onDone={async () => {
                setEditing(null);
                setMessage({
                  kind: "success",
                  text: "Zone saved. Please confirm the rates again once you are happy.",
                });
                await router.invalidate();
              }}
            />
          ) : (
            <section key={zone.id} className="rounded-lg border bg-background p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg">{zone.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {zone.restOfWorld
                      ? "Every country not listed in another zone"
                      : zone.countries.map(countryName).join(", ")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Tax on items: {formatTaxRate(zone.taxBps)}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" onClick={() => setEditing(zone)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => {
                      if (!window.confirm(`Delete the zone “${zone.name}”?`)) return;
                      void run(
                        () => adminDeleteShippingZoneFn({ data: { zoneId: zone.id } }),
                        "Zone deleted.",
                      );
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
              <ul className="mt-4 divide-y text-sm">
                {zone.rates.map((rate) => (
                  <li
                    key={rate.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 py-2"
                  >
                    <span>
                      {rate.name}
                      {rate.estimate && (
                        <span className="ml-2 text-xs text-muted-foreground">{rate.estimate}</span>
                      )}
                    </span>
                    <span>
                      {rate.priceCents === 0 ? "Free" : `$${centsToInput(rate.priceCents)}`}
                      {rate.freeOverCents !== null && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          free over ${centsToInput(rate.freeOverCents)}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ),
        )}
      </div>

      <p className="mt-6 max-w-2xl text-xs text-muted-foreground">
        If a customer's country is not in any zone and there is no “rest of the world” zone, they
        are told you do not deliver there yet.
      </p>
    </>
  );
}
