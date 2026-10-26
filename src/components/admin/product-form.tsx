import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";

import {
  adminDeleteProductFn,
  adminSaveCategoryFn,
  adminSaveProductFn,
  adminSetProductStatusFn,
} from "@/backend/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AdminCategory, AdminProduct, ProductInput, ProductStatus } from "@/lib/admin-types";
import { centsToInput, parseMoneyToCents, parseWholeNumber } from "@/lib/money-input";
import { slugify } from "@/lib/slug";

import { adminCall, Field, Notice, selectClass, StatusBadge } from "./admin-ui";
import { prepareImage, uploadImage } from "./image-tools";

type VariantRow = {
  key: string;
  id?: string | undefined;
  size: string;
  color: string;
  sku: string;
  price: string;
  stock: string;
};
type ImageRow = { key: string; url: string; alt: string };

let rowCounter = 0;
const nextKey = () => `row-${(rowCounter += 1)}`;

const STANDARD_SIZES = ["XS", "S", "M", "L", "XL"];

function variantRows(product?: AdminProduct): VariantRow[] {
  return (product?.variants ?? []).map((v) => ({
    key: nextKey(),
    id: v.id,
    size: v.size,
    color: v.color,
    sku: v.sku,
    price: centsToInput(v.priceCents),
    stock: String(v.stock),
  }));
}

