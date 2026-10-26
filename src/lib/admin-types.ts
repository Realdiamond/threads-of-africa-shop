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

// One line of the "ready to launch?" list on the dashboard.
export type ChecklistItem = {
  id: string;
  label: string;
  // done: finished. todo: needed before launch. warning: works, but needs your attention.
  status: "done" | "todo" | "warning";
  detail: string;
  // Part of the list for completeness but not needed to open the shop.
  optional?: boolean;
  // The admin page where it gets fixed.
  href?: string;
};

export type LaunchChecklist = {
  items: ChecklistItem[];
  // How many of the required items are done, out of how many.
  done: number;
  required: number;
  emailBacklog: { pending: number; failed: number };
};
