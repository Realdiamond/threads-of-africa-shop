import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { adminGetSettingsFn, adminUpdateSettingsFn } from "@/backend/admin.functions";
import { adminCall, Field, Notice, PageHeader } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/admin/settings")({
  loader: () => adminGetSettingsFn(),
  component: SettingsPage,
});

function SettingsPage() {
  const settings = Route.useLoaderData();
  const router = useRouter();
  const [form, setForm] = useState({
    storeName: settings.storeName,
    contactEmail: settings.contactEmail,
    whatsappNumber: settings.whatsappNumber,
    instagramUrl: settings.instagramUrl,
    tiktokUrl: settings.tiktokUrl,
    facebookUrl: settings.facebookUrl,
    pinterestUrl: settings.pinterestUrl,
    announcement: settings.announcement,
    lowStockThreshold: String(settings.lowStockThreshold),
  });
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    const threshold = Number(form.lowStockThreshold);
    if (!Number.isInteger(threshold)) {
      setMessage({ kind: "error", text: "The low-stock warning level must be a whole number." });
      return;
    }
    setBusy(true);
    try {
      const result = await adminCall(() =>
        adminUpdateSettingsFn({ data: { ...form, lowStockThreshold: threshold } }),
      );
      if (!result.ok) {
        setMessage({ kind: "error", text: result.message });
        return;
      }
      setForm((current) => ({ ...current, whatsappNumber: result.settings.whatsappNumber }));
      setMessage({
        kind: "success",
        text: "Saved. Visitors see the new details within about 30 seconds.",
      });
      await router.invalidate();
    } catch {
      setMessage({ kind: "error", text: "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Shop settings"
        description="Details shown across the shop: the announcement bar, the footer, the contact page and the WhatsApp button."
      />
      <form onSubmit={save} className="max-w-3xl space-y-8" noValidate>
        {message && <Notice kind={message.kind}>{message.text}</Notice>}

        <section className="space-y-4 rounded-lg border bg-background p-5">
          <h2 className="font-display text-lg">The shop</h2>
          <Field label="Shop name" htmlFor="storeName">
            <Input
              id="storeName"
              value={form.storeName}
              onChange={set("storeName")}
              maxLength={80}
            />
          </Field>
          <Field
            label="Contact email"
            htmlFor="contactEmail"
            hint="Shown to customers. Messages from the contact form and new-order alerts are sent here, and it is the sender address on emails."
          >
            <Input
              id="contactEmail"
              type="email"
              value={form.contactEmail}
              onChange={set("contactEmail")}
            />
          </Field>
          <Field
            label="Announcement bar"
            htmlFor="announcement"
            hint="The thin green strip at the top of every page. Leave empty to hide it."
          >
            <Input
              id="announcement"
              value={form.announcement}
              onChange={set("announcement")}
              maxLength={160}
            />
          </Field>
        </section>

        <section className="space-y-4 rounded-lg border bg-background p-5">
          <h2 className="font-display text-lg">Chat and social media</h2>
          <Field
            label="WhatsApp number"
            htmlFor="whatsapp"
            hint="Include the country code, e.g. +234 801 234 5678. A chat button appears on the shop once this is set. Leave empty to hide it."
          >
            <Input
              id="whatsapp"
              inputMode="tel"
              value={form.whatsappNumber}
              onChange={set("whatsappNumber")}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Instagram link" htmlFor="instagram" hint="Starts with https://">
              <Input
                id="instagram"
                value={form.instagramUrl}
                onChange={set("instagramUrl")}
                placeholder="https://instagram.com/…"
              />
            </Field>
            <Field label="TikTok link" htmlFor="tiktok">
              <Input
                id="tiktok"
                value={form.tiktokUrl}
                onChange={set("tiktokUrl")}
                placeholder="https://tiktok.com/@…"
              />
            </Field>
            <Field label="Facebook link" htmlFor="facebook">
              <Input
                id="facebook"
                value={form.facebookUrl}
                onChange={set("facebookUrl")}
                placeholder="https://facebook.com/…"
              />
            </Field>
            <Field label="Pinterest link" htmlFor="pinterest">
              <Input
                id="pinterest"
                value={form.pinterestUrl}
                onChange={set("pinterestUrl")}
                placeholder="https://pinterest.com/…"
              />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            Only links you fill in appear in the footer.
          </p>
        </section>

        <section className="space-y-4 rounded-lg border bg-background p-5">
          <h2 className="font-display text-lg">Stock</h2>
          <Field
            label="Low-stock warning level"
            htmlFor="threshold"
            hint="The dashboard lists sizes with this many left, or fewer, under “Running low”."
          >
            <Input
              id="threshold"
              inputMode="numeric"
              value={form.lowStockThreshold}
              onChange={set("lowStockThreshold")}
              className="w-24"
            />
          </Field>
        </section>

        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </Button>
      </form>
    </>
  );
}
