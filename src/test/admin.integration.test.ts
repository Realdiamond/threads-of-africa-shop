// @vitest-environment node
//
// Real-Postgres tests for the admin area. Skipped when TEST_DATABASE_URL is not set.
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { adminDashboard } from "@/backend/admin/dashboard.server";
import { recentAudit } from "@/backend/admin/audit.server";
import { getMedia, purgeStrayUploads, saveMedia } from "@/backend/admin/media.server";
import {
  deleteAdminCategory,
  deleteAdminProduct,
  getAdminProduct,
  listAdminCategories,
  listAdminProducts,
  saveAdminCategory,
  saveAdminProduct,
  setAdminProductStatus,
  setVariantStock,
  type ProductInput,
} from "@/backend/admin/product-admin.server";
import {
  createAdminUser,
  disableAdminUser,
  enableAdminUser,
  listAdminUsers,
  resetAdminPassword,
  setAdminRole,
} from "@/backend/admin/users.server";
import {
  changePassword,
  endSession,
  login,
  resolveSession,
  type AdminPrincipal,
} from "@/backend/auth/admin-auth.server";
import { hashPassword } from "@/backend/auth/password.server";
import { fetchActiveProducts } from "@/backend/catalog.server";
import * as schema from "@/backend/db/schema";
import {
  adminSessions,
  adminUsers,
  categories,
  media,
  productImages,
  products,
} from "@/backend/db/schema";

if (!process.env["TEST_DATABASE_URL"]) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env file: the suite is skipped below.
  }
}
const url = process.env["TEST_DATABASE_URL"];

const PASSWORD = "correct horse battery";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

