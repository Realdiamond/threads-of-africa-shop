import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { AuthResult, CheckoutPrefill, CustomerView } from "@/lib/customer-types";
import type { OrderListRow } from "@/lib/order-types";

import { normaliseEmail } from "./auth/admin-auth.server";
import {
  activateAccount,
  changeCustomerPassword,
  deleteCustomerAccount,
  endCustomerSession,
  loginCustomer,
  register,
  requestPasswordReset,
  resetPassword,
  updateCustomerName,
} from "./customers/customer-auth.server";
import { checkoutPrefill, listCustomerOrders } from "./customers/customer-orders.server";
import {
  clearCustomerCookie,
  currentCustomer,
  readCustomerToken,
  setCustomerCookie,
} from "./customers/customer-session.server";
import { guarded } from "./guarded.server";
import { log } from "./log.server";
import { tooManyRequests, withinRateLimit } from "./rate-limit.server";

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";
const limited = (): { ok: false; code: "RATE_LIMITED"; message: string } => ({
  ok: false,
  code: "RATE_LIMITED",
  message: TOO_MANY,
});

const email = z.string().max(254);
const password = z.string().min(1).max(200);
const token = z.string().min(16).max(100);

// Functions that need a signed-in customer. Anyone else gets an error the account screens turn
// into the sign-in page.
const customerOnly = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const customer = await currentCustomer();
  if (!customer) throw new Error("UNAUTHENTICATED");
  return next({ context: { customer } });
});

// Who is signed in (or null). Used by the account page and the checkout.
export const getCustomerFn = createServerFn({ method: "POST" }).handler(() =>
  guarded("getCustomer", async (): Promise<CustomerView | null> => currentCustomer()),
);

export const registerFn = createServerFn({ method: "POST" })
  .validator(z.object({ email, name: z.string().max(100) }))
  .handler(({ data }) =>
    guarded("register", async (): Promise<AuthResult> => {
      if (tooManyRequests("customer-register", 10, FIFTEEN_MINUTES)) return limited();
      return register(data);
    }),
  );

export const activateFn = createServerFn({ method: "POST" })
  .validator(z.object({ token, password }))
  .handler(({ data }) =>
    guarded("activate", async (): Promise<AuthResult<{ customer: CustomerView }>> => {
      if (tooManyRequests("customer-activate", 20, FIFTEEN_MINUTES)) return limited();
      const result = await activateAccount(data.token, data.password);
      if (!result.ok) return result;
      setCustomerCookie(result.sessionToken);
      return { ok: true, customer: result.customer };
    }),
  );

export const loginFn = createServerFn({ method: "POST" })
  .validator(z.object({ email, password }))
  .handler(({ data }) =>
    guarded("customerLogin", async (): Promise<AuthResult<{ customer: CustomerView }>> => {
      // Throttled per address and per account: attackers spread across addresses still hit the
      // account limit.
      const key = normaliseEmail(data.email);
      if (
        tooManyRequests("customer-login-ip", 30, FIFTEEN_MINUTES) ||
        !withinRateLimit(`customer-login-email:${key}`, 10, FIFTEEN_MINUTES)
      ) {
        return limited();
      }
      const result = await loginCustomer(data.email, data.password);
      if (!result.ok) {
        log("warn", "customer login failed");
        return result;
      }
      setCustomerCookie(result.sessionToken);
      return { ok: true, customer: result.customer };
    }),
  );

export const logoutFn = createServerFn({ method: "POST" }).handler(() =>
  guarded("customerLogout", async () => {
    const token = readCustomerToken();
    if (token) await endCustomerSession(token);
    clearCustomerCookie();
    return { ok: true as const };
  }),
);

export const requestResetFn = createServerFn({ method: "POST" })
  .validator(z.object({ email }))
  .handler(({ data }) =>
    guarded("requestReset", async (): Promise<AuthResult> => {
      if (tooManyRequests("customer-reset", 10, FIFTEEN_MINUTES)) return limited();
      await requestPasswordReset(data.email);
      // The same answer whether or not the address has an account.
      return { ok: true };
    }),
  );

export const resetPasswordFn = createServerFn({ method: "POST" })
  .validator(z.object({ token, password }))
  .handler(({ data }) =>
    guarded("resetPassword", async (): Promise<AuthResult<{ customer: CustomerView }>> => {
      if (tooManyRequests("customer-reset-use", 20, FIFTEEN_MINUTES)) return limited();
      const result = await resetPassword(data.token, data.password);
      if (!result.ok) return result;
      setCustomerCookie(result.sessionToken);
      return { ok: true, customer: result.customer };
    }),
  );

export const updateProfileFn = createServerFn({ method: "POST" })
  .middleware([customerOnly])
  .validator(z.object({ name: z.string().max(100) }))
  .handler(({ data, context }) =>
    guarded("updateProfile", () => updateCustomerName(context.customer.id, data.name)),
  );

export const changePasswordFn = createServerFn({ method: "POST" })
  .middleware([customerOnly])
  .validator(z.object({ currentPassword: password, newPassword: password }))
  .handler(({ data, context }) =>
    guarded("changeCustomerPassword", async (): Promise<AuthResult> => {
      if (!withinRateLimit(`customer-change-pw:${context.customer.id}`, 10, FIFTEEN_MINUTES)) {
        return limited();
      }
      return changeCustomerPassword(
        context.customer,
        readCustomerToken() ?? "",
        data.currentPassword,
        data.newPassword,
      );
    }),
  );

export const deleteAccountFn = createServerFn({ method: "POST" })
  .middleware([customerOnly])
  .validator(z.object({ password }))
  .handler(({ data, context }) =>
    guarded("deleteAccount", async (): Promise<AuthResult> => {
      if (!withinRateLimit(`customer-delete:${context.customer.id}`, 5, FIFTEEN_MINUTES)) {
        return limited();
      }
      const result = await deleteCustomerAccount(context.customer.id, data.password);
      if (result.ok) clearCustomerCookie();
      return result;
    }),
  );

export const myOrdersFn = createServerFn({ method: "POST" })
  .middleware([customerOnly])
  .handler(({ context }) =>
    guarded("myOrders", async (): Promise<OrderListRow[]> =>
      listCustomerOrders(context.customer.id),
    ),
  );

// Saved details for the checkout form; null when nobody is signed in.
export const checkoutPrefillFn = createServerFn({ method: "POST" }).handler(() =>
  guarded("checkoutPrefill", async (): Promise<CheckoutPrefill | null> => {
    const customer = await currentCustomer();
    return customer ? checkoutPrefill(customer) : null;
  }),
);