export function ProductForm({
  product,
  categories: initialCategories,
}: {
  product?: AdminProduct | undefined;
  categories: AdminCategory[];
}) {
  const router = useRouter();
  const navigate = useNavigate();
  const isNew = !product;

  const [categories, setCategories] = useState(initialCategories);
  const [title, setTitle] = useState(product?.title ?? "");
  const [handle, setHandle] = useState(product?.handle ?? "");
  const [handleEdited, setHandleEdited] = useState(!isNew);
  const [description, setDescription] = useState(product?.description ?? "");
  const [details, setDetails] = useState(product?.details ?? "");
  const [materialsCare, setMaterialsCare] = useState(product?.materialsCare ?? "");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? categories[0]?.id ?? "");
  const [tags, setTags] = useState((product?.tags ?? []).join(", "));
  const [status, setStatus] = useState<ProductStatus>(product?.status ?? "draft");
  // The status as stored in the database, as opposed to what the dropdown currently says.
  const [savedStatus, setSavedStatus] = useState<ProductStatus | undefined>(product?.status);
  const [sortOrder, setSortOrder] = useState(String(product?.sortOrder ?? 100));
  const [rows, setRows] = useState<VariantRow[]>(() => variantRows(product));
  const [images, setImages] = useState<ImageRow[]>(() =>
    (product?.images ?? []).map((image) => ({ key: nextKey(), ...image })),
  );
  const [version, setVersion] = useState(product?.version);

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [message, setMessage] = useState<{
    kind: "error" | "success";
    text: string;
    conflict?: boolean;
  } | null>(null);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [categoryMessage, setCategoryMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  function changeTitle(value: string) {
    setTitle(value);
    if (!handleEdited) setHandle(slugify(value));
  }

  function updateRow(key: string, patch: Partial<VariantRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addRow() {
    const last = rows.at(-1);
    setRows((current) => [
      ...current,
      {
        key: nextKey(),
        size: "",
        color: last?.color ?? "",
        sku: "",
        price: last?.price ?? "",
        stock: "0",
      },
    ]);
  }

  function addStandardSizes() {
    const existing = new Set(rows.map((row) => row.size.trim().toUpperCase()));
    const template = rows[0];
    const prefix =
      (handle || "item")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 12) || "ITEM";
    const added = STANDARD_SIZES.filter((size) => !existing.has(size)).map((size) => ({
      key: nextKey(),
      size,
      color: template?.color ?? "",
      sku: `${prefix}-${size}`,
      price: template?.price ?? "",
      stock: "0",
    }));
    setRows((current) => [...current, ...added]);
  }

  async function addPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadErrors([]);
    const room = 10 - images.length;
    const chosen = Array.from(files).slice(0, Math.max(room, 0));
    if (files.length > chosen.length) setUploadErrors(["A product can have up to 10 photos."]);
    for (const file of chosen) {
      setUploading((count) => count + 1);
      try {
        const url = await uploadImage(await prepareImage(file), file.name);
        setImages((current) => [...current, { key: nextKey(), url, alt: title }]);
      } catch (error) {
        const text = error instanceof Error ? error.message : "The upload failed.";
        setUploadErrors((current) => [...current, `${file.name}: ${text}`]);
      } finally {
        setUploading((count) => count - 1);
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  function moveImage(index: number, direction: -1 | 1) {
    setImages((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  async function addCategory() {
    setCategoryMessage("");
    const result = await adminCall(() => adminSaveCategoryFn({ data: { name: newCategory } }));
    if (!result.ok) {
      setCategoryMessage(result.message);
      return;
    }
    setCategories((current) =>
      [...current, result.category].sort((a, b) => a.name.localeCompare(b.name)),
    );
    setCategoryId(result.category.id);
    setNewCategory("");
  }

  function buildInput(): ProductInput | string {
    const variants: ProductInput["variants"] = [];
    for (const [index, row] of rows.entries()) {
      const priceCents = parseMoneyToCents(row.price);
      const stock = parseWholeNumber(row.stock);
      if (priceCents === null) return `Size row ${index + 1}: enter a price like 129.00.`;
      if (stock === null) return `Size row ${index + 1}: stock must be a whole number, like 10.`;
      variants.push({
        id: row.id,
        sku: row.sku,
        size: row.size,
        color: row.color,
        priceCents,
        stock,
      });
    }
    const order = parseWholeNumber(sortOrder);
    if (order === null) return "The display order must be a whole number.";
    return {
      id: product?.id,
      version,
      handle,
      title,
      description,
      details,
      materialsCare,
      categoryId,
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      status,
      sortOrder: order,
      variants,
      images: images.map(({ url, alt }) => ({ url, alt })),
    };
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    const input = buildInput();
    if (typeof input === "string") {
      setMessage({ kind: "error", text: input });
      return;
    }
    if (!categoryId) {
      setMessage({ kind: "error", text: "Choose a category, or add one below the category box." });
      return;
    }
    setSaving(true);
    try {
      const result = await adminCall(() => adminSaveProductFn({ data: input }));
      if (!result.ok) {
        setMessage({ kind: "error", text: result.message, conflict: result.code === "CONFLICT" });
        return;
      }
      setVersion(result.version);
      if (isNew) {
        await navigate({ to: "/admin/products/$id", params: { id: result.id } });
      } else {
        setSavedStatus(input.status);
        setMessage({ kind: "success", text: "Saved." });
        await router.invalidate();
      }
    } catch {
      setMessage({
        kind: "error",
        text: "Something went wrong while saving. Nothing was lost; please try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(next: ProductStatus) {
    if (!product) return;
    setMessage(null);
    const result = await adminCall(() =>
      adminSetProductStatusFn({ data: { id: product.id, status: next } }),
    );
    if (!result.ok) {
      setMessage({ kind: "error", text: result.message });
      return;
    }
    setSavedStatus(next);
    setStatus(next);
    setVersion(result.version);
    setMessage({
      kind: "success",
      text:
        next === "active" ? "Published." : next === "archived" ? "Archived." : "Moved to drafts.",
    });
    await router.invalidate();
  }

  async function remove() {
    if (!product) return;
    if (!window.confirm(`Delete "${product.title}" for good? This cannot be undone.`)) return;
    const result = await adminCall(() => adminDeleteProductFn({ data: { id: product.id } }));
    if (!result.ok) {
      setMessage({ kind: "error", text: result.message });
      return;
    }
    await navigate({ to: "/admin/products" });
  }

  return (
    <form onSubmit={save} className="space-y-8" noValidate>
      {message && (
        <Notice kind={message.kind}>
          {message.text}
          {message.conflict && (
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => window.location.reload()}
            >
              Reload now
            </button>
          )}
        </Notice>
      )}

      <section className="space-y-4 rounded-lg border bg-background p-5">
        <h2 className="font-display text-lg">Basics</h2>
        <Field label="Product name" htmlFor="title">
          <Input
            id="title"
            value={title}
            onChange={(e) => changeTitle(e.target.value)}
            maxLength={120}
            required
          />
        </Field>
        <Field
          label="Web address"
          htmlFor="handle"
          hint={
            <>
              Appears in the link: <span className="font-mono">/product/{handle || "…"}</span>.
              Changing it breaks links that were already shared.
            </>
          }
        >
          <Input
            id="handle"
            value={handle}
            onChange={(e) => {
              setHandleEdited(true);
              setHandle(e.target.value);
            }}
            maxLength={100}
            className="font-mono text-sm"
          />
        </Field>
        <Field
          label="Description"
          htmlFor="description"
          hint="The short story shown beside the photos."
        >
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={5000}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Fit and details"
            htmlFor="details"
            hint="Fit notes, measurements, model height. Leave empty to use the standard text."
          >
            <Textarea
              id="details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={4}
              maxLength={3000}
            />
          </Field>
          <Field
            label="Fabric and care"
            htmlFor="care"
            hint="Materials, washing instructions. Leave empty to use the standard text."
          >
            <Textarea
              id="care"
              value={materialsCare}
              onChange={(e) => setMaterialsCare(e.target.value)}
              rows={4}
              maxLength={3000}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Category" htmlFor="category">
            <select
              id="category"
              className={selectClass}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              {categories.length === 0 && <option value="">No categories yet</option>}
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Labels"
            htmlFor="tags"
            hint='Comma separated. The first one is the badge on the photo, e.g. "new arrival".'
          >
            <Input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <Field label="Display order" htmlFor="order" hint="Lower numbers show first.">
            <Input
              id="order"
              inputMode="numeric"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Need a new category?" htmlFor="new-category" className="w-64">
            <Input
              id="new-category"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="e.g. Kids"
            />
          </Field>
          <Button
            type="button"
            variant="outline"
            onClick={addCategory}
            disabled={!newCategory.trim()}
          >
            Add category
          </Button>
          {categoryMessage && <p className="text-sm text-destructive">{categoryMessage}</p>}
        </div>
      </section>

      <section className="space-y-4 rounded-lg border bg-background p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg">Photos</h2>
          <p className="text-xs text-muted-foreground">
            The first photo is the main one. Customers expect 4–6 per piece, including a close-up of
            the fabric.
          </p>
        </div>
        {images.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((image, index) => (
              <li key={image.key} className="space-y-2 rounded-md border p-2">
                <div className="relative">
                  <img
                    src={image.url}
                    alt={image.alt || "Product photo"}
                    className="aspect-[3/4] w-full rounded object-cover"
                  />
                  {index === 0 && (
                    <span className="absolute left-2 top-2 rounded bg-background/90 px-2 py-0.5 text-[10px] uppercase tracking-wider">
                      Main photo
                    </span>
                  )}
                </div>
                <Input
                  aria-label={`Description of photo ${index + 1}`}
                  placeholder="Describe the photo (for accessibility)"
                  value={image.alt}
                  maxLength={200}
                  onChange={(e) =>
                    setImages((current) =>
                      current.map((row) =>
                        row.key === image.key ? { ...row, alt: e.target.value } : row,
                      ),
                    )
                  }
                />
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => moveImage(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move photo ${index + 1} earlier`}
                  >
                    ←
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => moveImage(index, 1)}
                    disabled={index === images.length - 1}
                    aria-label={`Move photo ${index + 1} later`}
                  >
                    →
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-destructive"
                    onClick={() =>
                      setImages((current) => current.filter((row) => row.key !== image.key))
                    }
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            id="photos"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            onChange={(e) => void addPhotos(e.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInput.current?.click()}
            disabled={uploading > 0 || images.length >= 10}
          >
            {uploading > 0 ? `Uploading ${uploading}…` : "Add photos"}
          </Button>
          <span className="text-xs text-muted-foreground">
            JPEG, PNG or WebP. Large photos are resized automatically.
          </span>
        </div>
        {uploadErrors.map((text) => (
          <Notice key={text} kind="error">
            {text}
          </Notice>
        ))}
      </section>

      <section className="space-y-4 rounded-lg border bg-background p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg">Sizes, prices and stock</h2>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={addStandardSizes}>
              Add XS–XL
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={addRow}>
              Add a size
            </Button>
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No sizes yet. A product needs at least one size before it can be published.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-2 font-normal">Size</th>
                  <th className="pb-2 pr-2 font-normal">Colour</th>
                  <th className="pb-2 pr-2 font-normal">Stock code (SKU)</th>
                  <th className="pb-2 pr-2 font-normal">Price (USD)</th>
                  <th className="pb-2 pr-2 font-normal">In stock</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.key}>
                    <td className="py-1 pr-2">
                      <Input
                        aria-label={`Size, row ${index + 1}`}
                        value={row.size}
                        onChange={(e) => updateRow(row.key, { size: e.target.value })}
                        className="w-20"
                        maxLength={20}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <Input
                        aria-label={`Colour, row ${index + 1}`}
                        value={row.color}
                        onChange={(e) => updateRow(row.key, { color: e.target.value })}
                        className="w-32"
                        maxLength={40}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <Input
                        aria-label={`Stock code, row ${index + 1}`}
                        value={row.sku}
                        onChange={(e) => updateRow(row.key, { sku: e.target.value })}
                        className="w-40 font-mono text-xs"
                        maxLength={40}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <Input
                        aria-label={`Price, row ${index + 1}`}
                        inputMode="decimal"
                        value={row.price}
                        onChange={(e) => updateRow(row.key, { price: e.target.value })}
                        className="w-24"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <Input
                        aria-label={`Stock, row ${index + 1}`}
                        inputMode="numeric"
                        value={row.stock}
                        onChange={(e) => updateRow(row.key, { stock: e.target.value })}
                        className="w-20"
                      />
                    </td>
                    <td className="py-1 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() =>
                          setRows((current) => current.filter((r) => r.key !== row.key))
                        }
                        aria-label={`Remove row ${index + 1}`}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Each shopper can add up to 10 of a size to their bag. A size with 0 in stock shows as sold
          out.
        </p>
      </section>

      <section className="space-y-3 rounded-lg border bg-background p-5">
        <h2 className="font-display text-lg">Visibility</h2>
        <Field
          label="Status"
          htmlFor="status"
          hint="Only Active products appear in the shop. Drafts and archived products are hidden."
        >
          <select
            id="status"
            className={`${selectClass} max-w-xs`}
            value={status}
            onChange={(e) => setStatus(e.target.value as ProductStatus)}
          >
            <option value="draft">Draft — hidden while you work on it</option>
            <option value="active">Active — visible in the shop</option>
            <option value="archived">Archived — hidden, kept for records</option>
          </select>
        </Field>
      </section>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
        <Button type="submit" disabled={saving || uploading > 0}>
          {saving ? "Saving…" : isNew ? "Create product" : "Save changes"}
        </Button>
        <Button asChild variant="ghost">
          <Link to="/admin/products">Back to products</Link>
        </Button>
        {product && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {savedStatus && <StatusBadge status={savedStatus} />}
            {savedStatus === "active" && (
              <Button asChild variant="outline" size="sm">
                <a href={`/product/${product.handle}`} target="_blank" rel="noreferrer">
                  View in shop
                </a>
              </Button>
            )}
            {savedStatus !== "archived" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => changeStatus("archived")}
              >
                Archive
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => changeStatus("draft")}
              >
                Restore as draft
              </Button>
            )}
            {savedStatus !== "active" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive"
                onClick={remove}
              >
                Delete
              </Button>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
