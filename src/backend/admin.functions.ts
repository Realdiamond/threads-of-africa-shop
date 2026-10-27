import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { adminDashboard } from "./admin/dashboard.server";
import {
  cancelUnpaid,
  getAdminOrder,
  listAdminOrders,
  markOrderDelivered,
  resendConfirmation,
  setOrderNote,
  shipOrder,
} from "./admin/order-admin.server";
import { recordAudit, recentAudit } from "./admin/audit.server";
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
} from "./admin/product-admin.server";
import {
  createAdminUser,
  disableAdminUser,
  enableAdminUser,
  listAdminUsers,
  resetAdminPassword,
  setAdminRole,
} from "./admin/users.server";
import { changePassword, endSession, login, normaliseEmail } from "./auth/admin-auth.server";
import {
  clearSessionCookie,
  currentAdmin,
  readSessionToken,
  setSessionCookie,
} from "./auth/session-cookie.server";
import { getDb } from "./db/client.server";
import { guarded } from "./guarded.server";
import { log } from "./log.server";
import { refundOrder } from "./order-payments.server";
import { countNewMessages, deleteMessage, listMessages, setMessageStatus } from "./messages.server";
import { requeueFailedEmails } from "./email/processor.server";
import { listSubscribers, removeSubscriber } from "./newsletter.server";
import { listSitePages, resetSitePage, reviewSitePage, saveSitePage } from "./pages.server";
import { tooManyRequests, withinRateLimit } from "./rate-limit.server";
import { confirmShipping, getSettings, updateSettings } from "./settings.server";
import { deleteShippingZone, listShippingZones, saveShippingZone } from "./shipping.server";

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// Three levels of access, each a separate gate so a function must say which one it needs:
//   anyAdmin    signed in (including someone who still has to set a password)
//   activeAdmin signed in and past the forced password change
//   owner       an active owner
// An unauthenticated or forbidden call throws; the admin screens turn that into a sign-in prompt.
const anyAdmin = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const admin = await currentAdmin();
  if (!admin) throw new Error("UNAUTHENTICATED");
  return next({ context: { admin } });
});

const activeAdmin = createMiddleware({ type: "function" })
  .middleware([anyAdmin])
  .server(async ({ next, context }) => {
    if (context.admin.status === "invited") throw new Error("PASSWORD_CHANGE_REQUIRED");
    return next();
  });

const ownerOnly = createMiddleware({ type: "function" })
  .middleware([activeAdmin])
  .server(async ({ next, context }) => {
    if (context.admin.role !== "owner") throw new Error("FORBIDDEN");
    return next();
  });

const id = z.string().uuid();
const productStatus = z.enum(["draft", "active", "archived"]);

const productInput = z.object({
  id: id.optional(),
  version: z.number().int().min(1).optional(),
  handle: z.string().min(1).max(100),
  title: z.string().min(1).max(120),
  description: z.string().max(5000),
  details: z.string().max(3000),
  materialsCare: z.string().max(3000),
  categoryId: id,
  tags: z.array(z.string().trim().min(1).max(40)).max(10),
  status: productStatus,
  sortOrder: z.number().int().min(0).max(100_000),
  variants: z
    .array(
      z.object({
        id: id.optional(),
        sku: z.string().max(40),
        size: z.string().max(20),
        color: z.string().max(40),
        priceCents: z.number().int().min(0).max(10_000_000),
        stock: z.number().int().min(0).max(100_000),
      }),
    )
    .max(60),
  images: z.array(z.object({ url: z.string().max(200), alt: z.string().max(200) })).max(10),
});

// ---- Sign in / out -------------------------------------------------------------------------

export const getAdminSessionFn = createServerFn({ method: "POST" }).handler(() =>
  guarded("getAdminSession", async () => {
    const admin = await currentAdmin();
    // The unread-message badge in the menu rides along, saving the screens a second request.
    const newMessages = admin && admin.status === "active" ? await countNewMessages() : 0;
    return { admin, newMessages };
  }),
);

export const adminLoginFn = createServerFn({ method: "POST" })
  .validator(z.object({ email: z.string().max(254), password: z.string().min(1).max(200) }))
  .handler(({ data }) =>
    guarded("adminLogin", async () => {
      const email = normaliseEmail(data.email);
      // Throttled per address and per account: attackers spread across addresses still hit the account limit.
      if (
        tooManyRequests("admin-login-ip", 30, FIFTEEN_MINUTES) ||
        !withinRateLimit(`admin-login-email:${email}`, 10, FIFTEEN_MINUTES)
      ) {
        return {
          ok: false as const,
          message: "Too many attempts. Wait a few minutes and try again.",
        };
      }
      const result = await login(email, data.password);
      if (!result.ok) {
        log("warn", "admin login failed", { email });
        return { ok: false as const, message: "Wrong email or password." };
      }
      setSessionCookie(result.token);
      return { ok: true as const, admin: result.admin };
    }),
  );