describe.skipIf(!url)("admin area (Postgres)", () => {
  if (url && !new URL(url).pathname.includes("test")) {
    throw new Error("TEST_DATABASE_URL must point at a database whose name contains 'test'");
  }

  const pool = new Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema });
  let passwordHash: string;
  let counter = 0;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "./db/migrations" });
    passwordHash = await hashPassword(PASSWORD);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate audit_log, admin_sessions, admin_users, media, cart_lines, carts, product_images, variants, products, categories restart identity cascade`,
    );
  });

  async function makeAdmin(
    role: "owner" | "staff" = "owner",
    status: "invited" | "active" | "disabled" = "active",
  ): Promise<AdminPrincipal> {
    counter += 1;
    const email = `${role}${counter}@example.com`;
    const [user] = await db
      .insert(adminUsers)
      .values({ email, name: `${role} ${counter}`, role, status, passwordHash })
      .returning();
    return {
      id: user!.id,
      email,
      name: user!.name,
      role,
      status: status === "invited" ? "invited" : "active",
    };
  }

  async function makeCategory(name = "Women") {
    const [existing] = await db.select().from(categories).where(eq(categories.name, name));
    if (existing) return existing.id;
    const [row] = await db
      .insert(categories)
      .values({ name, slug: name.toLowerCase() })
      .returning();
    return row!.id;
  }

  async function makeUpload(admin: AdminPrincipal) {
    const result = await saveMedia(admin, { bytes: PNG, filename: "photo.png" }, db);
    if (!result.ok) throw new Error(result.message);
    return result.url;
  }

  async function productInput(
    admin: AdminPrincipal,
    overrides: Partial<ProductInput> = {},
  ): Promise<ProductInput> {
    return {
      handle: "amara-dress",
      title: "Amara Dress",
      description: "A dress.",
      details: "",
      materialsCare: "",
      categoryId: await makeCategory(),
      tags: ["new"],
      status: "active",
      sortOrder: 10,
      variants: [
        { sku: "AM-S", size: "S", color: "Sunflower", priceCents: 12900, stock: 5 },
        { sku: "AM-M", size: "M", color: "Sunflower", priceCents: 12900, stock: 0 },
      ],
      images: [{ url: await makeUpload(admin), alt: "Amara" }],
      ...overrides,
    };
  }

  async function createProduct(admin: AdminPrincipal, overrides: Partial<ProductInput> = {}) {
    const result = await saveAdminProduct(admin, await productInput(admin, overrides), db);
    if (!result.ok) throw new Error(result.message);
    return result;
  }

  describe("sign-in and sessions", () => {
    it("signs in with the right password and stores only a hash of the token", async () => {
      const admin = await makeAdmin();
      const result = await login(admin.email.toUpperCase(), PASSWORD, db);
      if (!result.ok) throw new Error("expected sign-in to succeed");

      expect((await resolveSession(result.token, db))?.id).toBe(admin.id);
      const stored = await db.select().from(adminSessions);
      expect(stored).toHaveLength(1);
      expect(stored[0]!.tokenHash).not.toBe(result.token);
      expect(stored[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("gives one generic failure for wrong passwords, unknown emails and disabled accounts", async () => {
      const active = await makeAdmin();
      const disabled = await makeAdmin("staff", "disabled");

      expect(await login(active.email, "wrong password!", db)).toEqual({ ok: false });
      expect(await login("nobody@example.com", PASSWORD, db)).toEqual({ ok: false });
      expect(await login(disabled.email, PASSWORD, db)).toEqual({ ok: false });
    });

    it("expires sessions after idle time and after the absolute limit", async () => {
      const admin = await makeAdmin();
      const idle = await login(admin.email, PASSWORD, db);
      const old = await login(admin.email, PASSWORD, db);
      if (!idle.ok || !old.ok) throw new Error("setup failed");

      await db.execute(
        sql`update admin_sessions set last_used_at = now() - interval '13 hours' where token_hash = ${(await db.select().from(adminSessions))[0]!.tokenHash}`,
      );
      expect(await resolveSession(idle.token, db)).toBeNull();

      await db.update(adminSessions).set({ expiresAt: sql`now() - interval '1 minute'` });
      expect(await resolveSession(old.token, db)).toBeNull();
    });

    it("stops honouring a session when its owner is disabled", async () => {
      const admin = await makeAdmin();
      const result = await login(admin.email, PASSWORD, db);
      if (!result.ok) throw new Error("setup failed");
      await db.update(adminUsers).set({ status: "disabled" }).where(eq(adminUsers.id, admin.id));

      expect(await resolveSession(result.token, db)).toBeNull();
    });

    it("logging out deletes the session, not just the cookie", async () => {
      const admin = await makeAdmin();
      const result = await login(admin.email, PASSWORD, db);
      if (!result.ok) throw new Error("setup failed");

      await endSession(result.token, db);

      expect(await db.select().from(adminSessions)).toHaveLength(0);
      expect(await resolveSession(result.token, db)).toBeNull();
    });

    it("changing the password signs out other devices and activates an invited account", async () => {
      const admin = await makeAdmin("staff", "invited");
      const here = await login(admin.email, PASSWORD, db);
      const elsewhere = await login(admin.email, PASSWORD, db);
      if (!here.ok || !elsewhere.ok) throw new Error("setup failed");

      expect(
        (await changePassword(admin, here.token, "wrong one", "a brand new passphrase", db)).ok,
      ).toBe(false);
      expect(await changePassword(admin, here.token, PASSWORD, "short", db)).toMatchObject({
        code: "WEAK_PASSWORD",
      });
      expect(await changePassword(admin, here.token, PASSWORD, PASSWORD, db)).toMatchObject({
        code: "SAME_PASSWORD",
      });
      expect(
        (await changePassword(admin, here.token, PASSWORD, "a brand new passphrase", db)).ok,
      ).toBe(true);

      expect((await resolveSession(here.token, db))?.status).toBe("active");
      expect(await resolveSession(elsewhere.token, db)).toBeNull();
      expect(await login(admin.email, PASSWORD, db)).toEqual({ ok: false });
      expect((await login(admin.email, "a brand new passphrase", db)).ok).toBe(true);
    });

    it("records sign-ins in the audit log", async () => {
      const admin = await makeAdmin();
      await login(admin.email, PASSWORD, db);
      const entries = await recentAudit(db);
      expect(entries[0]).toMatchObject({ action: "login", adminEmail: admin.email });
    });
  });

  describe("team management", () => {
    it("only lets owners manage the team", async () => {
      const staff = await makeAdmin("staff");
      expect(await listAdminUsers(staff, db)).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(
        await createAdminUser(staff, { name: "X", email: "x@example.com", role: "staff" }, db),
      ).toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("creates an invited user whose temporary password works once", async () => {
      const owner = await makeAdmin();
      const created = await createAdminUser(
        owner,
        { name: "Ada", email: " Ada@Example.com ", role: "staff" },
        db,
      );
      if (!created.ok) throw new Error(created.message);

      expect(created.user).toMatchObject({
        email: "ada@example.com",
        status: "invited",
        role: "staff",
      });
      const signedIn = await login("ada@example.com", created.temporaryPassword, db);
      expect(signedIn.ok && signedIn.admin.status).toBe("invited");

      expect(
        await createAdminUser(owner, { name: "Ada", email: "ada@example.com", role: "staff" }, db),
      ).toMatchObject({
        code: "EMAIL_TAKEN",
      });
      expect(
        await createAdminUser(owner, { name: "Bad", email: "not-an-email", role: "staff" }, db),
      ).toMatchObject({
        code: "INVALID",
      });
    });

    it("never lets the last active owner be disabled or demoted, nor yourself disabled", async () => {
      const owner = await makeAdmin();
      expect(await disableAdminUser(owner, owner.id, db)).toMatchObject({ code: "SELF" });
      expect(await setAdminRole(owner, owner.id, "staff", db)).toMatchObject({
        code: "LAST_OWNER",
      });

      const second = await makeAdmin("owner");
      expect(await disableAdminUser(owner, second.id, db)).toEqual({ ok: true });
      // `second` is disabled now, so `owner` is the last active owner again.
      const third = await makeAdmin("owner");
      expect((await setAdminRole(owner, third.id, "staff", db)).ok).toBe(true);
      expect(await setAdminRole(owner, owner.id, "staff", db)).toMatchObject({
        code: "LAST_OWNER",
      });
    });

    it("cannot be raced into leaving nobody in charge", async () => {
      const a = await makeAdmin("owner");
      const b = await makeAdmin("owner");

      const [first, second] = await Promise.all([
        disableAdminUser(a, b.id, db),
        disableAdminUser(b, a.id, db),
      ]);

      expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
      const activeOwners = await db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.status, "active"));
      expect(activeOwners).toHaveLength(1);
    });

    it("disabling kills sessions; enabling and resetting issue a fresh temporary password", async () => {
      const owner = await makeAdmin();
      const staff = await makeAdmin("staff");
      const session = await login(staff.email, PASSWORD, db);
      if (!session.ok) throw new Error("setup failed");

      expect(await disableAdminUser(owner, staff.id, db)).toEqual({ ok: true });
      expect(await resolveSession(session.token, db)).toBeNull();
      expect(await resetAdminPassword(owner, staff.id, db)).toMatchObject({ code: "INVALID" });

      const enabled = await enableAdminUser(owner, staff.id, db);
      if (!enabled.ok) throw new Error(enabled.message);
      const back = await login(staff.email, enabled.temporaryPassword, db);
      expect(back.ok && back.admin.status).toBe("invited");

      const reset = await resetAdminPassword(owner, staff.id, db);
      if (!reset.ok) throw new Error(reset.message);
      expect(await login(staff.email, enabled.temporaryPassword, db)).toEqual({ ok: false });
      expect((await login(staff.email, reset.temporaryPassword, db)).ok).toBe(true);
      expect(await resetAdminPassword(owner, owner.id, db)).toMatchObject({ code: "SELF" });
    });
  });

  describe("products", () => {
    it("creates a product that immediately shows on the storefront with the right price and options", async () => {
      const admin = await makeAdmin();
      const saved = await createProduct(admin);
      expect(saved.version).toBe(1);

      const storefront = await fetchActiveProducts(db);
      expect(storefront).toHaveLength(1);
      expect(storefront[0]).toMatchObject({
        id: "amara-dress",
        name: "Amara Dress",
        price: 129,
        color: "Sunflower",
        tag: "new",
      });
      expect(storefront[0]!.variants.map((v) => [v.title, v.availableForSale])).toEqual([
        ["S / Sunflower", true],
        ["M / Sunflower", false],
      ]);
      expect(storefront[0]!.image).toMatch(/^\/media\//);
    });

    it("refuses to publish a product with no sizes or photos, and rejects bad input", async () => {
      const admin = await makeAdmin();
      const bad = async (overrides: Partial<ProductInput>) =>
        saveAdminProduct(admin, await productInput(admin, overrides), db);

      expect(await bad({ variants: [] })).toMatchObject({
        code: "INVALID",
        message: expect.stringContaining("size"),
      });
      expect(await bad({ images: [] })).toMatchObject({
        code: "INVALID",
        message: expect.stringContaining("photo"),
      });
      expect(await bad({ handle: "Not A Handle" })).toMatchObject({ code: "INVALID" });
      expect(
        await bad({
          variants: [
            { sku: "A", size: "S", color: "", priceCents: 1, stock: 1 },
            { sku: "a", size: "M", color: "", priceCents: 1, stock: 1 },
          ],
        }),
      ).toMatchObject({ code: "INVALID", message: expect.stringContaining("used on two rows") });
      expect(
        await bad({
          variants: [
            { sku: "A", size: "S", color: "Red", priceCents: 1, stock: 1 },
            { sku: "B", size: "s", color: "red", priceCents: 1, stock: 1 },
          ],
        }),
      ).toMatchObject({ code: "INVALID", message: expect.stringContaining("two rows") });
      expect(await bad({ images: [{ url: "https://evil.example/x.png", alt: "" }] })).toMatchObject(
        { code: "INVALID" },
      );
      expect(await bad({ images: [{ url: "javascript:alert(1)", alt: "" }] })).toMatchObject({
        code: "INVALID",
      });
      expect(
        await bad({ images: [{ url: "/media/00000000-0000-4000-8000-000000000000", alt: "" }] }),
      ).toMatchObject({
        code: "INVALID",
      });
      expect(await db.select().from(products)).toHaveLength(0);
    });

    it("allows drafts without sizes or photos", async () => {
      const admin = await makeAdmin();
      const saved = await saveAdminProduct(
        admin,
        await productInput(admin, { status: "draft", variants: [], images: [] }),
        db,
      );
      expect(saved.ok).toBe(true);
      expect(await fetchActiveProducts(db)).toHaveLength(0);
    });

    it("reports duplicate web addresses and stock codes across products", async () => {
      const admin = await makeAdmin();
      await createProduct(admin);

      const sameHandle = await saveAdminProduct(
        admin,
        await productInput(admin, {
          variants: [{ sku: "OTHER", size: "S", color: "", priceCents: 1, stock: 1 }],
        }),
        db,
      );
      expect(sameHandle).toMatchObject({ ok: false, code: "DUPLICATE_HANDLE" });

      const sameSku = await saveAdminProduct(
        admin,
        await productInput(admin, {
          handle: "other",
          variants: [{ sku: "AM-S", size: "S", color: "", priceCents: 1, stock: 1 }],
        }),
        db,
      );
      expect(sameSku).toMatchObject({ ok: false, code: "DUPLICATE_SKU" });
    });

    it("detects two people editing at once and applies nothing from the stale save", async () => {
      const admin = await makeAdmin();
      const saved = await createProduct(admin);
      const current = (await getAdminProduct(saved.id, db))!;
      const edit = (overrides: Partial<ProductInput>): ProductInput => ({
        ...current,
        ...overrides,
      });

      const first = await saveAdminProduct(admin, edit({ title: "First edit" }), db);
      expect(first).toMatchObject({ ok: true, version: 2 });

      const stale = await saveAdminProduct(admin, edit({ title: "Stale edit" }), db);
      expect(stale).toMatchObject({ ok: false, code: "CONFLICT" });
      expect((await getAdminProduct(saved.id, db))!.title).toBe("First edit");
    });

    it("rolls back everything when a save fails part-way", async () => {
      const admin = await makeAdmin();
      await createProduct(admin, {
        handle: "first",
        variants: [{ sku: "TAKEN", size: "S", color: "", priceCents: 1000, stock: 1 }],
      });
      const second = await createProduct(admin, {
        handle: "second",
        variants: [{ sku: "MINE", size: "S", color: "", priceCents: 2000, stock: 2 }],
      });
      const current = (await getAdminProduct(second.id, db))!;

      const result = await saveAdminProduct(
        admin,
        {
          ...current,
          title: "Renamed",
          variants: [{ ...current.variants[0]!, sku: "TAKEN", priceCents: 9999 }],
        },
        db,
      );

      expect(result).toMatchObject({ ok: false, code: "DUPLICATE_SKU" });
      const after = (await getAdminProduct(second.id, db))!;
      expect(after.title).not.toBe("Renamed");
      expect(after.version).toBe(current.version);
      expect(after.variants[0]).toMatchObject({ sku: "MINE", priceCents: 2000 });
    });

    it("adds, edits and removes sizes, and writes price and stock changes to the audit log", async () => {
      const admin = await makeAdmin();
      const saved = await createProduct(admin);
      const current = (await getAdminProduct(saved.id, db))!;
      const [small, medium] = current.variants;

      const result = await saveAdminProduct(
        admin,
        {
          ...current,
          variants: [
            { ...small!, priceCents: 13500, stock: 9 },
            {
              id: undefined,
              sku: "AM-L",
              size: "L",
              color: "Sunflower",
              priceCents: 13500,
              stock: 4,
            },
          ],
        },
        db,
      );
      expect(result.ok).toBe(true);

      const after = (await getAdminProduct(saved.id, db))!;
      expect(after.variants.map((v) => v.sku)).toEqual(["AM-S", "AM-L"]);
      expect(after.variants.find((v) => v.id === medium!.id)).toBeUndefined();
      const summary = (await recentAudit(db))[0]!.summary;
      expect(summary).toContain("AM-S price 129.00 → 135.00");
      expect(summary).toContain("AM-S stock 5 → 9");
      expect(summary).toContain("removed AM-M");
      expect(summary).toContain("added AM-L");
    });

    it("replaces photos and deletes uploads that nothing uses any more", async () => {
      const admin = await makeAdmin();
      const saved = await createProduct(admin);
      const current = (await getAdminProduct(saved.id, db))!;
      const oldUrl = current.images[0]!.url;
      const newUrl = await makeUpload(admin);

      const result = await saveAdminProduct(
        admin,
        { ...current, images: [{ url: newUrl, alt: "New" }] },
        db,
      );
      expect(result.ok).toBe(true);

      const remaining = await db.select({ id: media.id }).from(media);
      expect(remaining.map((row) => `/media/${row.id}`)).toEqual([newUrl]);
      expect(oldUrl).not.toBe(newUrl);
    });

    it("keeps already-attached legacy photos but refuses to attach new arbitrary paths", async () => {
      const admin = await makeAdmin();
      const category = await makeCategory();
      const [row] = await db
        .insert(products)
        .values({ handle: "legacy", title: "Legacy", categoryId: category, status: "active" })
        .returning();
      await db
        .insert(productImages)
        .values({ productId: row!.id, url: "/products/amara.jpg", alt: "Old" });
      await db.insert(schema.variants).values({
        productId: row!.id,
        sku: "L-1",
        title: "S",
        priceCents: 100,
        stock: 1,
        selectedOptions: [{ name: "Size", value: "S" }],
      });
      const current = (await getAdminProduct(row!.id, db))!;

      expect((await saveAdminProduct(admin, { ...current, title: "Legacy 2" }, db)).ok).toBe(true);
      const current2 = (await getAdminProduct(row!.id, db))!;
      expect(
        await saveAdminProduct(
          admin,
          { ...current2, images: [{ url: "/products/other.jpg", alt: "" }] },
          db,
        ),
      ).toMatchObject({ ok: false, code: "INVALID" });
    });

    it("publishing needs sizes and photos; archiving hides the product", async () => {
      const admin = await makeAdmin();
      const empty = await saveAdminProduct(
        admin,
        await productInput(admin, { status: "draft", variants: [], images: [] }),
        db,
      );
      if (!empty.ok) throw new Error(empty.message);
      expect(await setAdminProductStatus(admin, empty.id, "active", db)).toMatchObject({
        ok: false,
        code: "INVALID",
      });

      const live = await createProduct(admin, { handle: "live" });
      expect(await fetchActiveProducts(db)).toHaveLength(1);
      expect((await setAdminProductStatus(admin, live.id, "archived", db)).ok).toBe(true);
      expect(await fetchActiveProducts(db)).toHaveLength(0);
    });

    it("only deletes products that are not live, and removes their uploads", async () => {
      const admin = await makeAdmin();
      const saved = await createProduct(admin);
      expect(await deleteAdminProduct(admin, saved.id, db)).toMatchObject({
        ok: false,
        code: "INVALID",
      });

      await setAdminProductStatus(admin, saved.id, "archived", db);
      expect(await deleteAdminProduct(admin, saved.id, db)).toEqual({ ok: true });
      expect(await db.select().from(products)).toHaveLength(0);
      expect(await db.select().from(media)).toHaveLength(0);
      expect(await deleteAdminProduct(admin, saved.id, db)).toMatchObject({ code: "NOT_FOUND" });
    });

    it("stock edits are logged and invalidate other people's open editors", async () => {
      const admin = await makeAdmin();
      const saved = await createProduct(admin);
      const current = (await getAdminProduct(saved.id, db))!;

      expect(await setVariantStock(admin, current.variants[1]!.id!, 12, db)).toEqual({
        ok: true,
        stock: 12,
      });

      expect((await getAdminProduct(saved.id, db))!.variants[1]!.stock).toBe(12);
      expect(await saveAdminProduct(admin, current, db)).toMatchObject({
        ok: false,
        code: "CONFLICT",
      });
      expect((await recentAudit(db))[0]!.summary).toContain("stock 0 → 12");
      expect(
        await setVariantStock(admin, "00000000-0000-4000-8000-000000000000", 1, db),
      ).toMatchObject({ code: "NOT_FOUND" });
    });

    it("lists and searches products, treating wildcard characters literally", async () => {
      const admin = await makeAdmin();
      await createProduct(admin, { handle: "amara-dress", title: "Amara Dress" });
      await createProduct(admin, {
        handle: "kofi-shirt",
        title: "100% Cotton Shirt",
        status: "draft",
        variants: [{ sku: "K-1", size: "M", color: "", priceCents: 8500, stock: 1 }],
      });

      expect((await listAdminProducts({}, db)).map((p) => p.handle).sort()).toEqual([
        "amara-dress",
        "kofi-shirt",
      ]);
      expect((await listAdminProducts({ status: "draft" }, db)).map((p) => p.handle)).toEqual([
        "kofi-shirt",
      ]);
      expect((await listAdminProducts({ search: "amara" }, db)).map((p) => p.handle)).toEqual([
        "amara-dress",
      ]);
      expect((await listAdminProducts({ search: "%" }, db)).map((p) => p.handle)).toEqual([
        "kofi-shirt",
      ]);
      expect(await listAdminProducts({ search: "zzz" }, db)).toEqual([]);

      const [summary] = await listAdminProducts({ search: "amara" }, db);
      expect(summary).toMatchObject({
        variantCount: 2,
        minPriceCents: 12900,
        totalStock: 5,
        category: "Women",
      });
    });
  });

  describe("categories", () => {
    it("creates, renames and deletes categories, and protects ones in use", async () => {
      const admin = await makeAdmin();
      const created = await saveAdminCategory(admin, { name: "Roots & Play" }, db);
      if (!created.ok) throw new Error(created.message);
      expect(created.category.slug).toBe("roots-play");

      expect(await saveAdminCategory(admin, { name: "roots & play" }, db)).toMatchObject({
        code: "DUPLICATE_CATEGORY",
      });
      expect(await saveAdminCategory(admin, { name: "!!!" }, db)).toMatchObject({
        code: "INVALID",
      });

      const renamed = await saveAdminCategory(admin, { id: created.category.id, name: "Kids" }, db);
      expect(renamed.ok && renamed.category.slug).toBe("kids");

      await createProduct(admin, { categoryId: created.category.id });
      expect(await deleteAdminCategory(admin, created.category.id, db)).toMatchObject({
        code: "IN_USE",
      });
      expect(
        (await listAdminCategories(db)).find((c) => c.id === created.category.id)?.productCount,
      ).toBe(1);

      const empty = await saveAdminCategory(admin, { name: "Empty" }, db);
      if (!empty.ok) throw new Error(empty.message);
      expect(await deleteAdminCategory(admin, empty.category.id, db)).toEqual({ ok: true });
    });
  });

  describe("dashboard", () => {
    it("counts products and flags low and missing stock", async () => {
      const admin = await makeAdmin();
      await createProduct(admin, {
        variants: [
          { sku: "A-OUT", size: "S", color: "", priceCents: 1, stock: 0 },
          { sku: "A-LOW", size: "M", color: "", priceCents: 1, stock: 2 },
          { sku: "A-OK", size: "L", color: "", priceCents: 1, stock: 40 },
        ],
      });
      await createProduct(admin, {
        handle: "draft-one",
        status: "draft",
        variants: [{ sku: "D-OUT", size: "S", color: "", priceCents: 1, stock: 0 }],
      });

      const dashboard = await adminDashboard(db);

      expect(dashboard.counts).toEqual({ active: 1, draft: 1, archived: 0 });
      expect(dashboard.outOfStock).toBe(1); // drafts do not count
      expect(dashboard.lowStock.map((row) => row.sku)).toEqual(["A-LOW"]);
      expect(dashboard.recent.length).toBeGreaterThan(0);
    });
  });

  describe("photos", () => {
    it("accepts real images and rejects empty, oversized and non-image uploads", async () => {
      const admin = await makeAdmin();
      const saved = await saveMedia(
        admin,
        { bytes: PNG, filename: "C:\\fakepath\\look-1.png" },
        db,
      );
      if (!saved.ok) throw new Error(saved.message);
      expect(saved.url).toMatch(/^\/media\/[0-9a-f-]{36}$/);

      const stored = await getMedia(saved.url.slice("/media/".length), db);
      expect(stored?.contentType).toBe("image/png");
      expect(Buffer.compare(stored!.data, PNG)).toBe(0);
      expect((await db.select().from(media))[0]!.filename).toBe("look-1.png");

      expect(
        await saveMedia(admin, { bytes: Buffer.alloc(0), filename: "x.png" }, db),
      ).toMatchObject({ code: "EMPTY" });
      expect(
        await saveMedia(
          admin,
          { bytes: Buffer.from("<svg onload=alert(1)>"), filename: "x.svg" },
          db,
        ),
      ).toMatchObject({
        code: "UNSUPPORTED",
      });
      expect(
        await saveMedia(
          admin,
          { bytes: Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]), filename: "big.png" },
          db,
        ),
      ).toMatchObject({ code: "TOO_LARGE" });
    });

    it("cleans up stray uploads after a day but never ones a product uses", async () => {
      const admin = await makeAdmin();
      await createProduct(admin); // one upload in use
      await makeUpload(admin); // one stray
      await makeUpload(admin); // one stray, still fresh
      const strays = await db.select().from(media);
      await db
        .update(media)
        .set({ createdAt: sql`now() - interval '2 days'` })
        .where(eq(media.id, strays[1]!.id));

      expect(await purgeStrayUploads(db)).toBe(1);
      expect(await db.select().from(media)).toHaveLength(2);
    });
  });
});
