import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  adminDeleteCategoryFn,
  adminListCategoriesFn,
  adminSaveCategoryFn,
} from "@/backend/admin.functions";
import { adminCall, Notice, PageHeader } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/admin/categories")({
  loader: () => adminListCategoriesFn(),
  component: CategoriesPage,
});

function CategoriesPage() {
  const categories = Route.useLoaderData();
  const router = useRouter();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  async function run(action: () => Promise<{ ok: boolean; message?: string }>, success: string) {
    setMessage(null);
    const result = await adminCall(action);
    if (!result.ok) {
      setMessage({ kind: "error", text: result.message ?? "That did not work." });
      return false;
    }
    setMessage({ kind: "success", text: success });
    await router.invalidate();
    return true;
  }

  return (
    <>
      <PageHeader
        title="Categories"
        description="Groups shown in the shop's filters, such as Women, Men or Kids. A category with products in it cannot be deleted."
      />
      {message && (
        <Notice kind={message.kind} className="mb-4">
          {message.text}
        </Notice>
      )}

      <form
        className="mb-6 flex max-w-md gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (await run(() => adminSaveCategoryFn({ data: { name } }), "Category added."))
            setName("");
        }}
      >
        <Input
          aria-label="New category name"
          placeholder="New category, e.g. Kids"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
        />
        <Button type="submit" disabled={!name.trim()}>
          Add
        </Button>
      </form>

      <div className="overflow-x-auto rounded-lg border bg-background">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="border-b bg-secondary/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-normal">Name</th>
              <th className="px-4 py-3 font-normal">Products</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y">
            {categories.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                  No categories yet.
                </td>
              </tr>
            )}
            {categories.map((category) => (
              <tr key={category.id}>
                <td className="px-4 py-2">
                  {editing?.id === category.id ? (
                    <form
                      className="flex gap-2"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        if (
                          await run(
                            () =>
                              adminSaveCategoryFn({
                                data: { id: category.id, name: editing.name },
                              }),
                            "Category renamed.",
                          )
                        ) {
                          setEditing(null);
                        }
                      }}
                    >
                      <Input
                        aria-label="Category name"
                        value={editing.name}
                        onChange={(e) => setEditing({ id: category.id, name: e.target.value })}
                        maxLength={60}
                        autoFocus
                      />
                      <Button type="submit" size="sm">
                        Save
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    <span>
                      {category.name}{" "}
                      <span className="font-mono text-xs text-muted-foreground">
                        /{category.slug}
                      </span>
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">{category.productCount}</td>
                <td className="px-4 py-2 text-right">
                  {editing?.id !== category.id && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing({ id: category.id, name: category.name })}
                      >
                        Rename
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => {
                          if (window.confirm(`Delete the category "${category.name}"?`)) {
                            void run(
                              () => adminDeleteCategoryFn({ data: { id: category.id } }),
                              "Category deleted.",
                            );
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