export const adminLogoutFn = createServerFn({ method: "POST" }).handler(() =>
  guarded("adminLogout", async () => {
    const admin = await currentAdmin();
    const token = readSessionToken();
    if (token) await endSession(token);
    if (admin) await recordAudit(getDb(), admin, "logout", "session", "", "Signed out");
    clearSessionCookie();
    return { ok: true as const };
  }),
);

export const adminChangePasswordFn = createServerFn({ method: "POST" })
  .middleware([anyAdmin])
  .validator(
    z.object({
      currentPassword: z.string().min(1).max(200),
      newPassword: z.string().min(1).max(200),
    }),
  )
  .handler(({ data, context }) =>
    guarded("adminChangePassword", async () => {
      const token = readSessionToken();
      if (!token) throw new Error("UNAUTHENTICATED");
      if (tooManyRequests("admin-password", 10, FIFTEEN_MINUTES)) {
        return {
          ok: false as const,
          message: "Too many attempts. Wait a few minutes and try again.",
        };
      }
      const result = await changePassword(
        context.admin,
        token,
        data.currentPassword,
        data.newPassword,
      );
      return result.ok ? { ok: true as const } : { ok: false as const, message: result.message };
    }),
  );

// ---- Dashboard -----------------------------------------------------------------------------

export const adminDashboardFn = createServerFn({ method: "POST" })
  .middleware([activeAdmin])
  .handler(() => guarded("adminDashboard", () => adminDashboard()));

export const adminActivityFn = createServerFn({ method: "POST" })
  .middleware([activeAdmin])
  .handler(() =>
    guarded("adminActivity", async () => ({ entries: await recentAudit(getDb(), 100) })),
  );

// ---- Products ------------------------------------------------------------------------------

export const adminListProductsFn = createServerFn({ method: "POST" })
  .middleware([activeAdmin])
  .validator(z.object({ status: productStatus.optional(), search: z.string().max(100).optional() }))
  .handler(({ data }) => guarded("adminListProducts", () => listAdminProducts(data)));

export const adminGetProductFn = createServerFn({ method: "POST" })
  .middleware([activeAdmin])
  .validator(z.object({ id }))
  .handler(({ data }) => guarded("adminGetProduct", () => getAdminProduct(data.id)));

export const adminSaveProductFn = createServerFn({ method: "POST" })
  .middleware([activeAdmin])
  .validator(productInput)
  .handler(({ data, context }) =>
    guarded("adminSaveProduct", () => saveAdminProduct(context.admin, data)),
  );

export const adminSetProductStatusFn = createServerFn({ method: "POST" })
  .middleware([activeAdmin])
  .validator(z.object({ id, status: productStatus }))
  .handler(({ data, context }) =>
    guarded("adminSetProductStatus", () =>
      setAdminProductStatus(context.admin, data.id, data.status),
    ),
  );

export const adminDeleteProductFn = createServerFn({ method: "POST" })
  .middleware([activeAdmin])
  .validator(z.object({ id }))
  .handler(({ data, context }) =>
    guarded("adminDeleteProduct", () => deleteAdminProduct(context.admin, data.id)),
  );

export const adminSetStockFn = createServerFn({ method: "POST" })
  .middleware([activeAdmin])
  .validator(z.object({ variantId: id, stock: z.number().int().min(0).max(100_000) }))
  .handler(({ data, context }) =>
    guarded("adminSetStock", () => setVariantStock(context.admin, data.variantId, data.stock)),
  );

// ---- Categories ----------------------------------------------------------------------------

export const adminListCategoriesFn = createServerFn({ method: "POST" })
  .middleware([activeAdmin])
  .handler(() => guarded("adminListCategories", () => listAdminCategories()));

export const adminSaveCategoryFn = createServerFn({ method: "POST" })
  .middleware([activeAdmin])
  .validator(z.object({ id: id.optional(), name: z.string().min(1).max(60) }))
  .handler(({ data, context }) =>
    guarded("adminSaveCategory", () => saveAdminCategory(context.admin, data)),
  );

export const adminDeleteCategoryFn = createServerFn({ method: "POST" })
  .middleware([activeAdmin])
  .validator(z.object({ id }))
  .handler(({ data, context }) =>
    guarded("adminDeleteCategory", () => deleteAdminCategory(context.admin, data.id)),
  );

// ---- Team (owners only) --------------------------------------------------------------------

