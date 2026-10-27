import { createFileRoute } from "@tanstack/react-router";

import { adminListCategoriesFn } from "@/backend/admin.functions";
import { PageHeader } from "@/components/admin/admin-ui";
import { ProductForm } from "@/components/admin/product-form";

export const Route = createFileRoute("/admin/products/new")({
  loader: () => adminListCategoriesFn(),
  component: NewProduct,
});

function NewProduct() {
  const categories = Route.useLoaderData();
  return (
    <>
      <PageHeader
        title="Add a product"
        description="Start as a draft while you add photos and sizes, then set it to Active to publish."
      />
      <ProductForm categories={categories} />
    </>
  );
}
