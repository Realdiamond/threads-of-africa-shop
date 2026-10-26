// Shapes shared by the admin server functions and the admin screens (browser-safe).

export type ProductStatus = "draft" | "active" | "archived";

export type AdminProductSummary = {
  id: string;
  handle: string;
  title: string;
  status: ProductStatus;
  category: string;
  imageUrl: string | null;
  variantCount: number;
  minPriceCents: number;
  maxPriceCents: number;
  currency: string;
  totalStock: number;
  updatedAt: string;
};

export type AdminVariant = {
  // Absent on a size row that has not been saved yet.
  id?: string | undefined;
  sku: string;
  size: string;
  color: string;
  priceCents: number;
  stock: number;
};

export type AdminImage = { url: string; alt: string };

export type AdminProduct = {
  id: string;
  version: number;
  handle: string;
  title: string;
  description: string;
  details: string;
  materialsCare: string;
  categoryId: string;
  tags: string[];
  status: ProductStatus;
  sortOrder: number;
  currency: string;
  variants: AdminVariant[];
  images: AdminImage[];
};

export type ProductInput = {
  id?: string | undefined;
  version?: number | undefined;
  handle: string;
  title: string;
  description: string;
  details: string;
  materialsCare: string;
  categoryId: string;
  tags: string[];
  status: ProductStatus;
  sortOrder: number;
  variants: Array<{
    id?: string | undefined;
    sku: string;
    size: string;
    color: string;
    priceCents: number;
    stock: number;
  }>;
  images: AdminImage[];
};

export type AdminCategory = { id: string; slug: string; name: string; productCount: number };