export const adminListUsersFn = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .handler(({ context }) => guarded("adminListUsers", () => listAdminUsers(context.admin)));

export const adminCreateUserFn = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator(
    z.object({
      name: z.string().min(1).max(80),
      email: z.string().max(254),
      role: z.enum(["owner", "staff"]),
    }),
  )
  .handler(({ data, context }) =>
    guarded("adminCreateUser", () => createAdminUser(context.admin, data)),
  );

export const adminSetRoleFn = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator(z.object({ userId: id, role: z.enum(["owner", "staff"]) }))
  .handler(({ data, context }) =>
    guarded("adminSetRole", () => setAdminRole(context.admin, data.userId, data.role)),
  );

export const adminDisableUserFn = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator(z.object({ userId: id }))
  .handler(({ data, context }) =>
    guarded("adminDisableUser", () => disableAdminUser(context.admin, data.userId)),
  );

export const adminEnableUserFn = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator(z.object({ userId: id }))
  .handler(({ data, context }) =>
    guarded("adminEnableUser", () => enableAdminUser(context.admin, data.userId)),
  );

export const adminResetPasswordFn = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator(z.object({ userId: id }))
  .handler(({ data, context }) =>
    guarded("adminResetPassword", () => resetAdminPassword(context.admin, data.userId)),
  );

// ---- Shop settings, shipping and policy pages (owners only) ---------------------------------

const settingsInput = z.object({
  storeName: z.string().max(100),
  contactEmail: z.string().max(300),
  whatsappNumber: z.string().max(40),
  instagramUrl: z.string().max(300),
  tiktokUrl: z.string().max(300),
  facebookUrl: z.string().max(300),
  pinterestUrl: z.string().max(300),
  announcement: z.string().max(300),
  lowStockThreshold: z.number().int().min(0).max(1000),
});

export const adminGetSettingsFn = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .handler(() => guarded("adminGetSettings", () => getSettings()));

export const adminUpdateSettingsFn = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator(settingsInput)
  .handler(({ data, context }) =>
    guarded("adminUpdateSettings", () => updateSettings(context.admin, data)),
  );

const zoneInput = z.object({
  id: id.optional(),
  name: z.string().max(100),
  restOfWorld: z.boolean(),
  taxBps: z.number().int().min(0).max(5000),
  countries: z.array(z.string().length(2)).max(250),
  rates: z
    .array(
      z.object({
        name: z.string().max(100),
        priceCents: z.number().int().min(0).max(1_000_000),
        freeOverCents: z.number().int().positive().nullable(),
        estimate: z.string().max(100),
      }),
    )
    .max(10),
});

export const adminListShippingFn = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .handler(() =>
    guarded("adminListShipping", async () => ({
      zones: await listShippingZones(),
      confirmedAt: (await getSettings()).shippingConfirmedAt,
    })),
  );

export const adminSaveShippingZoneFn = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator(zoneInput)
  .handler(({ data, context }) =>
    guarded("adminSaveShippingZone", () => saveShippingZone(context.admin, data)),
  );

export const adminDeleteShippingZoneFn = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator(z.object({ zoneId: id }))
  .handler(({ data, context }) =>
    guarded("adminDeleteShippingZone", () => deleteShippingZone(context.admin, data.zoneId)),
  );

export const adminConfirmShippingFn = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .handler(({ context }) => guarded("adminConfirmShipping", () => confirmShipping(context.admin)));

const pageSlug = z.string().max(40);

export const adminListPagesFn = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .handler(() => guarded("adminListPages", () => listSitePages()));

export const adminSavePageFn = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator(z.object({ slug: pageSlug, title: z.string().max(200), body: z.string().max(60_000) }))
  .handler(({ data, context }) =>
    guarded("adminSavePage", () => saveSitePage(context.admin, data)),
  );

export const adminReviewPageFn = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator(z.object({ slug: pageSlug }))
  .handler(({ data, context }) =>
    guarded("adminReviewPage", () => reviewSitePage(context.admin, data.slug)),
  );

export const adminResetPageFn = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator(z.object({ slug: pageSlug }))
  .handler(({ data, context }) =>
    guarded("adminResetPage", () => resetSitePage(context.admin, data.slug)),
  );

// ---- Messages and subscribers --------------------------------------------------------------

export const adminListMessagesFn = createServerFn({ method: "POST" })
  .middleware([activeAdmin])
  .validator(z.object({ status: z.enum(["new", "handled"]).optional() }))
  .handler(({ data }) => guarded("adminListMessages", () => listMessages(data)));

