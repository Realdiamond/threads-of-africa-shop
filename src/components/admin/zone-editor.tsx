import { useMemo, useState } from "react";

import { adminSaveShippingZoneFn } from "@/backend/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { countryName, countryOptions } from "@/lib/countries";
import { centsToInput, parseMoneyToCents } from "@/lib/money-input";
import type { ShippingRateInput, ShippingZoneView } from "@/lib/store-types";

import { adminCall, Field, Notice } from "./admin-ui";

type RateRow = { key: number; name: string; price: string; freeOver: string; estimate: string };

let keyCounter = 0;
const newRate = (partial: Partial<RateRow> = {}): RateRow => ({
  key: (keyCounter += 1),
  name: "",
  price: "",
  freeOver: "",
  estimate: "",
  ...partial,
});

// "7.5" → 750 basis points. Returns null for anything that is not a sensible percentage.
function parseTaxPercent(text: string): number | null {
  const value = text.trim().replace(/%$/, "");
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(value)) return null;
  const bps = Math.round(Number(value) * 100);
  return bps <= 5000 ? bps : null;
}

export function ZoneEditor({
  zone,
  onDone,
  onCancel,
}: {
  zone?: ShippingZoneView | undefined;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(zone?.name ?? "");
  const [restOfWorld, setRestOfWorld] = useState(zone?.restOfWorld ?? false);
  const [tax, setTax] = useState(zone ? String(zone.taxBps / 100) : "0");
  const [countries, setCountries] = useState<Set<string>>(new Set(zone?.countries ?? []));
  const [search, setSearch] = useState("");
  const [rates, setRates] = useState<RateRow[]>(
    zone?.rates.length
      ? zone.rates.map((rate) =>
          newRate({
            name: rate.name,
            price: centsToInput(rate.priceCents),
            freeOver: rate.freeOverCents === null ? "" : centsToInput(rate.freeOverCents),
            estimate: rate.estimate,
          }),
        )
      : [newRate({ name: "Standard delivery" })],
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const options = useMemo(() => countryOptions(), []);
  const shown = options.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()));

  function toggle(code: string) {
    setCountries((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function updateRate(key: number, patch: Partial<RateRow>) {
    setRates((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const taxBps = parseTaxPercent(tax);
    if (taxBps === null) return setError("Tax must be a percentage between 0 and 50, like 7.5.");
    const parsed: ShippingRateInput[] = [];
    for (const [index, row] of rates.entries()) {
      const priceCents = parseMoneyToCents(row.price);
      if (priceCents === null)
        return setError(`Delivery option ${index + 1}: enter a price like 15.00 (0 for free).`);
      let freeOverCents: number | null = null;
      if (row.freeOver.trim()) {
        freeOverCents = parseMoneyToCents(row.freeOver);
        if (freeOverCents === null || freeOverCents === 0) {
          return setError(
            `Delivery option ${index + 1}: the free-delivery amount must be more than 0, or empty.`,
          );
        }
      }
      parsed.push({ name: row.name, priceCents, freeOverCents, estimate: row.estimate });
    }
    setBusy(true);
    try {
      const result = await adminCall(() =>
        adminSaveShippingZoneFn({
          data: {
            id: zone?.id,
            name,
            restOfWorld,
            taxBps,
            countries: restOfWorld ? [] : [...countries].sort(),
            rates: parsed,
          },
        }),
      );
      if (!result.ok) return setError(result.message);
      onDone();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={save}
      className="space-y-5 rounded-lg border-2 border-primary/30 bg-background p-5"
      noValidate
    >
      <h3 className="font-display text-lg">
        {zone ? `Edit “${zone.name}”` : "Add a shipping zone"}
      </h3>
      {error && <Notice kind="error">{error}</Notice>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Zone name"
          htmlFor="zone-name"
          hint="For your own reference, e.g. “Nigeria” or “Europe”."
        >
          <Input
            id="zone-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
          />
        </Field>
        <Field
          label="Tax on items (%)"
          htmlFor="zone-tax"
          hint="Added on top of the item prices at checkout, e.g. 7.5 for 7.5%. Use 0 if you charge none. Ask your accountant what applies."
        >
          <Input
            id="zone-tax"
            inputMode="decimal"
            value={tax}
            onChange={(e) => setTax(e.target.value)}
            className="w-28"
          />
        </Field>
      </div>

      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={restOfWorld}
            onChange={(e) => setRestOfWorld(e.target.checked)}
            className="size-4"
          />
          <span>
            <strong>Rest of the world</strong> — applies to every country not listed in another zone
          </span>
        </label>
        {!restOfWorld && (
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                Countries in this zone: <strong>{countries.size}</strong>
              </p>
              <Input
                aria-label="Search countries"
                placeholder="Search countries"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-56"
              />
            </div>
            {countries.size > 0 && (
              <p className="mb-2 text-xs text-muted-foreground">
                {[...countries].sort().map(countryName).join(", ")}
              </p>
            )}
            <ul className="grid max-h-56 gap-x-4 overflow-y-auto rounded border p-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((country) => (
                <li key={country.code}>
                  <label className="flex items-center gap-2 py-0.5">
                    <input
                      type="checkbox"
                      checked={countries.has(country.code)}
                      onChange={() => toggle(country.code)}
                      className="size-4"
                    />
                    {country.name}
                  </label>
                </li>
              ))}
              {shown.length === 0 && (
                <li className="p-2 text-muted-foreground">No country matches.</li>
              )}
            </ul>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Delivery options</h4>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRates((current) => [...current, newRate()])}
          >
            Add an option
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-2 font-normal">Name</th>
                <th className="pb-2 pr-2 font-normal">Price (USD)</th>
                <th className="pb-2 pr-2 font-normal">Free when items total (USD)</th>
                <th className="pb-2 pr-2 font-normal">Delivery time</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rates.map((row, index) => (
                <tr key={row.key}>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label={`Option ${index + 1} name`}
                      value={row.name}
                      onChange={(e) => updateRate(row.key, { name: e.target.value })}
                      maxLength={60}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label={`Option ${index + 1} price`}
                      inputMode="decimal"
                      value={row.price}
                      onChange={(e) => updateRate(row.key, { price: e.target.value })}
                      className="w-24"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label={`Option ${index + 1} free over`}
                      inputMode="decimal"
                      placeholder="never"
                      value={row.freeOver}
                      onChange={(e) => updateRate(row.key, { freeOver: e.target.value })}
                      className="w-28"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label={`Option ${index + 1} delivery time`}
                      placeholder="e.g. 3–5 business days"
                      value={row.estimate}
                      onChange={(e) => updateRate(row.key, { estimate: e.target.value })}
                      maxLength={60}
                    />
                  </td>
                  <td className="py-1 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      disabled={rates.length === 1}
                      onClick={() =>
                        setRates((current) => current.filter((r) => r.key !== row.key))
                      }
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save zone"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
