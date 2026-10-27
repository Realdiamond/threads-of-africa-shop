import { createFileRoute, Link, notFound } from "@tanstack/react-router";

import { adminGetProductFn, adminListCategoriesFn } from "@/backend/admin.functions";
import { PageHeader } from "@/components/admin/admin-ui";
import { ProductForm } from "@/components/admin/product-form";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin/products/$id")({
  loader: async ({ params }) => {
    const [product, categories] = await Promise.all([
      adminGetProductFn({ data: { id: params.id } }),
      adminListCategoriesFn(),
    ]);
    if (!product) throw notFound();
    return { product, categories };
  },
  notFoundComponent: () => (
    <div className="py-10">
      <p className="mb-3">That product does not exist any more.</p>
      <Button asChild>
        <Link to="/admin/products">Back to products</Link>
      </Button>
    </div>
  ),
  component: EditProduct,
});

function EditProduct() {
  const { product, categories } = Route.useLoaderData();
  return (
    <>
      <PageHeader
        title={product.title}
        description="Changes appear in the shop as soon as you save."
      />
      <ProductForm product={product} categories={categories} />
    </>
  );
}
