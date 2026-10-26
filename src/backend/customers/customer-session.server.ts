import { deleteCookie, getCookie, getRequest, setCookie } from "@tanstack/react-start/server";

import {
  CUSTOMER_SESSION_ABSOLUTE_SECONDS,
  resolveCustomerSession,
  type CustomerPrincipal,
} from "./customer-auth.server";

export const CUSTOMER_COOKIE = "toa_session";

// Behind Railway's proxy the app itself sees plain HTTP, so trust the forwarded protocol.
function isHttps() {
  const request = getRequest();
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return forwarded === "https" || new URL(request.url).protocol === "https:";
}

// HttpOnly keeps the token from page scripts. SameSite=Lax (not Strict) so that following the link
// in a password-reset or order email lands on the site already signed in.
export function setCustomerCookie(token: string) {
  setCookie(CUSTOMER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps(),
    path: "/",
    maxAge: CUSTOMER_SESSION_ABSOLUTE_SECONDS,
  });
}

export function clearCustomerCookie() {
  deleteCookie(CUSTOMER_COOKIE, { path: "/" });
}

export const readCustomerToken = () => getCookie(CUSTOMER_COOKIE);

export async function currentCustomer(): Promise<CustomerPrincipal | null> {
  const token = readCustomerToken();
  return token ? resolveCustomerSession(token) : null;
}