export const adminSetMessageStatusFn = createServerFn({ method: "POST" })
  .middleware([activeAdmin])
  .validator(z.object({ id, status: z.enum(["new", "handled"]) }))
  .handler(({ data, context }) =>
    guarded("adminSetMessageStatus", () => setMessageStatus(context.admin, data.id, data.status)),
  );

export const adminDeleteMessageFn = createServerFn({ method: "POST" })
  .middleware([activeAdmin])
  .validator(z.object({ id }))
  .handler(({ data, context }) =>
    guarded("adminDeleteMessage", () => deleteMessage(context.admin, data.id)),
  );

export const adminListSubscribersFn = createServerFn({ method: "POST" })
  .middleware([activeAdmin])
  .validator(
    z.object({
      status: z.enum(["subscribed", "unsubscribed"]).optional(),
      search: z.string().max(100).optional(),
    }),
  )
  .handler(({ data }) => guarded("adminListSubscribers", () => listSubscribers(data)));

export const adminRemoveSubscriberFn = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator(z.object({ id }))
  .handler(({ data, context }) =>
    guarded("adminRemoveSubscriber", () => removeSubscriber(context.admin, data.id)),
  );

// ---- Orders ----------------------------------------------------------------------------------

const orderStatus = z.enum([
  "pending_payment",
  "paid",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
]);

export const adminListOrdersFn = createServerFn({ method: "POST" })
  .middleware([activeAdmin])
  .validator(
    z.object({
      status: orderStatus.optional(),
      search: z.string().max(100).optional(),
      page: z.number().int().min(1).max(10_000).optional(),
    }),
  )
  .handler(({ data }) => guarded("adminListOrders", () => listAdminOrders(data)));

export const adminGetOrderFn = createServerFn({ method: "POST" })
  .middleware([activeAdmin])
  .validator(z.object({ id }))
  .handler(({ data }) => guarded("adminGetOrder", () => getAdminOrder(data.id)));

export const adminShipOrderFn = createServerFn({ method: "POST" })
  .middleware([activeAdmin])
  .validator(
    z.object({
      id,
      carrier: z.string().max(60),
      trackingNumber: z.string().max(100),
      notify: z.boolean(),
    }),
  )
  .handler(({ data, context }) =>
    guarded("adminShipOrder", () =>
      shipOrder(context.admin, data.id, {
        carrier: data.carrier,
        trackingNumber: data.trackingNumber,
        notify: data.notify,
      }),
    ),
  );

export const adminDeliverOrderFn = createServerFn({ method: "POST" })
  .middleware([activeAdmin])
  .validator(z.object({ id }))
  .handler(({ data, context }) =>
    guarded("adminDeliverOrder", () => markOrderDelivered(context.admin, data.id)),
  );

export const adminCancelOrderFn = createServerFn({ method: "POST" })
  .middleware([activeAdmin])
  .validator(z.object({ id }))
  .handler(({ data, context }) =>
    guarded("adminCancelOrder", () => cancelUnpaid(context.admin, data.id)),
  );

// Refunds move real money, so only an owner can do them.
export const adminRefundOrderFn = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator(z.object({ id, restock: z.boolean() }))
  .handler(({ data, context }) =>
    guarded("adminRefundOrder", () =>
      refundOrder(context.admin, data.id, { restock: data.restock }),
    ),
  );

export const adminSetOrderNoteFn = createServerFn({ method: "POST" })
  .middleware([activeAdmin])
  .validator(z.object({ id, notes: z.string().max(2000) }))
  .handler(({ data, context }) =>
    guarded("adminSetOrderNote", () => setOrderNote(context.admin, data.id, data.notes)),
  );

export const adminResendConfirmationFn = createServerFn({ method: "POST" })
  .middleware([activeAdmin])
  .validator(z.object({ id }))
  .handler(({ data, context }) =>
    guarded("adminResendConfirmation", async () => {
      // A receipt email is cheap to ask for and easy to abuse by clicking, so it is throttled.
      if (tooManyRequests("admin-resend-receipt", 30, FIFTEEN_MINUTES)) {
        return {
          ok: false as const,
          code: "INVALID" as const,
          message: "Too many emails sent. Wait a few minutes.",
        };
      }
      return resendConfirmation(context.admin, data.id);
    }),
  );

// ---- Launch checklist ------------------------------------------------------------------------

export const adminRetryFailedEmailsFn = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .handler(({ context }) =>
    guarded("adminRetryFailedEmails", async () => {
      const count = await requeueFailedEmails();
      await recordAudit(
        getDb(),
        context.admin,
        "emails_requeued",
        "email",
        "",
        `Put ${count} failed email${count === 1 ? "" : "s"} back in the queue`,
      );
      return { ok: true as const, count };
    }),
  );
