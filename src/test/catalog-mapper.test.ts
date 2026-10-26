import { describe, expect, it } from "vitest";

import { centsToAmount, toProduct } from "@/backend/catalog.server";

type Row = Parameters<typeof toProduct>[0];

const now = new Date("2026-10-26T00:00:00Z");

function variant(overrides: Partial<Row["variants"][number]> = {}): Row["variants"][number] {
  return {
    id: "v1",
    productId: "p1",
    sku: "SKU-1",
    title: "M / Forest",
    priceCents: 8500,
    currency: "USD",
    stock: 5,
    selectedOptions: [
      { name: "Size", value: "M" },
      { name: "Color", value: "Forest" },
    ],
    position: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "p1",
    handle: "kofi-heritage-shirt",
    title: "Kofi Heritage Shirt",
    description: "A shirt.",
    categoryId: "c1",
    tags: ["new arrival", "shirt"],
    status: "active",
    sortOrder: 10,
    details: "",
    materialsCare: "",
    version: 1,
    createdAt: now,
    updatedAt: now,
    category: { id: "c1", slug: "men", name: "Men", createdAt: now },
    variants: [variant()],
    images: [
      {
        id: "i1",
        productId: "p1",
        url: "/products/kofi.jpg",
        alt: "",
        position: 0,
        createdAt: now,
      },
    ],
    ...overrides,
  };
}

describe("centsToAmount", () => {
  it("formats minor units as a two-decimal string", () => {
    expect(centsToAmount(12900)).toBe("129.00");
    expect(centsToAmount(8505)).toBe("85.05");
    expect(centsToAmount(0)).toBe("0.00");
  });
});

describe("toProduct", () => {
  it("maps a row to the storefront Product shape", () => {
    const product = toProduct(row());

    expect(product).toMatchObject({
      id: "kofi-heritage-shirt",
      name: "Kofi Heritage Shirt",
      category: "Men",
      color: "Forest",
      tag: "new arrival",
      price: 85,
      currencyCode: "USD",
      image: "/products/kofi.jpg",
    });
    expect(product.variants[0]?.price).toEqual({ amount: "85.00", currencyCode: "USD" });
  });

  it("uses the lowest variant price and aggregates option values in order", () => {
    const product = toProduct(
      row({
        variants: [
          variant({
            id: "a",
            sku: "A",
            priceCents: 9000,
            selectedOptions: [{ name: "Size", value: "S" }],
          }),
          variant({
            id: "b",
            sku: "B",
            priceCents: 8000,
            selectedOptions: [{ name: "Size", value: "M" }],
          }),
          variant({
            id: "c",
            sku: "C",
            priceCents: 8500,
            selectedOptions: [{ name: "Size", value: "S" }],
          }),
        ],
      }),
    );

    expect(product.price).toBe(80);
    expect(product.options).toEqual([{ name: "Size", values: ["S", "M"] }]);
  });

  it("flags variants with no stock as unavailable", () => {
    const product = toProduct(
      row({
        variants: [
          variant({ id: "a", sku: "A", stock: 0 }),
          variant({ id: "b", sku: "B", stock: 2 }),
        ],
      }),
    );

    expect(product.variants.map((v) => v.availableForSale)).toEqual([false, true]);
  });

  it("falls back to the title for missing alt text and empty strings for missing extras", () => {
    const product = toProduct(row({ tags: [], images: [] }));

    expect(product.imageAlt).toBe("Kofi Heritage Shirt");
    expect(product.image).toBe("");
    expect(product.tag).toBe("");
  });
});
