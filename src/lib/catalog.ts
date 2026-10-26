import { queryOptions } from "@tanstack/react-query";

import { listProductsFn } from "@/backend/store.functions";

export type Variant = {
  id: string;
  title: string;
  price: { amount: string; currencyCode: string };
  availableForSale: boolean;
  selectedOptions: Array<{ name: string; value: string }>;
};

export type Product = {
  id: string; // handle
  name: string;
  category: string;
  color: string;
  tag: string;
  description: string;
  price: number;
  currencyCode: string;
  image: string;
  imageAlt: string;
  options: Array<{ name: string; values: string[] }>;
  variants: Variant[];
};

export const money = (value: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);

export const sizeOf = (variant: Variant) =>
  variant.selectedOptions.find((o) => o.name.toLowerCase() === "size")?.value ?? variant.title;

export const productsQueryOptions = queryOptions({
  queryKey: ["catalog", "products"],
  queryFn: () => listProductsFn(),
  staleTime: 60_000,
});
